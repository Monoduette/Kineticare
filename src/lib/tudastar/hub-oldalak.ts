/**
 * Gyökér tünet-hubok (klaszterek) — a mért kampányfejek oldaltérképe.
 *
 * ═══ MI EZ ═══
 * A Search/Ads kutatás (Linear: „FORRÁS URL mátrix", „Kulcsszó + long-tail
 * listák kampány/head szerint", 2026-08-26-i fiók-export) a mért kulcsszó-
 * klasztereket GYÖKÉR-hubokra célozta (pl. `/keztoalagut-szindroma`), a
 * `/blog/{slug}` cikkek pedig a hubok CEP-cikkei. A hub a `pages`
 * collectionben él (URL-mátrix lock, Pocs, 2026-08-22), a cikk a `posts`-ban.
 *
 * ═══ EGYETLEN IGAZSÁG: A LEKTORÁLT CIKK-MARKDOWN ═══
 * A hub törzse NEM új orvosi szöveg: a `docs/cikkek/` lektorálási körön
 * átment markdownja adja (orvosi kutatási kör, 2026-08-25), ugyanazzal a
 * fordítóval (`markdown-to-lexical`). Új klinikai állítást ez a réteg nem
 * vezet be — az a Katák dolga. Ezért a hub SEO-címzése és GYIK-je is a cikk
 * MÉRT céltáblájából jön (seo-kulcsszavak.ts, faq.ts), nem találgatásból.
 *
 * ═══ PUBLIKÁLÁSI KAPU ═══
 * A hub-import (src/scripts/import-hub-oldalak.ts) alapból PISZKOZATOT ír.
 * Publikálás = tulajdonosi/Katák döntés (OWNER_HUB_PUBLISH=igen), mert a hub
 * publikálásakor:
 *  1. a `/blog/{cikk}` útvonal 308-cal a gyökérre irányít (lásd
 *     `hubAtiranyitasCel`), a cikk kikerül a sitemapből;
 *  2. az Ads finaloknak (jelenleg `/blog/…`) a gyökérre KELL váltaniuk,
 *     különben a hirdetés átirányítást hirdetne (adwords-kampany.md 7.4).
 * Ez a két lépés összehangolt cutover — a kód az 1.-et automatikusan adja,
 * a 2. a Google Ads fiókban kézi/bulk feladat.
 *
 * ═══ A 9. KLASZTER (vállfájdalom) ═══
 * A mérés megvan (Semrush HU: „vállfájdalom" vol 1900 / KD 28, runId
 * 01M0ST9Z3ZQEC7KV0B9TN2FE14 — Linear „FORRÁS Monid lyukak 2026-08-24"),
 * de lektorált orvosi törzs NINCS hozzá (adwords-kampany.md 7.3: „nincs
 * cikk"). Kitalált egészségügyi tartalom tilos, ezért a vallfajdalom hub
 * ITT SZÁNDÉKOSAN NEM SZEREPEL, amíg a Katák meg nem írják a cikkét.
 */

/** Egy gyökér-hub: a gyökér slug és a lektorált forrás-cikk párosa. */
export interface HubOldal {
  /** A gyökér útvonal slugja (pl. `keztoalagut-szindroma` → `/keztoalagut-szindroma`). */
  slug: string
  /** A lektorált forrás-cikk slugja a `posts` collectionben (CIKKEK). */
  cikkSlug: string
  /** A forrás-markdown fájlneve a `docs/cikkek/` alatt (CIKKEK). */
  cikkFajl: string
}

/**
 * A 8 megépíthető hub. A slugok a 2026-08-26-i Ads-export finaljaival azonosak
 * (K1/K2/K3 fejek), a `kez-zsibbadas` a H-ZS fej gyökér-célja — a cikk CEP-címe
 * (`miert-zsibbad-a-kezem`) ott más, ezért a párosítás explicit.
 */
export const HUB_OLDALAK: readonly HubOldal[] = [
  { slug: 'keztoalagut-szindroma', cikkSlug: 'keztoalagut-szindroma', cikkFajl: '2-keztoalagut-szindroma.md' },
  { slug: 'inhuvelygyulladas', cikkSlug: 'inhuvelygyulladas', cikkFajl: '7-inhuvelygyulladas.md' },
  { slug: 'teniszkonyok', cikkSlug: 'teniszkonyok', cikkFajl: '3-teniszkonyok.md' },
  { slug: 'csuklo-es-kezfajdalom', cikkSlug: 'csuklo-es-kezfajdalom', cikkFajl: '5-csuklo-es-kezfajdalom.md' },
  { slug: 'kez-zsibbadas', cikkSlug: 'miert-zsibbad-a-kezem', cikkFajl: '1-miert-zsibbad-a-kezem.md' },
  { slug: 'pattano-ujj', cikkSlug: 'pattano-ujj', cikkFajl: '4-pattano-ujj.md' },
  { slug: 'csuklotores-utani-gyogytorna', cikkSlug: 'csuklotores-utani-gyogytorna', cikkFajl: '6-csuklotores-utani-gyogytorna.md' },
  { slug: 'befagyott-vall', cikkSlug: 'befagyott-vall', cikkFajl: '8-befagyott-vall.md' },
]

