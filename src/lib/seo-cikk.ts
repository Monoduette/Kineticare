import { absoluteUrl, faqPageJsonLd, SITE_NAME } from './seo'

/**
 * Tudástár-cikkek strukturált adata (schema.org / YMYL).
 *
 * Külön a közös seo.ts-től: cikk-séma szerzővel, lektorral, ellenőrzési dátummal.
 * A séma csak látható tartalmat írhat le; FAQ lista és FAQPage ugyanabból a tömbből.
 * Payload-kapcsolatokat nem old fel — a hívó adja a leszűkített `{ name, credentials }`
 * alakot (populált user jelszó-hasht és session-listát visz).
 */

/** A cikk-séma nyelve — magyar tartalom, magyar közönségnek. */
const ARTICLE_LANGUAGE = 'hu-HU'

/**
 * A szerző- és lektor-`Person` `url`-je.
 *
 * A látható szerző-blokk „Ismerd meg a hátterünket" linkje a `/rolunk` lapra
 * visz — a séma pontosan azt a címet közli, amit az olvasó is követni tud
 * (a Google strukturált adat irányelve: a séma a látható tartalmat írja le).
 * Amíg a `/rolunk` nem ad személyenkénti horgonyt, a két gyógytornász
 * ugyanarra a lapra mutat; személyenkénti URL-t kitalálni tilos lenne.
 */
const PROFILE_PATH = '/rolunk'

/**
 * A cikkhez kiírható GYIK-tételek felső korlátja.
 *
 * A `posts.faq` mező `maxRows: 6` beállítása az admin-szerkesztőt fogja meg;
 * ez a konstans a RENDERELÉST fogja meg, mert a seed, az import és a REST-API
 * a maxRows-t nem futtatja. Mivel a látható lista és a FAQPage séma ugyanebből
 * a tömbből készül, a plafon mindkettőre azonosan érvényes — a séma nem tud
 * többet hirdetni, mint amennyi a lapon látszik.
 * (Forrás a 6-os számhoz: NHS felsorolás-plafon, docs/tudastar-technikai-terv.md 2.2.)
 */
export const POST_FAQ_MAX_ITEMS = 6

/**
 * A cikk-séma szempontjából lényeges poszt-mezők.
 *
 * SZÁNDÉKOSAN strukturális típus (nem `Pick<Post, …>`), a `SeoDoc` bevált
 * mintája szerint: így a modul nem függ a generált `payload-types.ts`
 * aktuális állapotától, és fixture-ökkel, adatbázis nélkül tesztelhető.
 * Egy valódi `Post` szerkezetileg illeszkedik rá.
 */
export interface ArticleSeoPost {
  /** A cikk címe — a lap H1-e. */
  title: string
  /** Bevezető; a hero lead bekezdése. */
  excerpt?: string | null
  /** Első közzététel ISO-időbélyege. */
  publishedAt?: string | null
  /** Utolsó dokumentum-módosítás ISO-időbélyege (CMS `updatedAt`). */
  updatedAt?: string | null
}

/**
 * Egy megnevezett szakember a sémában (szerző vagy lektor).
 *
 * A `credentials` a `Person.jobTitle` mezőbe kerül, NEM a névbe: a Google
 * Article-dokumentációja szó szerint kiköti, hogy az `author.name` „only
 * specify the name of the author. Don't add any other piece of information",
 * a titulushoz pedig a `jobTitle` tulajdonságot kell használni.
 */
export interface SchemaPerson {
  /** A megjelenített név, ahogy a byline-ban is áll. */
  name: string
  /** Végzettség/titulus, pl. „gyógytornász, kézterapeuta". */
  credentials?: string | null
}

