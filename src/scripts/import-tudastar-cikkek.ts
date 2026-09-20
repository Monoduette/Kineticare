/**
 * Tudástár cikkek betöltése docs/cikkek/ markdownból. Slug alapján frissít, nem duplikál.
 *
 * Kapuk: OWNER_TUDASTAR_CONFIRM=igen (írás); OWNER_TUDASTAR_PUBLISH=igen (publikálás).
 *   npx tsx src/scripts/import-tudastar-cikkek.ts
 *   OWNER_TUDASTAR_CONFIRM=igen OWNER_TUDASTAR_PUBLISH=igen npx tsx …
 * SEO/GYIK: seo-kulcsszavak.ts, faq.ts. Útmutató: docs/tudastar-cikkek-betoltese.md
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { getPayload, type Payload } from 'payload'

import { logger } from '../lib/logger'
import { kategoriaForCikk, type TudastarKategoria } from '../lib/tudastar-kategoriak'
import { faqMezore, GYIK_MAX, GYIK_MIN } from '../lib/tudastar/faq'
import {
  excerptFrom,
  extractArticleBody,
  markdownToLexical,
} from '../lib/tudastar/markdown-to-lexical'
import {
  kulcsszoFor,
  KURZUS_KULCSSZAVAK,
  kurzusSeoKeywordsFor,
  meresToSeoKeywords,
  OLDAL_KULCSSZAVAK,
  oldalSeoKeywordsFor,
  SEO_DESCRIPTION_MAX,
  SEO_DESCRIPTION_MIN,
  SEO_TITLE_MAX,
} from '../lib/tudastar/seo-kulcsszavak'
import config from '../payload.config'

/** Honnan jön egy cikk SEO-címe és -leírása. */
export type SeoForras = 'meres' | 'cikkfejlec'

export interface CikkBejegyzes {
  readonly fajl: string
  readonly slug: string
  /**
   * `'cikkfejlec'`: a SEO-cím és -leírás a cikkfájl „Cikk-metaadatok”
   * táblájából jön, mert mért kulcsszó-célzás még nincs; a `seoKeywords`
   * mezőhöz a betöltő ilyenkor nem nyúl. Alap: `'meres'` (seo-kulcsszavak.ts).
   *
   * A publikálást ez NEM érinti: minden cikk ugyanazon a két kapun megy át
   * (`OWNER_TUDASTAR_CONFIRM`, `OWNER_TUDASTAR_PUBLISH`), lásd `celAllapot`.
   */
  readonly seoForras?: SeoForras
}

/**
 * A cikkek. A slug a fájlnév sorszám-előtag nélküli alakja — ezek a
 * webcímek szerepelnek a `docs/adwords-kampany.md` céloldal-hozzárendelésében
 * (7.2), tehát nem szabad eltérni tőlük, különben a hirdetés 404-re visz.
 *
 * A 7. és 8. cikk CSAK `/blog/{slug}` poszt. Gyökér `/inhuvelygyulladas`
 * pages-rekordot ez a script nem hoz létre.
 *
 * A 9. és 10. cikk a tulajdonosok blogötlete (2026-09-19), tulajdonosi
 * utasításra élesbe szánva: ugyanazon a két kapun megy át, mint a többi;
 * kulcsszó-mérés híján a SEO-mezők a cikkfejlécből jönnek (lásd
 * `CikkBejegyzes`).
 */
export const CIKKEK: readonly CikkBejegyzes[] = [
  { fajl: '1-miert-zsibbad-a-kezem.md', slug: 'miert-zsibbad-a-kezem' },
  { fajl: '2-keztoalagut-szindroma.md', slug: 'keztoalagut-szindroma' },
  { fajl: '3-teniszkonyok.md', slug: 'teniszkonyok' },
  { fajl: '4-pattano-ujj.md', slug: 'pattano-ujj' },
  { fajl: '5-csuklo-es-kezfajdalom.md', slug: 'csuklo-es-kezfajdalom' },
  { fajl: '6-csuklotores-utani-gyogytorna.md', slug: 'csuklotores-utani-gyogytorna' },
  { fajl: '7-inhuvelygyulladas.md', slug: 'inhuvelygyulladas' },
  { fajl: '8-befagyott-vall.md', slug: 'befagyott-vall' },
  {
    fajl: '9-peace-and-love-friss-serules.md',
    slug: 'peace-and-love-friss-serules',
    seoForras: 'cikkfejlec',
  },
  { fajl: '10-gipszben-a-kezed.md', slug: 'gipszben-a-kezed', seoForras: 'cikkfejlec' },
]

export type CikkAllapot = 'draft' | 'published'

/**
 * A cikk célállapota egy futásban: KIZÁRÓLAG a `OWNER_TUDASTAR_PUBLISH` kapu
 * dönt, minden cikkre egyformán (`docs/tudastar-cikkek-betoltese.md` 5.).
 * Tiszta függvény, hogy az őr-teszt DB nélkül kimondhassa: a 9–10. cikknek
 * nincs külön kivétele, `OWNER_TUDASTAR_PUBLISH=igen` őket is közzéteszi.
 */
