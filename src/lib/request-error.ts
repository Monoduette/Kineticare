/**
 * Szerveroldali kérés-hibák jelentése: a Next `onRequestError`
 * instrumentation-hookjának törzse (`src/instrumentation.ts`).
 *
 * MIÉRT KELL. A route handlerből, a szerveres renderből, a server actionből
 * vagy a middleware-ből kiszökő kivételt a Next maga kapja el: 500-at ad, és a
 * saját `⨯ TypeError …` sorát írja a kimenetre (route-module.js
 * `onRequestError` → `console.error`). Ez a sor nem JSON, nincs benne request
 * ID, metódus és útvonal, és semmilyen riasztásba nem jut el. 2026-09-22-én 28
 * éles 500 csak a Railway hibaarány-grafikonján látszott, a PostHog
 * hibakövetésében egy sem. Ugyanabban a hívásban a Next az instrumentation
 * `onRequestError` exportját is meghívja; ez a modul adja ennek a törzsét.
 *
 * Mit csinál:
 *  1. Error szintű, strukturált naplósor a `logger`-rel: request ID (a
 *     middleware `x-request-id` fejléce), metódus, query nélküli út, a Next
 *     route-mintája, a hiba neve, üzenete és rövidített verme. Fejlécet, sütit,
 *     kéréstörzset és query-t SOHA nem ír ki; az üzenetben és a veremben
 *     talált e-mail-címet maszkolja.
 *  2. PostHog `$exception` esemény a meglévő szerver-szerver capture-rel (új
 *     függőség nélkül), így a hiba a hibakövetésbe és annak riasztásaiba is
 *     bekerül. A PostHog a `$exception` eseményen nem futtat transzformációt,
 *     ezért a maszkolásnak itt, a küldés előtt kell megtörténnie.
 *
 * A Next a hookot MEGVÁRJA, mielőtt a 500-as választ elküldi. A PostHog-hívás
 * ezért nem blokkol (a capture saját időkorláttal fut, és sosem dob), és
 * hibakulcsonként fojtott, hogy egy hibavihar ne árassza el a PostHogot. A
 * naplósor minden előfordulásnál megíródik. A jelentés maga soha nem dob.
 */

import type { Instrumentation } from 'next'

import { shouldEmitThrottledAlert } from './alert-throttle'
import { maskEmail } from './email/mask'
import { createPostHogCapture, type PostHogCapture } from './feedback/posthog-capture'
import { logger as defaultLogger, type Logger } from './logger'
import { generateRequestId, isValidRequestId, REQUEST_ID_HEADER } from './request-id'

type OnRequestErrorParams = Parameters<Instrumentation.onRequestError>

/** A Next által átadott kérés-leírás (út, metódus, fejlécek). */
export type RequestErrorRequest = OnRequestErrorParams[1]

/** A Next által átadott hiba-környezet (router, route-minta, route-típus). */
export type RequestErrorContext = OnRequestErrorParams[2]

/** A naplósor `msg` mezője (a `server_start` mintájára). */
export const REQUEST_ERROR_LOG_MSG = 'request_error'

/** A PostHog-esemény neve: a hibakövetés ezt dolgozza fel. */
export const POSTHOG_EXCEPTION_EVENT = '$exception'

/** Ugyanaz a hibakulcs legfeljebb ennyi időnként megy a PostHogba. */
export const POSTHOG_EXCEPTION_COOLDOWN_MS = 60_000

const MAX_MESSAGE_LENGTH = 1_000
const MAX_PATH_LENGTH = 512
const MAX_LOG_STACK_LINES = 12
const MAX_LOG_STACK_LENGTH = 4_000
const MAX_EXCEPTION_FRAMES = 30

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g

/** V8-veremsor: `at fn (fajl:sor:oszlop)` vagy `at fajl:sor:oszlop`. */
const V8_FRAME_PATTERN = /^\s*at (?:(.*?) \()?(.*?):(\d+):(\d+)\)?\s*$/

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function maskEmails(text: string): string {
  return text.replace(EMAIL_PATTERN, (match) => maskEmail(match))
}