/**
 * A cikk TÁRGYA entitásként — a séma `about` mezőjének forrása.
 *
 * A típus a schema.org hierarchiáját követi (ellenőrizve 2026-08-21,
 * https://schema.org/MedicalSignOrSymptom): Thing > MedicalEntity >
 * MedicalCondition > MedicalSignOrSymptom. Nevesített betegségnél
 * `MedicalCondition`, panasznál (zsibbadás, fájdalom) `MedicalSignOrSymptom`,
 * mert a schema.org saját megfogalmazása szerint „a symptom is generally
 * subjective while a sign is objective".
 *
 * A mezőnevek MAGYARUL állnak, mert a forrásuk a mért kulcsszó-tábla
 * (`src/lib/tudastar/seo-kulcsszavak.ts` `targy` mezője); így a mérés alakja
 * átalakítás nélkül illeszkedik a séma-rétegre, és nem keletkezik egy néma
 * fordítási lépés a kettő között.
 */
export interface ArticleSubject {
  tipus: 'MedicalCondition' | 'MedicalSignOrSymptom'
  nev: string
}

/** Egy nyers GYIK-sor a CMS-ből (a mezők üresen is jöhetnek). */
export interface PostFaqSource {
  question?: string | null
  answer?: string | null
}

/** Egy megjelenítésre és sémába egyaránt kész kérdés-válasz pár. */
export interface PostFaqItem {
  question: string
  answer: string
}

/** Levágott, nem üres szöveg — minden más (üres, csupa szóköz, nem string) `undefined`. */
function trimmedText(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const text = value.trim()
  return text.length > 0 ? text : undefined
}

/**
 * ISO-időbélyeg → naptári nap (`YYYY-MM-DD`), érvénytelen értéknél `undefined`.
 *
 * MIÉRT CSAK NAP. A `lastReviewed` várt értéktípusa a schema.org szerint
 * **Date** (nem DateTime) — ellenőrizve 2026-08-21, https://schema.org/lastReviewed.
 * A `datePublished`/`dateModified` ezzel szemben Date ÉS DateTime értéket is
 * elfogad (https://schema.org/datePublished), ezért azokat változtatás nélkül,
 * időzónástul adjuk tovább — a Google Article-dokumentációja kifejezetten
 * ajánlja az időzóna közlését.
 *
 * A naptári nap UTC szerint számolódik, nem a futtató gép helyi zónája
 * szerint. Ez tudatos: a strukturált adatnak minden render-csomóponton
 * ugyanazt kell állítania, egy több régióban futó telepítés nem hirdethet
 * ugyanarról a cikkről két különböző ellenőrzési napot.
 */
function schemaDateOnly(value: unknown): string | undefined {
  const raw = trimmedText(value)
  if (raw === undefined) {
    return undefined
  }
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) {
    return undefined
  }
  return parsed.toISOString().slice(0, 10)
}

/** A kiadó — minden cikken ugyanaz az entitás, mint a kezdőlapi Organization. */
function publisherNode(): Record<string, unknown> {
  return {
    '@type': 'Organization',
    name: SITE_NAME,
    url: absoluteUrl('/'),
  }
}

/** `Person` node a szerzőhöz/lektorhoz; név nélkül `undefined` (nincs üres Person). */
function personNode(person: SchemaPerson | undefined): Record<string, unknown> | undefined {
  const name = trimmedText(person?.name)
  if (name === undefined) {
    return undefined
  }
  const jobTitle = trimmedText(person?.credentials)
  return {
    '@type': 'Person',
    name,
    ...(jobTitle !== undefined ? { jobTitle } : {}),
    url: absoluteUrl(PROFILE_PATH),
  }
}

/**
 * Szerző, lektor, ellenőrzési nap — csak a kitöltött mezők.
 *
 * Üres szerzőnél NINCS `author` kulcs (sem Organization, sem márkanevű
 * Person). A kiadó a hívó `publisher` mezője marad.
 */
function authorshipNodes(args: {
  author?: SchemaPerson
  reviewer?: SchemaPerson
  lastReviewed?: string | null
}): Record<string, unknown> {
  const authorNode = personNode(args.author)
  const reviewedBy = personNode(args.reviewer)
  const reviewedOn = schemaDateOnly(args.lastReviewed)
  return {
    ...(authorNode !== undefined ? { author: authorNode } : {}),
    ...(reviewedBy !== undefined ? { reviewedBy } : {}),
    ...(reviewedOn !== undefined ? { lastReviewed: reviewedOn } : {}),
  }
}