export function celAllapot(publikalKapu: boolean): CikkAllapot {
  return publikalKapu ? 'published' : 'draft'
}

/**
 * A cikkfájl H1 fölötti „Cikk-metaadatok” táblájának egy sora, például
 * `| \`seoTitle\` | Ínhüvelygyulladás: tünetek és mit tehetsz |`.
 * Hiányzó sorra DOB: a néma visszaesés a cím/bevezető fallbackre pont az a
 * hiba, amit a mért célzás megszüntetett, és amit itt sem engedünk vissza.
 */
export function fejlecMetaadat(nyers: string, mezo: 'seoTitle' | 'seoDescription'): string {
  const talalat = new RegExp(`^\\|\\s*\`${mezo}\`\\s*\\|\\s*(.+?)\\s*\\|\\s*$`, 'm').exec(nyers)
  const ertek = talalat?.[1]?.trim()
  if (ertek === undefined || ertek.length === 0) {
    throw new Error(
      `A cikkfejléc „Cikk-metaadatok” táblájában nincs \`${mezo}\` sor, pedig a cikk ` +
        'SEO-mezői onnan jönnek (seoForras: cikkfejlec).',
    )
  }
  return ertek
}

/** A cikkfejlécből jövő SEO-pár, ugyanazokkal a korlátokkal, mint a mért célzás. */
function fejlecSeo(nyers: string, slug: string): { seoTitle: string; seoDescription: string } {
  const seoTitle = fejlecMetaadat(nyers, 'seoTitle')
  const seoDescription = fejlecMetaadat(nyers, 'seoDescription')
  if (seoTitle.length > SEO_TITLE_MAX) {
    throw new Error(
      `A(z) „${slug}” cikk seoTitle mezője ${seoTitle.length} karakter, a max. ${SEO_TITLE_MAX}.`,
    )
  }
  if (seoDescription.length < SEO_DESCRIPTION_MIN || seoDescription.length > SEO_DESCRIPTION_MAX) {
    throw new Error(
      `A(z) „${slug}” cikk seoDescription mezője ${seoDescription.length} karakter, ` +
        `a megengedett ${SEO_DESCRIPTION_MIN}–${SEO_DESCRIPTION_MAX} helyett.`,
    )
  }
  if (/[–—]/.test(seoTitle) || /[–—]/.test(seoDescription)) {
    throw new Error(
      `A(z) „${slug}” cikk SEO-mezőiben gondolatjel áll (docs/ui-sztenderdek.md §3.1).`,
    )
  }
  return { seoTitle, seoDescription }
}

/**
 * A 7. és 8. cikk Posts-mezői, amiket a markdown nem hordoz.
 *
 * Az eredeti hat cikk CTA/related mezőit ez a script csak ÜRES mezőbe tölti
 * (CIKK_KITOLTES). A KATEGÓRIA viszont mind a nyolc cikknél a scripté:
 * a hozzárendelés a src/lib/tudastar-kategoriak.ts CIKK_KATEGORIA táblája
 * (a tartalmi terv 3. szakasza), lásd `kategoriaMezo`. A `de-quervain-szindroma`
 * slug soha nem kerül `relatedPosts`-ba.
 */
interface CikkKiegeszito {
  kurzusSlug: string | null
  kapcsolodoSlugok: readonly string[]
  szerzoNevek: readonly string[]
  /**
   * Társszerzős cikk, amelynél a második név NEM szakmai lektor: a
   * `reviewedBy` üres marad, amíg a lektorálás tényleg meg nem történt
   * (Codex P1, #271: a „Szakmailag ellenőrizte” felirat és a reviewedBy
   * JSON-LD hamis attesztáció lenne).
   */
  tarsszerzos?: true
}

const CIKK_KIEGESZITO: Readonly<Record<string, CikkKiegeszito>> = {
  inhuvelygyulladas: {
    kurzusSlug: 'otthoni-kezrehab-program',
    kapcsolodoSlugok: ['keztoalagut-szindroma', 'pattano-ujj', 'csuklo-es-kezfajdalom'],
    szerzoNevek: ['Kiss Kata', 'Kocsis Kata'],
  },
  'befagyott-vall': {
    kurzusSlug: null,
    // Kategória-társ (vall-es-konyok): a kapcsolódó blokk így itt sem üres
    // (tulajdonosi kérés, 2026-08-25: cikk-háló minden cikk alatt).
    kapcsolodoSlugok: ['teniszkonyok'],
    szerzoNevek: ['Kiss Kata', 'Kocsis Kata'],
  },
  // A 9. és 10. cikk (tulajdonosi piszkozatok, 2026-09-19): nincs kurzus-CTA,
  // mert az Otthoni KézRehab Program leírása traumás sérülésnél orvosi
  // engedélyt kér („nem javasoljuk, ha traumás sérülésed volt, és az orvos
  // még nem enged mindent”); a záró szakasz a rendelőre (`/szolgaltatasok`)
  // visz.
  'peace-and-love-friss-serules': {
    kurzusSlug: null,
    tarsszerzos: true,
    kapcsolodoSlugok: ['csuklo-es-kezfajdalom', 'teniszkonyok', 'inhuvelygyulladas'],
    szerzoNevek: ['Kiss Kata', 'Kocsis Kata'],
  },
  'gipszben-a-kezed': {
    kurzusSlug: null,
    tarsszerzos: true,
    kapcsolodoSlugok: [
      'csuklotores-utani-gyogytorna',
      'csuklo-es-kezfajdalom',
      'miert-zsibbad-a-kezem',
    ],
    szerzoNevek: ['Kiss Kata', 'Kocsis Kata'],
  },
}

