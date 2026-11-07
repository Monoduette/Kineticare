/**
 * Content-Security-Policy összeállítás (OWASP A05 — Security Misconfiguration).
 *
 * A politika tiszta függvényként él itt, nem a `next.config.ts` belsejében:
 * így egységtesztelhető (lásd `src/__tests__/security/csp.test.ts`), és a
 * CI megvédi a fejlécet a csendes elrontástól. A `next.config.ts` csak
 * behívja és a válaszfejlécbe teszi.
 *
 * FONTOS ÜZEMELTETÉSI TUDNIVALÓ: a Next.js a `headers()` eredményét BUILD
 * IDEJÉN sütí bele a `.next/routes-manifest.json`-be. Env-változtatás után
 * ÚJRA KELL BUILDELNI, különben a régi fejléc megy ki (vö. CLAUDE.md
 * „a SUCCESS deploy nem jelenti, hogy az új kód fut").
 */

import { BARION_PIXEL_ORIGIN, getBarionPixelId } from '../analytics/barion-pixel'
import { GA_TAG_MANAGER_ORIGIN, normalizeGaMeasurementId } from '../analytics/ga4'
import {
  META_PIXEL_COLLECT_ORIGIN,
  META_PIXEL_SCRIPT_ORIGIN,
  normalizeMetaPixelId,
} from '../analytics/meta-pixel'
import { POSTHOG_EMBED_ORIGIN, normalizePosthogEmbedUrl } from '../admin/web-analytics-config'

/** A Bunny Stream lejátszó (iframe-embed) hostja — fix, nem env-függő. */
export const BUNNY_STREAM_IFRAME_SOURCE = 'https://iframe.mediadelivery.net'

/**
 * A Bunny player.js könyvtár CDN-hosztja (a haladás automatikus jelöléséhez).
 *
 * KÜLÖN host az iframe-étől, és KIZÁRÓLAG a `script-src`-be kerül. A tényleges
 * fájl-URL és az integritás-hash az src/lib/stream/playerjs-loader.ts-ben él —
 * ott van a betöltés egyetlen helye is. A felvétel indoklása és a kockázat
 * mérlegelése a `script-src` direktíva melletti kommentben.
 */
export const BUNNY_PLAYERJS_SOURCE = 'https://assets.mediadelivery.net'

/**
 * A GA4 (gtag.js) mérési végpontjai.
 *
 * A joker itt KÖTELEZŐ, mert a GA4 régió-specifikus gyűjtőhostokra küld
 * (`region1.google-analytics.com`, `analytics.google.com` aldomainek) —
 * pontos hostot nem lehet előre felsorolni. A joker szabályos: a legbaloldalibb,
 * TELJES címke helyén áll — vö. a `BUNNY_PULL_ZONE_WILDCARD_SOURCE` alatti
 * magyarázat a `vz-*` alakú, ÉRVÉNYTELEN jokerről.
 */
export const GA_COLLECT_SOURCES = [
  'https://*.google-analytics.com',
  'https://*.analytics.google.com',
] as const

/**
 * A Bunny pull-zone hostjának szabályos, egy címkés jokere.
 *
 * MIÉRT NEM `https://vz-*.b-cdn.net`: a CSP host-forrásában a joker (`*`)
 * KIZÁRÓLAG a legbaloldalibb, TELJES címke helyén állhat. A `vz-*` alak ezért
 * ÉRVÉNYTELEN forrás — a böngésző némán eldobja, és a pull-zone hostja
 * egyáltalán nem kerül fel a listára. Pontosan ez a hiba élt korábban a
 * `customer-*.cloudflarestream.com` mintában (valódi böngészőben bizonyítva:
 * docs/video-stream-keszenlet.md), és a Bunny hosztneve ugyanebbe a csapdába
 * hívna: fekete lejátszó, csak a konzolban látszó hibával.
 */
export const BUNNY_PULL_ZONE_WILDCARD_SOURCE = 'https://*.b-cdn.net'

/**
 * A pull-zone hosztnév megengedett alakja: EGY címke + `.b-cdn.net`
 * (pl. `vz-1a2b3c4d-5e6.b-cdn.net`).
 */
const PULL_ZONE_HOST_PATTERN = /^[a-z0-9-]+\.b-cdn\.net$/