/**
 * A `keywords` mező értéke: trimmelt, ismétlés nélküli, VESSZŐVEL elválasztott
 * lista — érvényes tétel híján `undefined`.
 *
 * A vesszős alak a schema.org saját megfogalmazása: „Multiple textual entries
 * in a keywords list are typically delimited by commas, or by repeating the
 * property" (ellenőrizve 2026-08-21, https://schema.org/keywords). A tulajdonság
 * a `CreativeWork`-ön áll, tehát az `Article`-ön és a `WebPage`-en egyaránt
 * érvényes — a kettős típusú node-on nem kell választani.
 *
 * Az ismétlés kiszűrése nem kozmetika: az elsődleges kifejezés a mért táblában
 * a másodlagosak közt is felbukkanhat, és ugyanaz a szó kétszer semmit nem tesz
 * hozzá a gépi olvasó képéhez.
 */
function keywordsValue(keywords: readonly string[] | undefined): string | undefined {
  const unique = new Set<string>()
  for (const keyword of keywords ?? []) {
    const text = trimmedText(keyword)
    if (text !== undefined) {
      unique.add(text)
    }
  }
  return unique.size > 0 ? [...unique].join(', ') : undefined
}

/**
 * Az `about` node: a cikk tárgya entitásként, KIZÁRÓLAG `@type` + `name`
 * alakban. Név nélkül `undefined` — üres entitást nem hirdetünk.
 *
 * A szigorú kételemű alak a lényeg: a `MedicalCondition` klinikai
 * altulajdonságai (`possibleTreatment`, `signOrSymptom`, `typicalTest`)
 * SZÁNDÉKOSAN kimaradnak, mert azok már a lapon nem látható állítások
 * lennének.
 */
function subjectNode(subject: ArticleSubject | undefined): Record<string, unknown> | undefined {
  if (subject === undefined) {
    return undefined
  }
  const name = trimmedText(subject.nev)
  return name === undefined ? undefined : { '@type': subject.tipus, name }
}

/**
 * Cikkoldal JSON-LD: egy node `['Article', 'MedicalWebPage']` típussal.
 * Csak látható tartalom; üres szerzőnél nincs author. dateModified ≠ lastReviewed.
 * keywords: CMS seoKeywords; about: mért tárgy — kitalálni tilos.
 */
export function postArticleJsonLd(args: {
  post: ArticleSeoPost
  /** A cikk relatív útvonala, pl. `/blog/gipsz-utan`. */
  path: string
  /**
   * A szerző a látható byline-ból. Kitöltött, névvel rendelkező user → Person.
   * Üres vagy populálatlan mezőnél a kulcs KIMARAD — Organization / SITE_NAME
   * soha nem áll szerző-tartalékként (a kiadó a `publisher`).
   */
  author?: SchemaPerson
  /** A szakmai lektor (`posts.reviewedBy`) — csak ha tényleg van. */
  reviewer?: SchemaPerson
  /** Az utolsó szakmai ellenőrzés (`posts.reviewedAt`) ISO-értéke. */
  lastReviewed?: string | null
  /** A megosztási kép abszolút URL-je (`resolveOgImageUrl`). */
  imageUrl?: string
  /**
   * A cikk keresőszavai a CMS `seoKeywords` mezőjéből.
   * Üres mezőnél nincs — H1-ből vagy slug-mérésből kitalálni tilos.
   */
  keywords?: readonly string[]
  /** A cikk tárgya entitásként; mérés nélküli cikknél nincs. */
  about?: ArticleSubject
}): Record<string, unknown> {
  const { post, path, author, reviewer, lastReviewed, imageUrl, keywords, about } = args
  const description = trimmedText(post.excerpt)
  const datePublished = trimmedText(post.publishedAt)
  const dateModified = trimmedText(post.updatedAt)
  const keywordList = keywordsValue(keywords)
  const subject = subjectNode(about)

  return {
    '@context': 'https://schema.org',
    '@type': ['Article', 'MedicalWebPage'],
    headline: post.title,
    ...(description !== undefined ? { description } : {}),
    inLanguage: ARTICLE_LANGUAGE,
    mainEntityOfPage: absoluteUrl(path),
    ...(datePublished !== undefined ? { datePublished } : {}),
    ...(dateModified !== undefined ? { dateModified } : {}),
    ...(imageUrl !== undefined ? { image: [imageUrl] } : {}),
    ...(keywordList !== undefined ? { keywords: keywordList } : {}),
    ...(subject !== undefined ? { about: subject } : {}),
    ...authorshipNodes({ author, reviewer, lastReviewed }),
    publisher: publisherNode(),
  }
}