/**
 * A hat eredeti cikk kurzus-CTA-ja és kapcsolódó cikkei — KIZÁRÓLAG ÜRES
 * mezőbe írva (tulajdonosi kérés, 2026-08-25: minden cikk alatt álljon
 * ajánló és cikk-háló). A szerkesztő kézi beállítását NEM írjuk felül:
 * ha a mezőben már van érték, a kitöltés kimarad. A szerző-mezőkhöz itt
 * nem nyúlunk (azok a hat cikknél a CMS-ben élnek); a kategóriát a
 * `kategoriaMezo` adja mind a nyolc cikknek.
 */
const CIKK_KITOLTES: Readonly<
  Record<string, { kurzusSlug: string; kapcsolodoSlugok: readonly string[] }>
> = {
  'miert-zsibbad-a-kezem': {
    kurzusSlug: 'otthoni-kezrehab-program',
    kapcsolodoSlugok: ['keztoalagut-szindroma', 'csuklo-es-kezfajdalom', 'inhuvelygyulladas'],
  },
  'keztoalagut-szindroma': {
    kurzusSlug: 'otthoni-kezrehab-program',
    kapcsolodoSlugok: ['miert-zsibbad-a-kezem', 'inhuvelygyulladas', 'csuklo-es-kezfajdalom'],
  },
  teniszkonyok: {
    kurzusSlug: 'otthoni-kezrehab-program',
    kapcsolodoSlugok: ['befagyott-vall', 'csuklo-es-kezfajdalom', 'inhuvelygyulladas'],
  },
  'pattano-ujj': {
    kurzusSlug: 'otthoni-kezrehab-program',
    kapcsolodoSlugok: ['inhuvelygyulladas', 'keztoalagut-szindroma', 'csuklo-es-kezfajdalom'],
  },
  'csuklo-es-kezfajdalom': {
    kurzusSlug: 'otthoni-kezrehab-program',
    kapcsolodoSlugok: [
      'keztoalagut-szindroma',
      'csuklotores-utani-gyogytorna',
      'inhuvelygyulladas',
    ],
  },
  'csuklotores-utani-gyogytorna': {
    kurzusSlug: 'otthoni-kezrehab-program',
    kapcsolodoSlugok: ['csuklo-es-kezfajdalom', 'miert-zsibbad-a-kezem', 'inhuvelygyulladas'],
  },
}

const kapuNyitva = (nev: string): boolean => process.env[nev]?.trim().toLowerCase() === 'igen'

export interface ForditottCikk {
  slug: string
  title: string
  excerpt: string
  content: ReturnType<typeof markdownToLexical>
  szoszam: number
  /** A mért kulcsszó-célzásból jövő SEO-cím. */
  seoTitle: string
  /** A mért kulcsszó-célzásból jövő SEO-leírás. */
  seoDescription: string
  /**
   * A CMS `seoKeywords` mezője: elsodleges elöl, utána a masodlagosak.
   * A mért táblából jön, kitalálni tilos. `undefined`, ha a cikkhez nincs
   * mérés (seoForras: cikkfejlec): a betöltő ilyenkor a mezőhöz nem nyúl,
   * ugyanazzal a logikával, mint a GYIK-nél.
   */
  seoKeywords: { phrase: string }[] | undefined
  /**
   * A cikk GYIK-tételei, vagy `undefined`, ha ehhez a slughoz nincs.
   *
   * Az `undefined` és az üres tömb NEM ugyanaz: az előbbi azt jelenti, hogy a
   * betöltőnek nincs mondanivalója a mezőről, ezért hozzá sem nyúl (lásd az
   * `adat` összeállítását lentebb).
   */
  faq: { question: string; answer: string }[] | undefined
}

/**
 * Egy cikkfájl beolvasása és fordítása. Hibára DOB, nem ugrik át.
 *
 * `seoForras` alapból `'meres'`; `'cikkfejlec'` esetén a SEO-cím és -leírás a
 * fájl metaadat-táblájából jön, és a `seoKeywords` `undefined` (lásd
 * `CikkBejegyzes`).
 */
