import { type NextRequest, NextResponse } from 'next/server'

// A TISZTA konfig-modulból importálunk (nem a `../analytics/posthog`-ból),
// mert az a böngésző-SDK-t (`posthog-js`) is behúzná ebbe a szerveroldali útba.
import { ANALYTICS_EVENTS } from '../analytics/posthog-config'
import { logger, type Logger } from '../logger'
import { generateRequestId, getRequestId } from '../request-id'
import {
  checkRequestRateLimit,
  rateLimitHeaders,
  type CheckRequestRateLimitOptions,
} from '../security/rate-limit'
import { readJsonWithCap } from '../security/request-body'
import { assertSameOrigin } from '../security/same-origin'
import { type PostHogCapture } from './posthog-capture'
import { parseVisszajelzesBody } from './validation'

/**
 * POST /api/visszajelzes — visszajelzés-doboz (WP65, tulajdonosi kérés
 * 2026-09-21): a látogató bármelyik oldalon jelezhesse, ha valami nem
 * működik, és a tulajdonos erről ÉRTESÜLJÖN.
 *
 * A folyamat: keret → törzs (felső korláttal) → validáció → csapda →
 * PostHog-capture → napló. A handler függőség-injekcióval épül (a
 * `free-course/route-handler.ts` és a `checkout/*` mintájára), ezért a
 * route-fájl egyetlen bekötő sor marad, a viselkedés pedig hálózat nélkül
 * mérhető.
 *
 * KÉT FÜGGETLEN MÁSOLAT KÉSZÜL minden elfogadott bejelentésről: egy a
 * PostHogban (ott elemezhető és riasztható) és egy a Railway-naplóban (ott
 * akkor is megvan, ha a PostHog éppen nem érhető el, vagy nincs beállítva).
 * Ez szándékos redundancia: egy hibabejelentő eszköz néma vesztesége
 * rosszabb, mint maga a bejelentett hiba.
 */

/** A felhasználónak megjelenő válasz alakja (a felülettel közös szerződés). */
export type VisszajelzesValasz = { ok: true } | { ok: false; uzenet: string }

/** Olvashatatlan vagy túlméretes törzs. Mondja meg, mit tegyen a látogató. */
export const VISSZAJELZES_TORZS_HIBA =
  'A visszajelzés nem küldhető el: a kérés adatai nem értelmezhetők. Frissítsd az oldalt, és próbáld újra.'

/** Váratlan technikai hiba (az 500-as ág). */
export const VISSZAJELZES_TECHNIKAI_HIBA =
  'A visszajelzés most nem ment át. Próbáld újra pár perc múlva.'

/**
 * Az anonim azonosító előtagja. Hozzájárulás nélkül minden bejelentés SAJÁT,
 * egyszer használatos azonosítót kap, tehát két bejelentés sem köthető össze,
 * és személyhez sem rendelhető. Az előtag azért kell, hogy a PostHogban
 * ránézésre látszódjon: ez nem egy valódi látogatói profil.
 */
export const ANONIM_AZONOSITO_ELOTAG = 'visszajelzes:'

export interface VisszajelzesRouteHandlerDeps {
  /** A PostHog-capture (injektált; teszt sosem hív valódi hálózatot). */
  readonly capture: PostHogCapture
  readonly logger?: Logger
  /** Injektálható azonosító-gyártó az anonim ághoz (teszthez). */
  readonly randomId?: () => string
  /** Kérés-korlátozó felülírása (teszthez); alapból a közös számláló. */
  readonly rateLimit?: CheckRequestRateLimitOptions
}

/**
 * Anonim azonosító. `crypto.randomUUID` a forrás (ugyanaz a megfontolás, mint
 * a `request-id.ts`-ben); ahol a runtime nem adja, ott nem-biztonsági
 * tartalék áll be, mert ez korrelációs azonosító, nem titok.
 */
