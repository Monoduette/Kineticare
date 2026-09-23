import { PRODUCTION_HOSTS } from './security/live-environment'
import { HUB_OLDALAK } from './tudastar/hub-oldalak'

/**
 * A Tudástár-kapcsoló döntési szabálya: TISZTA modul, szerver-import nélkül.
 *
 * Kliens- és admin-komponensből is importálható (a Menüpontok szerkesztőjének
 * tájékoztatója is ezt használja), ezért nem olvas adatbázist és nem hoz be
 * Payloadot. A menük lekérdezése a szerveroldali `src/lib/tudastar-lathatosag.ts`
 * dolga, a navigációé a `src/lib/menu-tree.ts`-é; mindkettő EZT a szabályt
 * kérdezi, így a kapcsoló egyetlen helyen dől el.
 *
 * A TULAJDONOS KÉRÉSE, szó szerint: „ha kikapcsolom a tudástár menüpontot,
 * akkor azt szeretném, hogy sehol ne jelenjen meg, tehát az hasson ki azokra a
 * mezőkre és dobozokra, ahol láthatóak a dobozai. Ha visszakapcsolom majd,
 * akkor jöjjön vissza.”
 *
 * A SZABÁLY (vezetői döntés, 2026-09-22, szó szerint):
 * - A Tudástár KIKAPCSOLT, ha van legalább egy type='url' menüpont, amelynek
 *   célja a /blog, és MINDEGYIK ilyen menüpont visible=false VAGY unlisted=true.
 *   - „/blog célú”: az url normalizálva a /blog útvonal, záró perjellel,
 *     query-vel vagy hash-sel is; a saját production-origin abszolút alakja is
 *     (PRODUCTION_HOSTS, NEXT_PUBLIC_SERVER_URL).
 *   - Nem számít ide: /blogger, és a /blog/<cikk> sem kapcsoló.
 * - Ha nincs ilyen menüpont, a Tudástár BEKAPCSOLT.
 * - DB-hiba esetén is BEKAPCSOLT, logger.warn-nal. Indok: a véletlen
 *   SEO-veszteség ellen.
 * - A 8 tünet-hub (src/lib/tudastar/hub-oldalak.ts, HUB_OLDALAK)
 *   Tudástár-cikknek számít.
 * - A Tudástár-felületek belső navigációja (morzsa, kapcsolódó cikkek a
 *   cikkeken) marad. A NEM Tudástár felületekről tűnik el minden hivatkozás.
 *
 * A kikapcsolt Tudástár NEM törlés: a /blog, a cikkek, a kategóriák és a hubok
 * közvetlen linkkel továbbra is 200-zal elérhetők, csak `noindex, follow`
 * jelölést kapnak. A robots.txt szándékosan NEM tiltja őket, mert a tiltott
 * lapon a kereső a noindexet sem látná (Google Search Central, *Block Search
 * indexing with noindex*: „For the noindex rule to be effective, the page or
 * resource must not be blocked by a robots.txt file”,
 * https://developers.google.com/search/docs/crawling-indexing/block-indexing).
 */

/** A Tudástár listájának útvonala; a kapcsoló menüpontja ide mutat. */
export const TUDASTAR_UTVONAL = '/blog'

/** A 8 tünet-hub gyökér-útvonala (`/keztoalagut-szindroma` …). */
export const HUB_UTVONALAK: ReadonlySet<string> = new Set(HUB_OLDALAK.map((hub) => `/${hub.slug}`))

/** Igaz, ha a slug a 8 tünet-hub egyike (a hub a `pages`-ben él, de cikknek számít). */
export function isHubSlug(slug: unknown): boolean {
  return typeof slug === 'string' && HUB_UTVONALAK.has(`/${slug}`)
}

/** A hivatkozás-felismerés beállítása: a saját publikus szerver-URL (tesztben felülírható). */
export interface SajatUtvonalOptions {
  /** Alapértelmezés: `process.env.NEXT_PUBLIC_SERVER_URL` a hívás pillanatában. */
  serverUrl?: string | null
}

/** A relatív címek feloldásához használt, soha nem létező bázis. */
const RELATIV_BAZIS = 'https://relativ.invalid'

/** Az origin kisbetűs alakja, vagy null, ha a cím nem értelmezhető. */
function originOf(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null
  try {
    return new URL(value.trim()).origin.toLowerCase()
  } catch {
    return null
  }
}