export function cikketFordit(
  cikkekDir: string,
  fajl: string,
  slug: string,
  seoForras: SeoForras = 'meres',
): ForditottCikk {
  const nyers = readFileSync(path.join(cikkekDir, fajl), 'utf8')
  const { title, lines } = extractArticleBody(nyers)
  const content = markdownToLexical(lines)

  // A SEO-mezők a MÉRT kulcsszó-célzásból jönnek (src/lib/tudastar/seo-kulcsszavak.ts),
  // nem a cikk címéből. Enélkül a `buildDocMetadata` fallback-lánca a címet és a
  // bevezetőt használná — jó magyar mondatok, de nem a keresett kifejezéssel
  // kezdenek. Hiányzó célzásra DOBUNK: a néma visszaesés a fallbackre pont az a
  // hiba, amit ez a modul megszüntet. Az egyetlen kivétel a KIMONDOTT
  // `seoForras: 'cikkfejlec'`: ott a fejléc táblája a forrás, és a cikk-lista
  // bejegyzése mondja ki, hogy mérés még nincs (nem néma fallback).
  const kulcsszo = seoForras === 'meres' ? kulcsszoFor(slug) : undefined
  if (seoForras === 'meres' && kulcsszo === undefined) {
    throw new Error(
      `Nincs mért kulcsszó-célzás a(z) „${slug}” cikkhez. Vedd fel a ` +
        'src/lib/tudastar/seo-kulcsszavak.ts CIKK_KULCSSZAVAK listájába, mérésre hivatkozva, ' +
        'vagy jelöld a CIKKEK bejegyzését seoForras: cikkfejlec értékkel.',
    )
  }
  const seo =
    kulcsszo === undefined
      ? { ...fejlecSeo(nyers, slug), seoKeywords: undefined }
      : {
          seoTitle: kulcsszo.seoTitle,
          seoDescription: kulcsszo.seoDescription,
          seoKeywords: meresToSeoKeywords(kulcsszo),
        }

  // A GYIK-nél SZÁNDÉKOSAN nincs ugyanilyen kemény kényszer, és ez nem
  // következetlenség:
  //
  //  1. A hiányzó SEO-célzásnál a `buildDocMetadata` NÉMÁN visszaesik a cikk
  //     címére és bevezetőjére, tehát a hiba nem látszik. A GYIK-nek nincs
  //     fallbackje: ha nincs tétel, nincs blokk. Ez látható és ártalmatlan.
  //  2. A `posts.faq` nem kötelező mező, a kulcsszó-célzás viszont mind a hat
  //     cikknél megvan, tehát ott a hiány valóban programhiba lenne.
  //  3. A legfontosabb: egészségügyi tartalomnál egy kötelező GYIK arra
  //     nyomna, hogy találjunk ki választ olyan mért kérdésre is, amit a cikk
  //     nem fed le. Pontosan ezt kell elkerülni.
  //
  // Ami viszont VALÓBAN programhiba: a `maxRows` átlépése, mert azt a Payload
  // csak íráskor utasítaná vissza, félig betöltött állapotot hagyva. Ezért a
  // darabszámot itt, a fordításkor ellenőrizzük, a DB-hez érés előtt.
  const faq = faqMezore(slug)
  if (faq !== undefined && (faq.length < GYIK_MIN || faq.length > GYIK_MAX)) {
    throw new Error(
      `A(z) „${slug}” cikk GYIK-je ${faq.length} tételt tartalmaz, a megengedett ` +
        `${GYIK_MIN}–${GYIK_MAX} helyett. A korlátot a Posts kollekció maxRows értéke adja; ` +
        'javítsd a src/lib/tudastar/faq.ts CIKK_GYIK listáját.',
    )
  }

  return {
    slug,
    title,
    excerpt: excerptFrom(lines),
    content,
    szoszam: lines.join(' ').split(/\s+/).filter(Boolean).length,
    ...seo,
    faq,
  }
}