/**
 * A Bunny pull-zone CSP-forrása (poszterképek, médiaforrás).
 *
 * - Ismert hosztnév (`NEXT_PUBLIC_BUNNY_STREAM_PULL_ZONE_HOST`) esetén a
 *   PONTOS hostot adja vissza (`https://vz-….b-cdn.net`), joker nélkül — ez a
 *   lehető legszűkebb, tehát a legbiztonságosabb szabály.
 * - Hiányzó vagy formailag gyanús érték esetén a SZABÁLYOS jokerre esik
 *   vissza, hogy a videó bekapcsolása egy elgépelt env miatt se törjön el.
 *
 * A hosztnév kisbetűsítve vizsgálódik (a DNS-név amúgy sem kis-nagybetű-érzékeny),
 * a szigorú minta pedig fejléc-injekció elleni védelem is: szóközt,
 * pontosvesszőt vagy jokert tartalmazó env-érték nem tud új direktívát
 * becsempészni a fejlécbe.
 */
export function bunnyPullZoneSource(rawHost: string | undefined): string {
  const host = typeof rawHost === 'string' ? rawHost.trim().toLowerCase() : ''
  if (host.length === 0 || !PULL_ZONE_HOST_PATTERN.test(host)) {
    return BUNNY_PULL_ZONE_WILDCARD_SOURCE
  }
  return `https://${host}`
}

/**
 * A teljes Content-Security-Policy fejléc-érték összeállítása.
 *
 * @param bunnyPullZoneHost a Bunny pull-zone hosztneve (env), ha ismert.
 * @param googleAnalyticsMeasurementId a GA4 mérési azonosító (env), ha be van
 *   állítva. A Google hostjai KIZÁRÓLAG ekkor kerülnek a fejlécbe: GA nélkül
 *   (és formailag hibás azonosító esetén) a politika marad a lehető
 *   legszűkebb. Ugyanaz a szigorítás, mint a pull-zone hosztnál.
 * @param barionPixelId a Barion Pixel azonosítója (env), ha be van állítva.
 *   A `pixel.barion.com` KIZÁRÓLAG ekkor nyílik meg — pontosan ugyanaz az
 *   ellenőrzés dönt, mint ami a snippetet kirakja (BarionPixel.tsx), így a
 *   fejléc és a lap tartalma nem tud szétcsúszni.
 * @param posthogSharedDashboardUrl a PostHog megosztott dashboard linkje
 *   (env), ha be van állítva. Az `eu.posthog.com` frame-src-be vétele
 *   KIZÁRÓLAG ekkor történik meg — ugyanaz a normalizáló dönt, mint amelyik
 *   a Webanalitika-nézet iframe-jét kirakja (web-analytics-config.ts), így a
 *   fejléc és az admin-oldal nem tud szétcsúszni. A host maga FIX (nem az
 *   env-értékből jön), tehát rossz env sem tud idegen hostot nyitni.
 * @param adminVideoUploads az /admin fejléce: a Bunny TUS-feltöltés originje.
 * @param metaPixelId a Meta Pixel azonosítója (env), ha be van állítva. A
 *   Meta hostjai KIZÁRÓLAG érvényes azonosítóval nyílnak meg — ugyanaz a
 *   normalizáló dönt, mint amelyik a Pixelt elindítja (meta-pixel.ts).
 */