/**
 * CMS hub-oldal JSON-LD: egy `MedicalWebPage` (nem Article). keywords: CMS seoKeywords;
 * about nincs — a hubnak nincs mért tárgya. Szerző-szabály mint a cikkoldalnál.
 */
export function cmsPageJsonLd(args: {
  page: ArticleSeoPost
  /** Az oldal relatív útvonala, pl. `/rolunk`. */
  path: string
  author?: SchemaPerson
  reviewer?: SchemaPerson
  lastReviewed?: string | null
  imageUrl?: string
  /**
   * A szerkesztő által felvett keresőszavak. Üresen a kulcs kimarad.
   */
  keywords?: readonly string[]
}): Record<string, unknown> {
  const { page, path, author, reviewer, lastReviewed, imageUrl, keywords } = args
  const description = trimmedText(page.excerpt)
  const datePublished = trimmedText(page.publishedAt)
  const dateModified = trimmedText(page.updatedAt)
  const keywordList = keywordsValue(keywords)

  return {
    '@context': 'https://schema.org',
    '@type': 'MedicalWebPage',
    name: page.title,
    headline: page.title,
    ...(description !== undefined ? { description } : {}),
    inLanguage: ARTICLE_LANGUAGE,
    mainEntityOfPage: absoluteUrl(path),
    ...(datePublished !== undefined ? { datePublished } : {}),
    ...(dateModified !== undefined ? { dateModified } : {}),
    ...(imageUrl !== undefined ? { image: [imageUrl] } : {}),
    ...(keywordList !== undefined ? { keywords: keywordList } : {}),
    ...authorshipNodes({ author, reviewer, lastReviewed }),
    publisher: publisherNode(),
  }
}

/**
 * A cikk GYIK-tételei megjelenítésre kész alakban — a látható lista ÉS a
 * FAQPage séma KÖZÖS forrása.
 *
 * MIÉRT EGY FÜGGVÉNY MINDKETTŐRE. Ha a szekció és a séma külön szűrne, a
 * kettő idővel szétcsúszna, és a Google pontosan az ilyen eltérés miatt veti
 * el a strukturált adatot. Így a szétcsúszás szerkezetileg lehetetlen: a
 * komponens egyszer hívja meg, és ugyanazt a tömböt rendereli ki, amit a
 * sémába ad (a `FaqBlock` bevált precedense).
 *
 * Hiányos tétel (üres kérdés VAGY üres válasz) mindkettőből kimarad. A
 * válasz sosem csonkolódik: a csonkolt válasz félreidézhető, és az AI-válaszok
 * pontosan ezeket a kérdés-válasz párokat emelik ki.
 */
export function postFaqItems(faq: ReadonlyArray<PostFaqSource> | null | undefined): PostFaqItem[] {
  const items: PostFaqItem[] = []
  for (const entry of faq ?? []) {
    const question = trimmedText(entry.question)
    const answer = trimmedText(entry.answer)
    if (question === undefined || answer === undefined) {
      continue
    }
    items.push({ question, answer })
    if (items.length === POST_FAQ_MAX_ITEMS) {
      break
    }
  }
  return items
}

/**
 * FAQPage JSON-LD — üres listánál `undefined`. A látható GYIK és a séma közös forrásból.
 */
export function postFaqJsonLd(
  items: ReadonlyArray<PostFaqItem>,
): Record<string, unknown> | undefined {
  if (items.length === 0) {
    return undefined
  }
  return faqPageJsonLd(items)
}
