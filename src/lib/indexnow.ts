import type { CollectionAfterChangeHook } from 'payload'

import { logger } from './logger'
import { absoluteUrl } from './seo'

/**
 * IndexNow — közzétételkor szólunk a Bingnek (és az IndexNow-t használó többi
 * keresőnek: Yandex, Seznam, Naver, Yep), hogy új vagy frissült oldal van, így
 * nem kell megvárni a következő bejárást. A Bing a ChatGPT és a Copilot
 * webes keresésének is az alapja. Protokoll: https://www.indexnow.org/documentation
 *
 * Hogyan működik:
 * 1. A `pages`, `posts` és `products` afterChange hookja (`indexNowAfterChange`)
 *    közzétett mentésnél sorba állít egy beküldést (`scheduleIndexNowSubmit`).
 *    Piszkozat- és autosave-mentés nem indít semmit.
 * 2. A beküldés KÉSLELTETVE fut (`INDEXNOW_DELAY_MS`), és az ablakba eső
 *    mentéseket egyetlen kérésbe vonja össze. A késleltetés azért kell, mert
 *    az afterChange még a mentés tranzakcióján belül fut: a változás csak a
 *    commit után látszik.
 * 3. Ekkor a SAJÁT, nyilvános `/sitemap.xml`-ünket olvassuk le HTTP-n, és
 *    abból azokat a címeket küldjük be, amelyek `lastmod`-ja a legkorábbi
 *    függő mentésnél nem régebbi. Így a kanonikus cím, a noindex-szűrés, a
 *    Tudástár-kapcsoló és a hub-átirányítás logikája egyetlen helyen él (a
 *    sitemapben), és a listaoldalak (`/`, `/kurzusok`, `/blog`) is mennek,
 *    mert a lastmod-juk a mögöttük álló tartalomból jön (src/app/sitemap.ts).
 *
 * Kulcs: `INDEXNOW_KEY` környezeti változó (8–128 karakter, a–z, A–Z, 0–9,
 * kötőjel; a protokoll előírása). A kulcs a protokoll szerint nyilvános, a
 * `/indexnow-key.txt` címen ki is szolgáljuk, de a repóba nem kerül. Üres
 * vagy formailag hibás kulcs mellett az egész funkció no-op: nincs időzítő,
 * nincs hálózati hívás, a kulcsfájl 404.
 *
 * Hiba (hálózat, 4xx/5xx) csak naplóba kerül: a beküldés gyorsítás, nem
 * feltétele semminek. Ami kimarad, azt a Bing a sitemapből úgyis megtalálja.
 */

/** A közös IndexNow-végpont; innen minden résztvevő kereső megkapja. */
const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow'

/** A kulcsfájl útvonala. A gyökérben áll, így a host minden címére érvényes. */
const INDEXNOW_KEY_PATH = '/indexnow-key.txt'

/** Ennyit várunk az első közzétett mentés után a beküldéssel (commit + összevonás). */
const INDEXNOW_DELAY_MS = 20_000

/**
 * Ennyivel korábbi lastmod is még „friss”: a sitemap lastmod-ja a dokumentum
 * `updatedAt`-je, és ugyanaz a szerver írja, mint amelyik a hookot futtatja,
 * de egy mentésen belül a mezők ideje néhány ezredmásodperccel eltérhet.
 */
const LASTMOD_TOLERANCE_MS = 5_000

/** A protokoll egy kérésben legfeljebb 10 000 címet enged. */
const MAX_URLS_PER_REQUEST = 10_000

const KEY_PATTERN = /^[A-Za-z0-9-]{8,128}$/

/** Az érvényes IndexNow-kulcs, vagy null (nincs beállítva / formailag hibás). */
export function getIndexNowKey(): string | null {
  const raw = process.env.INDEXNOW_KEY?.trim()
  if (!raw) {
    return null
  }
  if (!KEY_PATTERN.test(raw)) {
    logger.warn('IndexNow: az INDEXNOW_KEY formailag hibás, a beküldés kikapcsolva', {
      length: raw.length,
    })
    return null
  }
  return raw
}