/**
 * Slugok, amikre hub SOHA nem épülhet: meglévő route-ok, CMS-oldalak és
 * tiltott célok. Teszt őrzi (hub-oldalak.test.ts), hogy a HUB_OLDALAK
 * egyetlen eleme se ütközzön velük.
 */
export const HUB_TILTOTT_SLUGOK: readonly string[] = [
  'kezdolap',
  'szolgaltatasok',
  'rolunk',
  'kapcsolat',
  'impresszum',
  'adatvedelem',
  'aszf',
  'kurzusok',
  'blog',
  'kezrehab',
  'kezrelax',
  'kosar',
  'penztar',
  'de-quervain-szindroma',
]

const CIKKBOL_HUB: ReadonlyMap<string, string> = new Map(
  HUB_OLDALAK.map((hub) => [hub.cikkSlug, hub.slug]),
)

/** A cikkhez tartozó gyökér-hub slugja, vagy `null`, ha a cikknek nincs hubja. */
export function hubSlugForPost(postSlug: string): string | null {
  return CIKKBOL_HUB.get(postSlug) ?? null
}

/**
 * Hova irányítson a `/blog/{postSlug}` cikkoldal: a publikált hub gyökér-útja,
 * vagy `null`, ha nincs hub vagy a hub (még) nincs publikálva.
 *
 * A döntést a hívó a PUBLIKÁLT pages-slugok halmazával hozza meg — így a
 * függvény tiszta marad (DB nélkül tesztelhető), és a piszkozat-hub SOHA nem
 * irányít át: amíg a Katák nem publikálták, a cikk él tovább változatlanul.
 */
export function hubAtiranyitasCel(
  postSlug: string,
  publikaltPageSlugok: ReadonlySet<string>,
): string | null {
  const hubSlug = hubSlugForPost(postSlug)
  if (hubSlug === null || !publikaltPageSlugok.has(hubSlug)) {
    return null
  }
  return `/${hubSlug}`
}

/**
 * Poszt-slug → KANONIKUS gyökér-út térkép a BELSŐ hivatkozásokhoz.
 *
 * Miért kell: a `/blog/{cikk}` cím publikált hub mellett 308-cal a gyökérre
 * megy (`hubAtiranyitasCel`), a belső linkek viszont a régi alakot hirdették —
 * mérve 2026-09-07: a `/blog` lapon 7 átirányító és 0 kanonikus cikk-link
 * (`docs/oldal-audit-b-tudastar-2026-09-07.md` 1. találat). Az átirányított
 * belső link fölösleges kört és késleltetést tesz a látogató elé, a
 * link-értéket pedig egy ugrással adja tovább (Semrush, *Technical SEO*:
 * a belső hivatkozás mindig a végleges címre mutasson; Google Search Central,
 * *Redirects and Google Search*, https://developers.google.com/search/docs/crawling-indexing/301-redirects
 * — „update your internal links to point to the new URLs").
 *
 * A függvény TISZTA (DB nélkül tesztelhető): a döntést a hívó által átadott,
 * publikált pages-slug halmaz hozza — pontosan ugyanaz a kapu, mint az
 * átirányításnál. PISZKOZAT hub SOHA nem kap linket: a gyökér-URL ilyenkor
 * 404, tehát a látogatót zsákutcába küldenénk.
 *
 * A visszatérési érték SZÁNDÉKOSAN sima objektum (nem Map, nem függvény):
 * szerver → kliens komponens-határon szerializálhatónak kell lennie.
 */
export function hubUtvonalTerkep(
  postSlugok: readonly string[],
  publikaltPageSlugok: ReadonlySet<string>,
): Record<string, string> {
  const terkep: Record<string, string> = {}
  for (const postSlug of postSlugok) {
    const cel = hubAtiranyitasCel(postSlug, publikaltPageSlugok)
    if (cel !== null) {
      terkep[postSlug] = cel
    }
  }
  return terkep
}

/**
 * Egy cikk BELSŐ hivatkozásának útja: a publikált hub gyökér-címe, ha van,
 * egyébként a változatlan `/blog/{slug}`.
 *
 * A hiányzó térkép (undefined) a mai viselkedést adja — így a komponensek
 * visszafelé kompatibilisek maradnak.
 */
export function cikkUtvonal(
  postSlug: string,
  terkep: Readonly<Record<string, string>> | undefined,
): string {
  return terkep?.[postSlug] ?? `/blog/${postSlug}`
}