/**
 * A saját webhely originjei: az éles hosztok (https és a http, amely az
 * éles szerveren https-re irányít) és a beállított publikus szerver-URL.
 */
export function sajatOriginek(options: SajatUtvonalOptions = {}): ReadonlySet<string> {
  const origins = new Set<string>()
  for (const host of PRODUCTION_HOSTS) {
    origins.add(`https://${host}`)
    origins.add(`http://${host}`)
  }
  const serverUrl =
    options.serverUrl !== undefined ? options.serverUrl : process.env.NEXT_PUBLIC_SERVER_URL
  const server = originOf(serverUrl)
  if (server !== null) origins.add(server)
  return origins
}

/**
 * Egy hivatkozás SAJÁT webhelyen belüli útvonala, normalizálva: query és hash
 * nélkül, záró perjel nélkül (`/blog/?x#y` → `/blog`). Null, ha a cím külső,
 * üres, értelmezhetetlen vagy lapon belüli relatív (`#horgony`, `?q`, `blog`).
 *
 * A kis- és nagybetű SZÁMÍT: a Next útvonalai kisbetű-érzékenyek, a `/Blog`
 * tehát nem a Tudástár, hanem egy nem létező lap.
 */
export function sajatUtvonal(href: unknown, options: SajatUtvonalOptions = {}): string | null {
  if (typeof href !== 'string') return null
  const raw = href.trim()
  const abszolut = /^https?:\/\//i.test(raw) || raw.startsWith('//')
  if (!abszolut && !raw.startsWith('/')) return null
  let parsed: URL
  try {
    parsed = new URL(raw, RELATIV_BAZIS)
  } catch {
    return null
  }
  const origin = parsed.origin.toLowerCase()
  if (origin !== RELATIV_BAZIS && !sajatOriginek(options).has(origin)) return null
  let pathname = parsed.pathname
  try {
    pathname = decodeURI(pathname)
  } catch {
    // Hibás százalékos kódolás: a nyers útvonal marad, azzal hasonlítunk.
  }
  return pathname.replace(/\/+$/, '') || '/'
}

/** A kapcsoló célja-e: pontosan a /blog útvonal (a /blog/<cikk> és a /blogger nem). */
export function isTudastarMenuUrl(url: unknown, options: SajatUtvonalOptions = {}): boolean {
  return sajatUtvonal(url, options) === TUDASTAR_UTVONAL
}

/**
 * Tudástár-felületre mutat-e a hivatkozás: a /blog, bármely /blog/… lap
 * (cikk, kategória) vagy a 8 tünet-hub valamelyike.
 */
export function isTudastarHref(href: unknown, options: SajatUtvonalOptions = {}): boolean {
  const path = sajatUtvonal(href, options)
  if (path === null) return false
  return (
    path === TUDASTAR_UTVONAL || path.startsWith(`${TUDASTAR_UTVONAL}/`) || HUB_UTVONALAK.has(path)
  )
}

/** A döntéshez szükséges menüpont-mezők (a Payload `Menu` típus részhalmaza). */
export interface TudastarKapcsoloMenu {
  type?: string | null
  url?: string | null
  visible?: boolean | null
  unlisted?: boolean | null
}

/** Kapcsoló-menüpont-e: `type='url'`, és a célja a /blog. */
export function isTudastarKapcsolo(
  menu: TudastarKapcsoloMenu,
  options: SajatUtvonalOptions = {},
): boolean {
  return menu.type === 'url' && isTudastarMenuUrl(menu.url, options)
}

/**
 * A menüpont a navigációban látszik-e. Ugyanaz a feltétel, mint a
 * `buildNavTree` szűrője: a hiányzó `visible` az adatbázis alapértéke (igaz).
 */
export function isMenupontLathato(menu: TudastarKapcsoloMenu): boolean {
  return menu.visible !== false && menu.unlisted !== true
}

/**
 * A Tudástár látható-e a menüpontok alapján (a szabály a fejkommentben).
 * Kapcsoló-menüpont nélkül BEKAPCSOLT; ha van, elég, ha EGY látszik.
 */
export function tudastarLathatoMenukbol(
  menus: ReadonlyArray<TudastarKapcsoloMenu>,
  options: SajatUtvonalOptions = {},
): boolean {
  const kapcsolok = menus.filter((menu) => isTudastarKapcsolo(menu, options))
  return kapcsolok.length === 0 || kapcsolok.some(isMenupontLathato)
}