interface SitemapEntry {
  url: string
  lastModified: Date | null
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/** A sitemap.xml `<url>` elemei: cím és (ha van, érvényes) lastmod. */
function parseSitemapXml(xml: string): SitemapEntry[] {
  const entries: SitemapEntry[] = []
  for (const block of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
    const body = block[1] ?? ''
    const loc = body.match(/<loc>\s*([^<]+?)\s*<\/loc>/)?.[1]
    if (!loc) {
      continue
    }
    const lastmodRaw = body.match(/<lastmod>\s*([^<]+?)\s*<\/lastmod>/)?.[1]
    const lastmod = lastmodRaw ? new Date(lastmodRaw) : null
    entries.push({
      url: decodeXmlEntities(loc),
      lastModified: lastmod && !Number.isNaN(lastmod.getTime()) ? lastmod : null,
    })
  }
  return entries
}

/**
 * A `since` óta módosult címek, kizárólag a saját hostunkról (más hostra
 * mutató címet az IndexNow amúgy is elutasítana a kulcsunkkal).
 */
function selectChangedUrls(entries: readonly SitemapEntry[], since: Date, host: string): string[] {
  const threshold = since.getTime() - LASTMOD_TOLERANCE_MS
  const urls = new Set<string>()
  for (const entry of entries) {
    if (entry.lastModified === null || entry.lastModified.getTime() < threshold) {
      continue
    }
    let parsed: URL
    try {
      parsed = new URL(entry.url)
    } catch {
      continue
    }
    if (parsed.host === host) {
      urls.add(parsed.toString())
    }
  }
  return [...urls].slice(0, MAX_URLS_PER_REQUEST)
}

/**
 * A sitemapből a `since` óta módosult címek beküldése. Sosem dob: minden hiba
 * naplóba kerül. Visszaadja a beküldött címek számát (0, ha nem volt mit vagy
 * nem sikerült).
 */
async function submitChangedUrlsSince(since: Date, key: string): Promise<number> {
  const sitemapUrl = absoluteUrl('/sitemap.xml')
  const host = new URL(sitemapUrl).host
  try {
    const sitemapResponse = await fetch(sitemapUrl, {
      headers: { Accept: 'application/xml' },
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    })
    if (!sitemapResponse.ok) {
      logger.warn('IndexNow: a sitemap nem olvasható, a beküldés elmarad', {
        status: sitemapResponse.status,
      })
      return 0
    }
    const urls = selectChangedUrls(parseSitemapXml(await sitemapResponse.text()), since, host)
    if (urls.length === 0) {
      logger.info('IndexNow: nincs friss cím a sitemapben, nincs beküldés')
      return 0
    }
    const response = await fetch(INDEXNOW_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        host,
        key,
        keyLocation: absoluteUrl(INDEXNOW_KEY_PATH),
        urlList: urls,
      }),
      signal: AbortSignal.timeout(15_000),
    })
    if (response.status === 200 || response.status === 202) {
      logger.info('IndexNow: címek beküldve', { count: urls.length, status: response.status })
      return urls.length
    }
    logger.warn('IndexNow: a beküldést a végpont elutasította', {
      status: response.status,
      count: urls.length,
    })
    return 0
  } catch (error) {
    logger.warn('IndexNow: a beküldés sikertelen', {
      error: error instanceof Error ? error.message : String(error),
    })
    return 0
  }
}

let pendingSince: Date | null = null
let pendingTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Beküldés sorba állítása a `changedAt` időpontig visszamenőleg. Az ablakon
 * belüli újabb hívások ugyanabba a beküldésbe kerülnek (a legkorábbi
 * időponttal), így egy szerkesztési hullám egyetlen kérés.
 */
function scheduleIndexNowSubmit(changedAt: Date): void {
  const key = getIndexNowKey()
  if (key === null) {
    return
  }
  if (pendingSince === null || changedAt.getTime() < pendingSince.getTime()) {
    pendingSince = changedAt
  }
  if (pendingTimer !== null) {
    return
  }
  pendingTimer = setTimeout(() => {
    const since = pendingSince ?? changedAt
    pendingSince = null
    pendingTimer = null
    void submitChangedUrlsSince(since, key)
  }, INDEXNOW_DELAY_MS)
  // Egy szkript (seed, import) emiatt ne maradjon életben.
  pendingTimer.unref?.()
}

/**
 * afterChange hook a nyilvános tartalmú collectionökre (`pages`, `posts`,
 * `products`). Csak közzétett állapotú mentésnél állít sorba beküldést.
 */
export const indexNowAfterChange: CollectionAfterChangeHook = ({ doc }) => {
  const record = doc as { _status?: unknown; updatedAt?: unknown }
  if (record._status === 'published') {
    const updatedAt =
      typeof record.updatedAt === 'string' ? new Date(record.updatedAt) : new Date(Number.NaN)
    scheduleIndexNowSubmit(Number.isNaN(updatedAt.getTime()) ? new Date() : updatedAt)
  }
  return doc
}