function envValue(key: string): string | undefined {
  if (typeof process === 'undefined' || !process.env) {
    return undefined
  }
  return process.env[key]
}

/**
 * Query és hash nélküli út. A query-ben jelszó-visszaállító jegy, e-mail-cím
 * vagy előnézeti titok is járhat, ezért az sem a naplóba, sem a PostHogba nem
 * mehet.
 */
export function pathWithoutQuery(path: string): string {
  const cut = path.search(/[?#]/)
  return truncate(cut === -1 ? path : path.slice(0, cut), MAX_PATH_LENGTH)
}

/** A middleware által beírt, formailag érvényes request ID, ha van. */
export function requestIdFromHeaders(headers: RequestErrorRequest['headers']): string | undefined {
  const raw = headers[REQUEST_ID_HEADER]
  const value = Array.isArray(raw) ? raw[0] : raw
  return typeof value === 'string' && isValidRequestId(value) ? value : undefined
}

/** A PostHog kézi hibakövetési formátumának (platform: custom) veremkerete. */
export interface ExceptionFrame {
  readonly platform: 'custom'
  readonly lang: 'javascript'
  readonly function: string
  readonly filename: string
  readonly lineno: number
  readonly colno: number
  readonly in_app: boolean
  readonly resolved: true
}

/**
 * V8-verem → PostHog-keretek. A V8 a hibázó keretet írja elöl; a PostHog (a
 * posthog-js-szel egyezően) a legrégebbitől a hibázóig várja, ezért a
 * legfelső N keretet megfordítva adjuk át. A nem értelmezhető sorokat (pl.
 * `at async Promise.all (index 0)`) kihagyja.
 */
export function parseStackFrames(stack: string | undefined): ExceptionFrame[] {
  if (!stack) {
    return []
  }
  const frames: ExceptionFrame[] = []
  for (const line of stack.split('\n')) {
    const match = V8_FRAME_PATTERN.exec(line)
    if (!match) {
      continue
    }
    const [, fn, filename, lineno, colno] = match
    frames.push({
      platform: 'custom',
      lang: 'javascript',
      function: fn && fn.length > 0 ? fn : '?',
      filename: maskEmails(filename),
      lineno: Number(lineno),
      colno: Number(colno),
      in_app: !filename.includes('node_modules') && !filename.startsWith('node:'),
      resolved: true,
    })
  }
  return frames.slice(0, MAX_EXCEPTION_FRAMES).reverse()
}

interface ErrorFacts {
  readonly name: string
  readonly message: string
  readonly digest: string | undefined
  readonly stack: string | undefined
}

function readString(source: object, key: string): string | undefined {
  const value: unknown = Reflect.get(source, key)
  return typeof value === 'string' ? value : undefined
}

/**
 * Tartományfüggetlen leírás (nem `instanceof Error`): a Next edge-sandboxából
 * vagy vm-kontextusból érkező hiba másik `Error` osztály példánya lehet.
 */
function describeError(error: unknown): ErrorFacts {
  if (typeof error === 'object' && error !== null) {
    const message = readString(error, 'message')
    return {
      name: readString(error, 'name') ?? 'Error',
      message: truncate(maskEmails(message ?? ''), MAX_MESSAGE_LENGTH),
      digest: readString(error, 'digest'),
      stack: readString(error, 'stack'),
    }
  }
  return {
    name: 'NonError',
    message: truncate(maskEmails(String(error)), MAX_MESSAGE_LENGTH),
    digest: undefined,
    stack: undefined,
  }
}

function logStack(stack: string | undefined): string | undefined {
  if (!stack) {
    return undefined
  }
  const lines = stack.split('\n').slice(0, MAX_LOG_STACK_LINES).join('\n')
  return truncate(maskEmails(lines), MAX_LOG_STACK_LENGTH)
}

/**
 * Fojtási kulcs: metódus + route-minta + hibanév + számjegy-semleges üzenet.
 * A számjegyek cseréje miatt az azonosítót hordozó üzenetek (pl. „order 123”)
 * egy kulcsra esnek, a kulcsok száma így nem nő korlátlanul.
 */
export function throttleKey(
  method: string,
  routePath: string,
  errorName: string,
  message: string,
): string {
  const normalized = message.replace(/\d+/g, '#').slice(0, 200)
  return `request-error:${method}:${routePath}:${errorName}:${normalized}`
}

export interface RequestErrorReporterDeps {
  readonly logger?: Logger
  /** A PostHog-capture (injektált; teszt sosem hív valódi hálózatot). */
  readonly capture?: PostHogCapture
  /** true → a hibakulcs most küldhető a PostHogba. */
  readonly shouldSend?: (key: string) => boolean
  /** Azonosító, ha a kérésnek nincs request ID-je (PostHog distinct_id). */
  readonly randomId?: () => string
}

export type RequestErrorReporter = (
  error: unknown,
  request: RequestErrorRequest,
  context: RequestErrorContext,
) => void

export function createRequestErrorReporter(
  deps: RequestErrorReporterDeps = {},
): RequestErrorReporter {
  const baseLogger = deps.logger ?? defaultLogger
  const capture = deps.capture ?? createPostHogCapture()
  const shouldSend =
    deps.shouldSend ??
    ((key: string) => shouldEmitThrottledAlert(key, POSTHOG_EXCEPTION_COOLDOWN_MS))
  const randomId = deps.randomId ?? generateRequestId

  return function reportRequestError(error, request, context) {
    try {
      const requestId = requestIdFromHeaders(request.headers)
      const log = requestId ? baseLogger.child({ requestId }) : baseLogger
      const facts = describeError(error)
      const method = request.method
      const path = pathWithoutQuery(request.path)

      log.error(REQUEST_ERROR_LOG_MSG, {
        method,
        path,
        routePath: context.routePath,
        routeType: context.routeType,
        routerKind: context.routerKind,
        renderSource: context.renderSource,
        revalidateReason: context.revalidateReason,
        errorName: facts.name,
        errorMessage: facts.message,
        digest: facts.digest,
        stack: logStack(facts.stack),
      })

      if (!shouldSend(throttleKey(method, context.routePath, facts.name, facts.message))) {
        return
      }

      const frames = parseStackFrames(facts.stack)
      const properties = {
        $exception_list: [
          {
            type: facts.name,
            value: facts.message,
            mechanism: { handled: false, synthetic: false },
            ...(frames.length > 0 ? { stacktrace: { type: 'raw', frames } } : {}),
          },
        ],
        $exception_level: 'error',
        $process_person_profile: false,
        $geoip_disable: true,
        kc_context: 'server:onRequestError',
        requestId,
        method,
        path,
        routePath: context.routePath,
        routeType: context.routeType,
        routerKind: context.routerKind,
        renderSource: context.renderSource,
        digest: facts.digest,
        commitSha: envValue('RAILWAY_GIT_COMMIT_SHA'),
      }

      void capture(POSTHOG_EXCEPTION_EVENT, requestId ?? randomId(), properties).then(
        (eredmeny) => {
          if (eredmeny.allapot === 'hiba') {
            log.warn('request_error: a PostHog-rögzítés nem sikerült', { ok: eredmeny.ok })
          }
        },
        (captureError: unknown) => {
          log.warn('request_error: a PostHog-rögzítés nem sikerült', {
            ok: captureError instanceof Error ? captureError.message : String(captureError),
          })
        },
      )
    } catch (reportError) {
      baseLogger.error('request_error: a hibajelentés maga is hibára futott', {
        ok: reportError instanceof Error ? reportError.message : String(reportError),
      })
    }
  }
}

/** Az éles jelentő: alapértelmezett logger, PostHog-capture és fojtás. */
export const reportRequestError: RequestErrorReporter = createRequestErrorReporter()