function anonimAzonosito(): string {
  const cryptoApi = globalThis.crypto
  const veletlen =
    cryptoApi && typeof cryptoApi.randomUUID === 'function'
      ? cryptoApi.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`
  return `${ANONIM_AZONOSITO_ELOTAG}${veletlen}`
}

export function createVisszajelzesRouteHandler(
  deps: VisszajelzesRouteHandlerDeps,
): (request: NextRequest) => Promise<NextResponse<VisszajelzesValasz>> {
  return async function POST(request: NextRequest): Promise<NextResponse<VisszajelzesValasz>> {
    const requestId = getRequestId(request.headers) ?? generateRequestId()
    const log = (deps.logger ?? logger).child({ requestId, route: 'visszajelzes' })

    // EREDET-ŐR legelöl, a többi saját POST-végponttal azonos módon
    // (`assertSameOrigin`): hitelesítés nincs, viszont a végpont SZABAD
    // SZÖVEGET továbbít az analitikánkba, ezt idegen oldal ne tehesse meg a
    // látogató böngészőjén keresztül. A válasz a végpont dokumentált alakját
    // viszi (`{ ok, uzenet }`), hogy a felület minden hibaágat egyformán
    // tudjon olvasni. Origin ÉS Referer nélkül a közös őr átenged (curl,
    // üzemeltetői próba); böngészős POST-on a UA mindig küld Origint.
    const originCheck = assertSameOrigin(request)
    if (!originCheck.ok) {
      log.warn('visszajelzés: idegen eredet elutasítva')
      return NextResponse.json(
        { ok: false, uzenet: originCheck.message },
        { status: originCheck.status },
      )
    }

    // KERET: a végpont nyilvános, és minden elfogadott hívás kimenő
    // kérést indít a PostHog felé. A szabály a `visszajelzes` osztály
    // (`src/lib/security/rate-limit.ts`), az útvonal-táblából osztályozva.
    const rejection = checkRequestRateLimit(request, deps.rateLimit)
    if (rejection) {
      return NextResponse.json(
        { ok: false, uzenet: rejection.message },
        { status: 429, headers: rateLimitHeaders(rejection) },
      )
    }

    try {
      // SEC-008: felső korláttal olvassuk a törzset a parse ELŐTT — a keret a
      // kérések SZÁMÁT fogja, egy kérés törzse így sem bufferelődik
      // korlátlanul (memória-DoS).
      const bodyResult = await readJsonWithCap(request)
      if (!bodyResult.ok) {
        log.warn('visszajelzés: a kérés törzse nem olvasható', { ok: bodyResult.reason })
        return NextResponse.json({ ok: false, uzenet: VISSZAJELZES_TORZS_HIBA }, { status: 400 })
      }

      const parsed = parseVisszajelzesBody(bodyResult.value)

      // CSAPDA: emberi látogató sosem tölti ki a rejtett mezőt. A bot
      // LÁTSZÓLAGOS sikert kap, rögzítés nélkül — ugyanaz a fogás, mint a
      // kapcsolat-űrlapon (ContactForm.tsx). A visszajelzés szándékos: ne
      // legyen jelzés arról, hogy lebukott.
      if (parsed.allapot === 'csapda') {
        log.warn('visszajelzés: csapda-mező kitöltve, a beküldés eldobva')
        return NextResponse.json({ ok: true }, { status: 200 })
      }

      if (parsed.allapot === 'hibas') {
        return NextResponse.json({ ok: false, uzenet: parsed.uzenet }, { status: 400 })
      }

      const body = parsed.body
      const vanHozzajarulas = body.analitikaAzonosito !== null
      const distinctId = body.analitikaAzonosito ?? (deps.randomId ?? anonimAzonosito)()

      /**
       * ESEMÉNY-TULAJDONSÁGOK. A kulcsok angol camelCase-ben állnak, mint a
       * meglévő `courseId` / `courseSku`.
       *
       * NEVESÍTETT KIVÉTEL a `docs/posthog.md` 7. pontja alól. Az a szabály
       * („üzenetszöveg SOHA") a KÖVETÉSI metaadatra vonatkozik: ott a szabad
       * szöveg észrevétlenül, a látogató szándéka nélkül szivárogna ki. Itt
       * fordított a helyzet: a szöveg MAGA a termék, a látogató maga gépeli
       * be és maga küldi el, azután, hogy a párbeszédablak figyelmeztette,
       * hogy személyes és egészségügyi adatot ne írjon bele. E-mail-cím, név
       * és telefonszám ezért nincs is az űrlapon, az IP pedig SOHA nem megy
       * ki innen. Ez nem feledékenység: a kivétel nevesítve van, a
       * részleteket és az adatkezelési tájékoztató mondatát a
       * `docs/posthog.md` 7. pontja írja le.
       */
      const properties = {
        page: body.oldal,
        whatHappened: body.miTortent,
        whatWereYouDoing: body.mitCsinaltal,
        messageLength: body.miTortent.length,
        hasAnalyticsConsent: vanHozzajarulas,
      }

      // A NAPLÓ a bejelentés MÁSODIK példánya, request ID-vel: a Railway-log
      // akkor is őrzi, ha a capture nem megy át. A logger redact-listáján
      // egyik kulcs sincs rajta (nincs is mit takarni: személyes adatot nem
      // veszünk át).
      log.info('visszajelzés érkezett', {
        oldal: body.oldal,
        miTortent: body.miTortent,
        mitCsinaltal: body.mitCsinaltal,
        hossz: body.miTortent.length,
        analitikaHozzajarulas: vanHozzajarulas,
      })

      const eredmeny = await deps.capture(ANALYTICS_EVENTS.siteFeedback, distinctId, properties)
      if (eredmeny.allapot === 'hiba') {
        // A látogató NEM hibázott: a bejelentése megvan a naplóban. A 200-as
        // válasz ezért jogos, a baj a MI dolgunk.
        log.error('visszajelzés: a PostHog-rögzítés nem sikerült', { ok: eredmeny.ok })
      } else if (eredmeny.allapot === 'kihagyva') {
        log.warn('visszajelzés: a PostHog-rögzítés kimaradt', { ok: eredmeny.ok })
      }

      return NextResponse.json({ ok: true }, { status: 200 })
    } catch (error) {
      log.error('visszajelzés: váratlan technikai hiba', {
        ok: error instanceof Error ? error.message : String(error),
      })
      return NextResponse.json({ ok: false, uzenet: VISSZAJELZES_TECHNIKAI_HIBA }, { status: 500 })
    }
  }
}