async function slugId(
  payload: Payload,
  collection: 'categories' | 'products' | 'posts',
  slug: string,
): Promise<number | undefined> {
  const talalat = await payload.find({
    collection,
    where: { slug: { equals: slug } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
    ...(collection === 'posts' ? { draft: true } : {}),
  })
  const id = talalat.docs[0]?.id
  return typeof id === 'number' ? id : undefined
}

async function userIdByName(payload: Payload, name: string): Promise<number | undefined> {
  // A Posts.author / reviewedBy mező filterOptions-a (staffOrOwnerUserFilter,
  // src/lib/admin/relationship-filters.ts) óta CSAK staff/owner szerepű user
  // érvényes érték — egy másik szerepű találat a mentéskor „A következő mező
  // érvénytelen: Szerző" hibával dobna, és megakasztaná az egész importot.
  // Ezért itt ugyanazzal a szűréssel keresünk: ami a mezőben érvénytelen
  // lenne, azt meg sem találjuk, csak figyelmeztetünk (lentebb a hívó).
  const talalat = await payload.find({
    collection: 'users',
    where: { name: { equals: name }, role: { in: ['staff', 'owner'] } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  const id = talalat.docs[0]?.id
  if (typeof id === 'number') return id

  const barmilyenSzerep = await payload.find({
    collection: 'users',
    where: { name: { equals: name } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  if (barmilyenSzerep.docs[0] !== undefined) {
    logger.warn(
      'Tudástár-import: a szerző létezik, de nem staff/owner szerepű, ezért a mező üresen marad. ' +
        'Szerep-állítás az adminban (Users → szerep), utána az import újrafuttatható.',
      { nev: name },
    )
  }
  return undefined
}

interface CikkMezok {
  relatedPosts: number[]
  ctaCourse: number | null
  author?: number | null
  reviewedBy?: number | null
}

/**
 * A cikk KATEGÓRIA-mezője: a CIKK_KATEGORIA szerinti egyetlen kategória id-je.
 *
 * A kategória-rekordot IDEMPOTENSEN hozza létre, ha hiányzik (slug szerint
 * párosít, `type: 'content'` — enélkül a blog nem mutatná,
 * `docs/tudastar-hangnem-es-technika.md` 2.3). Meglévő rekord címét nem
 * írja át: a név szerkesztői döntés az adminban.
 *
 * A mező FELÜLÍRÓ (nem csak üres mezőbe tölt), mert a tulajdonosi kérés
 * (2026-09-07) épp az egységesítés: minden cikknek pontosan egy, a tervben
 * rögzített kategóriája legyen. Ismeretlen cikk-slugra a `kategoriaForCikk`
 * dob, tehát kategória nélküli cikk nem íródhat.
 */
async function kategoriaId(payload: Payload, kategoria: TudastarKategoria): Promise<number> {
  const meglevo = await slugId(payload, 'categories', kategoria.slug)
  if (meglevo !== undefined) return meglevo
  const uj = await payload.create({
    collection: 'categories',
    data: { title: kategoria.title, slug: kategoria.slug, type: 'content' },
    overrideAccess: true,
  })
  logger.info('Tudástár-import: kategória létrehozva', {
    kategoria: kategoria.slug,
    cim: kategoria.title,
    id: uj.id,
  })
  return uj.id
}

async function kategoriaMezo(payload: Payload, slug: string): Promise<{ categories: number[] }> {
  const kategoria = kategoriaForCikk(slug)
  return { categories: [await kategoriaId(payload, kategoria)] }
}

/**
 * A 7. és 8. cikk CTA / related / szerző mezői.
 *
 * A Posts kollekciónak nincs `noindex` mezője, ezért hiányzó szerzőnél
 * csak figyelmeztetünk: a meglévő hat cikket nem noindexeljük.
 */
async function cikkMezok(
  payload: Payload,
  slug: string,
): Promise<CikkMezok | Record<string, never>> {
  const meta = CIKK_KIEGESZITO[slug]
  if (meta === undefined) return {}

  let ctaCourse: number | null = null
  if (meta.kurzusSlug !== null) {
    const id = await slugId(payload, 'products', meta.kurzusSlug)
    if (id === undefined) {
      logger.warn('Tudástár-import: kurzus nem található', { slug, kurzus: meta.kurzusSlug })
    } else {
      ctaCourse = id
    }
  }

  const relatedPosts: number[] = []
  for (const kap of meta.kapcsolodoSlugok) {
    if (kap === 'de-quervain-szindroma') {
      throw new Error('A de-quervain-szindroma slug nem kerülhet relatedPosts-ba.')
    }
    const id = await slugId(payload, 'posts', kap)
    if (id === undefined) {
      logger.warn('Tudástár-import: kapcsolódó cikk nem található', { slug, kapcsolodo: kap })
      continue
    }
    relatedPosts.push(id)
  }

  const szerzoIds: number[] = []
  for (const nev of meta.szerzoNevek) {
    const id = await userIdByName(payload, nev)
    if (id === undefined) {
      logger.warn('Tudástár-import: szerző nem található', { slug, szerzo: nev })
      continue
    }
    szerzoIds.push(id)
  }

  const mezok: CikkMezok = {
    relatedPosts,
    ctaCourse,
  }
  // Feloldott szerző hiányában a mezőt EXPLICIT nullázzuk: a #173 (staff/owner
  // filterOptions) óta egy korábban beírt, ma már érvénytelen szerepű user a
  // TÁROLT értékként is elbuktatja a mentést („A következő mező érvénytelen:
  // Szerző") — akkor is, ha az update nem küld szerzőt. A null a rekordot
  // menthetővé teszi; a szerep rendezése után a következő import visszaírja.
  mezok.author = szerzoIds[0] ?? null
  mezok.reviewedBy = meta.tarsszerzos ? null : (szerzoIds[1] ?? null)
  if (szerzoIds.length < meta.szerzoNevek.length) {
    logger.warn(
      'Tudástár-import: a cikk szerzői nem mind oldhatók fel. ' +
        'A Posts kollekciónak nincs noindex mezője, a meglévő hat cikket nem noindexeljük.',
      { slug, megvan: szerzoIds.length, kellett: meta.szerzoNevek.length },
    )
  }
  return mezok
}

/**
 * A hat eredeti cikk `ctaCourse` és `relatedPosts` mezőjének KITÖLTÉSE —
 * kizárólag akkor ír, ha a mező ÜRES (lásd a CIKK_KITOLTES kommentjét).
 * A `de-quervain-szindroma` tiltása itt is érvényes.
 */
async function kitoltesMezok(
  payload: Payload,
  slug: string,
  letezo: { ctaCourse?: unknown; relatedPosts?: unknown } | undefined,
): Promise<Partial<Pick<CikkMezok, 'ctaCourse' | 'relatedPosts'>>> {
  const meta = CIKK_KITOLTES[slug]
  if (meta === undefined) return {}
  const mezok: Partial<Pick<CikkMezok, 'ctaCourse' | 'relatedPosts'>> = {}

  const nincsCta =
    letezo === undefined || letezo.ctaCourse === null || letezo.ctaCourse === undefined
  if (nincsCta) {
    const id = await slugId(payload, 'products', meta.kurzusSlug)
    if (id === undefined) {
      logger.warn('Tudástár-import: kitöltő kurzus nem található', {
        slug,
        kurzus: meta.kurzusSlug,
      })
    } else {
      mezok.ctaCourse = id
    }
  }

  const nincsRelated =
    letezo === undefined || !Array.isArray(letezo.relatedPosts) || letezo.relatedPosts.length === 0
  if (nincsRelated) {
    const relatedPosts: number[] = []
    for (const kap of meta.kapcsolodoSlugok) {
      if (kap === 'de-quervain-szindroma') {
        throw new Error('A de-quervain-szindroma slug nem kerülhet relatedPosts-ba.')
      }
      const id = await slugId(payload, 'posts', kap)
      if (id === undefined) {
        logger.warn('Tudástár-import: kitöltő kapcsolódó cikk nem található', {
          slug,
          kapcsolodo: kap,
        })
        continue
      }
      relatedPosts.push(id)
    }
    if (relatedPosts.length > 0) mezok.relatedPosts = relatedPosts
  }

  return mezok
}

/**
 * A Search-lockolt `pages.seoKeywords` lista slug szerint.
 *
 * Csak meglévő rekordot frissít, és csak a `seoKeywords` mezőt. Új page-et
 * nem hoz létre (A-gyökér / kurzusok pages TILOS). Szándékosan üres locknál
 * nem ír kifejezést. Próbafutásnál (`dryRun`) nem ír.
 */
export async function oldalKulcsszavakatSzinkronizal(
  payload: Payload,
  options: { dryRun: boolean },
): Promise<{ frissitve: number; kihagyva: number; hianyzik: number }> {
  let frissitve = 0
  let kihagyva = 0
  let hianyzik = 0

  for (const slug of Object.keys(OLDAL_KULCSSZAVAK)) {
    const meglevo = await payload.find({
      collection: 'pages',
      where: { slug: { equals: slug } },
      limit: 1,
      depth: 0,
      overrideAccess: true,
      draft: true,
    })
    const letezo = meglevo.docs[0]
    if (!letezo) {
      hianyzik += 1
      logger.info('Tudástár-import: pages kulcsszó — nincs rekord, nem hozunk létre', { slug })
      continue
    }

    const keywords = oldalSeoKeywordsFor(slug)
    if (keywords === undefined) {
      kihagyva += 1
      logger.info('Tudástár-import: pages kulcsszó — szándékosan üres, nem írunk kifejezést', {
        slug,
        id: letezo.id,
      })
      continue
    }

    if (options.dryRun) {
      logger.info('Tudástár-import: pages kulcsszó — PRÓBA, nem írunk', {
        slug,
        id: letezo.id,
        seoKeywords: keywords.map((row) => row.phrase),
      })
      continue
    }

    await payload.update({
      collection: 'pages',
      id: letezo.id,
      data: { seoKeywords: keywords },
      overrideAccess: true,
    })
    frissitve += 1
    logger.info('Tudástár-import: pages kulcsszó frissítve', { slug, id: letezo.id })
  }

  return { frissitve, kihagyva, hianyzik }
}

/**
 * A Search-lockolt `products.seoKeywords` lista slug szerint.
 *
 * Csak meglévő rekordot frissít, és csak a `seoKeywords` mezőt. Új productot
 * nem hoz létre. Szándékosan üres locknál (SOS) nem ír kifejezést.
 * Próbafutásnál (`dryRun`) nem ír.
 */
export async function kurzusKulcsszavakatSzinkronizal(
  payload: Payload,
  options: { dryRun: boolean },
): Promise<{ frissitve: number; kihagyva: number; hianyzik: number }> {
  let frissitve = 0
  let kihagyva = 0
  let hianyzik = 0

  for (const slug of Object.keys(KURZUS_KULCSSZAVAK)) {
    const meglevo = await payload.find({
      collection: 'products',
      where: { slug: { equals: slug } },
      limit: 1,
      depth: 0,
      overrideAccess: true,
      draft: true,
    })
    const letezo = meglevo.docs[0]
    if (!letezo) {
      hianyzik += 1
      logger.info('Tudástár-import: kurzus kulcsszó — nincs rekord, nem hozunk létre', { slug })
      continue
    }

    const keywords = kurzusSeoKeywordsFor(slug)
    if (keywords === undefined) {
      kihagyva += 1
      logger.info('Tudástár-import: kurzus kulcsszó — szándékosan üres, nem írunk kifejezést', {
        slug,
        id: letezo.id,
      })
      continue
    }

    if (options.dryRun) {
      logger.info('Tudástár-import: kurzus kulcsszó — PRÓBA, nem írunk', {
        slug,
        id: letezo.id,
        seoKeywords: keywords.map((row) => row.phrase),
      })
      continue
    }

    await payload.update({
      collection: 'products',
      id: letezo.id,
      data: { seoKeywords: keywords },
      overrideAccess: true,
    })
    frissitve += 1
    logger.info('Tudástár-import: kurzus kulcsszó frissítve', { slug, id: letezo.id })
  }

  return { frissitve, kihagyva, hianyzik }
}

function oldalKulcsszoTervetNaploz(): void {
  for (const [slug, kifejezesek] of Object.entries(OLDAL_KULCSSZAVAK)) {
    logger.info('Tudástár-import: pages kulcsszó terv (próba)', {
      slug,
      seoKeywords: kifejezesek ?? [],
      muvelet:
        kifejezesek !== undefined && kifejezesek.length > 0
          ? 'meglévő rekord seoKeywords frissítése; új page tilos'
          : 'szándékosan üres; ha van rekord, nem írunk kifejezést; új page tilos',
    })
  }
}

function kurzusKulcsszoTervetNaploz(): void {
  for (const [slug, kifejezesek] of Object.entries(KURZUS_KULCSSZAVAK)) {
    logger.info('Tudástár-import: kurzus kulcsszó terv (próba)', {
      slug,
      seoKeywords: kifejezesek ?? [],
      muvelet:
        kifejezesek !== undefined && kifejezesek.length > 0
          ? 'meglévő rekord seoKeywords frissítése; új product tilos'
          : 'szándékosan üres; ha van rekord, nem írunk kifejezést; új product tilos',
    })
  }
}

async function main(): Promise<void> {
  const dryRun = !kapuNyitva('OWNER_TUDASTAR_CONFIRM')
  const publikal = kapuNyitva('OWNER_TUDASTAR_PUBLISH')
  const cikkekDir = path.join(process.cwd(), 'docs', 'cikkek')

  logger.info(
    dryRun
      ? 'Tudástár-import: PRÓBAFUTÁS (OWNER_TUDASTAR_CONFIRM=igen nélkül semmi nem íródik).'
      : `Tudástár-import: ÉLES futás. Célállapot: ${publikal ? 'KÖZZÉTÉVE' : 'piszkozat'}.`,
  )

  // Előbb MIND a listán lévő cikket lefordítjuk, és csak utána írunk. Így egy hibás
  // fájl nem hagy félkész állapotot az adatbázisban.
  const forditott = CIKKEK.map((bejegyzes) => ({
    bejegyzes,
    cikk: cikketFordit(cikkekDir, bejegyzes.fajl, bejegyzes.slug, bejegyzes.seoForras),
  }))
  const allapot = celAllapot(publikal)
  for (const { bejegyzes, cikk } of forditott) {
    logger.info('Tudástár-import: lefordítva', {
      slug: cikk.slug,
      cim: cikk.title,
      kategoria: kategoriaForCikk(cikk.slug).slug,
      szoszam: cikk.szoszam,
      seoTitle: cikk.seoTitle,
      seoForras: bejegyzes.seoForras ?? 'meres',
      gyikTetelek: cikk.faq?.length ?? 0,
      allapot,
      muvelet:
        allapot === 'published'
          ? 'létrehozná vagy frissítené közzétéve'
          : 'létrehozná vagy frissítené piszkozatként',
    })
    if (cikk.faq === undefined) {
      logger.warn(
        'Tudástár-import: ehhez a cikkhez nincs GYIK, a faq mezőhöz nem nyúlunk. ' +
          'Ha kell, a src/lib/tudastar/faq.ts CIKK_GYIK listájába vedd fel, MÉRT kérdésekből, ' +
          'a cikk törzsében benne lévő válasszal.',
        { slug: cikk.slug },
      )
    }
  }

  if (dryRun) {
    oldalKulcsszoTervetNaploz()
    kurzusKulcsszoTervetNaploz()
    logger.info(
      `Tudástár-import: a próbafutás rendben, ${forditott.length} cikk fordult le hibátlanul. ` +
        'Íráshoz: OWNER_TUDASTAR_CONFIRM=igen. Pages és products seoKeywords csak meglévő rekordon; ' +
        'új page/product tilos.',
    )
    return
  }

  const payload: Payload = await getPayload({ config })
  let letrehozva = 0
  let frissitve = 0

  for (const { cikk } of forditott) {
    const meglevo = await payload.find({
      collection: 'posts',
      where: { slug: { equals: cikk.slug } },
      limit: 1,
      depth: 0,
      overrideAccess: true,
      draft: true,
    })

    const letezo = meglevo.docs[0]

    const adat = {
      title: cikk.title,
      slug: cikk.slug,
      excerpt: cikk.excerpt,
      content: cikk.content,
      seoTitle: cikk.seoTitle,
      seoDescription: cikk.seoDescription,
      // A mért kifejezéslista csak akkor kerül a payloadba, ha van mérés; a
      // cikkfejlécből töltött cikknél a kulcs KIMARAD, hogy egy adminban
      // kézzel felvett listát ne töröljön le a betöltő (ugyanaz az elv, mint a
      // GYIK-nél lentebb).
      ...(cikk.seoKeywords === undefined ? {} : { seoKeywords: cikk.seoKeywords }),
      // Mindkét állapotmezőt kiírjuk, ahogy a `seed.ts` és a
      // `restore-legacy-content.ts` is teszi: a `_status` a Payload technikai
      // verzió-állapota, a `status` pedig a nyilvános szűrők (PUBLISHED_WHERE,
      // sitemap) mezője. A `syncStatusFromDraftStatus` hook amúgy is
      // összehangolja őket, de a Payload típusa a teljes dokumentumot kéri,
      // és így nem kell literál `draft: true` paramétert adni.
      status: allapot,
      _status: allapot,
      // A GYIK csak akkor kerül a payloadba, ha van mit írni. Ha a slughoz
      // nincs tétel, a kulcs KIMARAD, így egy adminban kézzel felvett GYIK-et
      // nem töröl le egy olyan modul, amelynek épp nincs mondanivalója. Ahol
      // viszont van tétel, ott a faq.ts az igazság forrása, ugyanúgy, ahogy a
      // törzsnél a markdown: a script felülírja a kézi szerkesztést.
      ...(cikk.faq === undefined ? {} : { faq: cikk.faq }),
      // Mind a nyolc cikk PONTOSAN EGY kategóriát kap (tartalmi terv 3.,
      // tulajdonosi egységesítés-kérés 2026-09-07); a rekord hiányában a
      // kategória létrejön.
      ...(await kategoriaMezo(payload, cikk.slug)),
      ...(await cikkMezok(payload, cikk.slug)),
      // A hat eredeti cikk üres ctaCourse/relatedPosts mezőjének kitöltése —
      // meglévő szerkesztői értéket sosem ír felül (CIKK_KITOLTES).
      ...(await kitoltesMezok(payload, cikk.slug, letezo)),
    }

    if (letezo) {
      await payload.update({
        collection: 'posts',
        id: letezo.id,
        data: adat,
        overrideAccess: true,
      })
      frissitve += 1
      logger.info('Tudástár-import: frissítve', { slug: cikk.slug, id: letezo.id, allapot })
    } else {
      const uj = await payload.create({
        collection: 'posts',
        data: adat,
        overrideAccess: true,
      })
      letrehozva += 1
      logger.info('Tudástár-import: létrehozva', { slug: cikk.slug, id: uj.id, allapot })
    }
  }

  const oldal = await oldalKulcsszavakatSzinkronizal(payload, { dryRun: false })
  const kurzus = await kurzusKulcsszavakatSzinkronizal(payload, { dryRun: false })

  logger.info('Tudástár-import: kész.', {
    letrehozva,
    frissitve,
    allapot,
    cikkfejlecSeo: forditott
      .filter(({ bejegyzes }) => bejegyzes.seoForras === 'cikkfejlec')
      .map(({ cikk }) => cikk.slug),
    gyikTetelek: forditott.reduce((osszeg, { cikk }) => osszeg + (cikk.faq?.length ?? 0), 0),
    oldalKulcsszoFrissitve: oldal.frissitve,
    oldalKulcsszoKihagyva: oldal.kihagyva,
    oldalKulcsszoHianyzik: oldal.hianyzik,
    kurzusKulcsszoFrissitve: kurzus.frissitve,
    kurzusKulcsszoKihagyva: kurzus.kihagyva,
    kurzusKulcsszoHianyzik: kurzus.hianyzik,
  })
}

const kozvetlenul =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (kozvetlenul) {
  main()
    .then(() => {
      process.exit(0)
    })
    .catch((error: unknown) => {
      logger.error('Tudástár-import: hiba történt.', {
        error: error instanceof Error ? error.message : String(error),
      })
      process.exit(1)
    })
}