export function buildContentSecurityPolicy(
  bunnyPullZoneHost?: string,
  googleAnalyticsMeasurementId?: string,
  barionPixelId?: string,
  posthogSharedDashboardUrl?: string,
  adminVideoUploads = false,
  metaPixelId?: string,
): string {
  const pullZone = bunnyPullZoneSource(bunnyPullZoneHost)

  // ═══ BARION PIXEL — MÉRT, NEM BECSÜLT FORRÁSLISTA ═══
  // A bp.js (0.4.0-s verzió, letöltve és átolvasva) HÁROM direktívát érint:
  //  - script-src: maga a https://pixel.barion.com/bp.js,
  //  - frame-src: a bp.js REJTETT IFRAME-eket szúr a body-ba ugyanerről a
  //    hostról — `barion.html` (create_iframe, a `load` eseményre), majd
  //    `barionbase.html` VAGY `barionmarketing.html` (create_base_iframe /
  //    create_marketing_iframe). frame-src nélkül a Pixel NÉMÁN elhal: a
  //    tényleges adatküldés ezekbe az iframe-ekbe megy,
  //  - img-src: a JS nélküli tartalék-képpont (`/a.gif`, BarionPixel.tsx).
  //
  // AMI MÉRÉS ALAPJÁN NEM KELL:
  //  - connect-src: a bp.js-ben NINCS `XMLHttpRequest`, `fetch(`,
  //    `sendBeacon`, `new Image` és `WebSocket` (mind 0 találat) — az
  //    üzenetváltás KIZÁRÓLAG `postMessage`-dzsel megy a saját iframe-jébe,
  //    amire a CSP nem vonatkozik. Ezért a connect-src marad 'self'.
  //  - 'unsafe-eval': a fájl egyetlen `eval(`-ja a beágyazott js-sha1
  //    könyvtár NODE-ágában van (`eval("require('crypto')")`), ami böngészőben
  //    sosem fut le (a `process.versions.node` vizsgálat zárja ki).
  //
  // A feloldás SZÁNDÉKOSAN a `getBarionPixelId`-vel megy (nem külön
  // ellenőrzéssel): így a fejléc pontosan akkor nyílik, amikor a snippet is
  // kikerül — egy szóközös vagy elgépelt env mindkét helyen ugyanúgy „nincs”.
  const barionPixelSource =
    getBarionPixelId({ NEXT_PUBLIC_BARION_PIXEL_ID: barionPixelId }) === null
      ? ''
      : ` ${BARION_PIXEL_ORIGIN}`

  // A GA4 csak érvényes mérési azonosítóval tölt be (src/lib/analytics/ga4.ts),
  // ezért a CSP-t is pontosan ugyanaz az ellenőrzés nyitja.
  const gaEnabled = normalizeGaMeasurementId(googleAnalyticsMeasurementId).length > 0
  const gaScriptSource = gaEnabled ? ` ${GA_TAG_MANAGER_ORIGIN}` : ''
  const gaImgSources = gaEnabled ? ` ${GA_COLLECT_SOURCES[0]} ${GA_TAG_MANAGER_ORIGIN}` : ''
  const gaConnectSources = gaEnabled
    ? ` ${GA_COLLECT_SOURCES.join(' ')} ${GA_TAG_MANAGER_ORIGIN}`
    : ''

  // ═══ META PIXEL ═══
  // script-src: connect.facebook.net (fbevents.js + a pixel-konfiguráció
  // `signals/config/<id>` scriptje). img-src + connect-src: www.facebook.com
  // (`/tr` végpont — kép-képpont, illetve sendBeacon/fetch). Csak érvényes
  // azonosítóval, a Pixel pedig csak hozzájárulás után tölt be.
  const metaEnabled = normalizeMetaPixelId(metaPixelId).length > 0
  const metaScriptSource = metaEnabled ? ` ${META_PIXEL_SCRIPT_ORIGIN}` : ''
  const metaCollectSource = metaEnabled ? ` ${META_PIXEL_COLLECT_ORIGIN}` : ''

  // A PostHog beágyazott dashboard (admin Webanalitika-nézet) iframe-je csak
  // akkor létezik, ha a megosztási link formailag érvényes — a frame-src is
  // pontosan ekkor nyílik, és mindig a FIX EU-cloud hostra, sosem az env-beli
  // értékre.
  const posthogEmbedSource =
    normalizePosthogEmbedUrl(posthogSharedDashboardUrl) === null
      ? ''
      : ` ${POSTHOG_EMBED_ORIGIN}`

  return [
    // Alapértelmezés: minden erőforrás csak saját originről. A külön nem
    // felsorolt direktívák (manifest-src, prefetch-src…) is ezt öröklik.
    "default-src 'self'",

    // 'unsafe-inline' kényszer: Next bootstrap + Payload admin inline script.
    // 'unsafe-eval' nincs. Bunny player.js: rögzített URL + SRI
    // (playerjs-loader.ts). pixel.barion.com: Barion Pixel, fizetési feltétel.
    `script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com ${BUNNY_PLAYERJS_SOURCE}${gaScriptSource}${barionPixelSource}${metaScriptSource}`,

    // Beágyazott keretek:
    //  - iframe.mediadelivery.net → a Bunny Stream lejátszó: publikus
    //    hero-videó és előzetes (src/lib/hero-video.ts,
    //    src/components/courses/PreviewVideo.tsx) ÉS a védett, jegyes
    //    kurzuslejátszó (src/lib/stream/contract.ts) — mindkettő ugyanerről a
    //    hostról jön, csak a library-id és a token/expires más,
    //  - youtube-nocookie / player.vimeo → a szerkesztő által beilleszthető
    //    publikus videó-előzetes (src/components/lexical/serialize.tsx),
    //  - challenges.cloudflare.com → Turnstile-widget,
    //  - pixel.barion.com → a bp.js REJTETT, 0×0-s iframe-jei (barion.html,
    //    barionbase.html / barionmarketing.html). Ezek a Pixel tényleges
    //    adatcsatornái: nélkülük a Pixel betöltődik, de semmit nem mér,
    //  - eu.posthog.com → az admin Webanalitika-nézet beágyazott dashboardja,
    //    KIZÁRÓLAG beállított és formailag érvényes megosztási link mellett.
    `frame-src 'self' ${BUNNY_STREAM_IFRAME_SOURCE} https://www.youtube-nocookie.com https://player.vimeo.com https://challenges.cloudflare.com${barionPixelSource}${posthogEmbedSource}`,

    // data: a beágyazott SVG-/base64-ikonokhoz. A videó-poszterképek a Bunny
    // pull-zone hosztjáról jönnek (vz-….b-cdn.net). A GA4 tartalék-útja
    // képpont-kérés (a sendBeacon/fetch helyett), ezért a gyűjtőhostok a
    // Google dokumentációja szerint az img-src-be is kellenek. A
    // pixel.barion.com a JS nélküli tartalék-képpont (`/a.gif`) miatt kell.
    `img-src 'self' data: ${pullZone}${gaImgSources}${barionPixelSource}${metaCollectSource}`,

    // blob: KÖTELEZŐ — a kezdőlap filmsávja (ScrollScrub/FilmHero) a LOKÁLIS
    // klipet (public/media/film) fetch-csel tölti le, majd
    // URL.createObjectURL()-lel adja a <video> elemnek. Nélküle a nyitó
    // filmsáv NÉMÁN elhal (csak a poszterkép marad). A blob: nem külső
    // engedély: a saját oldal által létrehozott, azonos originű objektumot
    // jelenti. A pull-zone hoszt a Bunny médiafájljaihoz kell.
    `media-src 'self' blob: ${pullZone}`,

    // Minden XHR/fetch/sendBeacon a saját originre megy: a PostHog a /ingest
    // elsőfél-proxyn (next.config.ts rewrites), a filmsáv klipjei a /media/film
    // alól, a lejátszási token a /api/stream-token-ről.
    // A Barion NEM kell ide: a fizetőoldalra teljes oldalas átirányítás visz
    // (window.location a CheckoutForm-ban), amit a CSP nem korlátoz; a Barion
    // API-t pedig kizárólag a szerver hívja.
    // A GA4 viszont NEM megy elsőfél-proxyn: a gtag.js közvetlenül a Google
    // (régió-specifikus) gyűjtőhostjaira küld — ezek csak beállított
    // GA4-azonosító mellett nyílnak meg.
    // TUS upload origin is opened only by the /admin header override.
    // https://docs.bunny.net/docs/stream/tus-resumable-uploads
    `connect-src 'self'${gaConnectSources}${metaCollectSource}${adminVideoUploads ? ' https://video.bunnycdn.com' : ''}`,

    // 'unsafe-inline' KÉNYSZER: a React inline `style={{…}}` attribútumai
    // (HeroVideo, ScrollScrub) és a Payload admin injektált <style> blokkjai
    // ide tartoznak. Szűkíthető lenne style-src-elem + style-src-attr
    // bontással — az admin regressziókockázata miatt külön, mért lépés.
    "style-src 'self' 'unsafe-inline'",

    // A betűtípusok a /public/fonts alól, saját originről jönnek.
    "font-src 'self'",

    // A PostHog session replay a tömörítő web workerét blob:-ból indítja;
    // enélkül a felvétel némán elhal. A blob: worker a saját origin kódja —
    // a posthog-js `data:` tartalék-ágát szándékosan NEM engedjük.
    "worker-src 'self' blob:",

    // Plugin-beágyazás (<object>, <embed>) sehonnan — nincs rá szükségünk.
    "object-src 'none'",
    // A <base> nem téríthet el relatív URL-eket idegen originre.
    "base-uri 'self'",
    // Űrlap kizárólag saját originre küldhető (a Barion-átirányítás nem űrlap).
    "form-action 'self'",
    // Clickjacking-védelem; az X-Frame-Options: SAMEORIGIN ennek a régi párja.
    // A Payload élő előnézet ugyanezen az originen fut, ezért a 'self' elég.
    "frame-ancestors 'self'",
  ].join('; ')
}
