import { HOME_PAGE_SLUG, SZAKEMBEREKNEK_PAGE_SLUG } from '../content-slugs'
import { HUB_OLDALAK, type HubOldal } from '../tudastar/hub-oldalak'

/**
 * Kódhoz kötött webcímek (modul-térkép H48) és az Oldalak „Mi ez” oszlopa
 * (H05): melyik webcímre épít a weboldal kódja, és mi történik, ha a
 * szerkesztő átírja.
 *
 * Tiszta modul (React és Payload nélkül), mert az admin kliens-komponensei
 * (KotottWebcimNotice, PageKindCell, HubPageNotice) és a gyűjtemény-konfig
 * is ezt használja. A jogi webcímek listája ezért literál: a
 * src/lib/legal-content.ts node-importos (fájlrendszerből olvas), a kliensbe
 * nem húzható be. A kotott-cimek.test.ts veti össze a JOGI_OLDALAK
 * slugjaival, az időpontkérős blogbejegyzéseket az APPOINTMENT_CTA_SLUGS
 * exportjával, és minden „mi épít rá” állítást a hivatkozott forrássorral.
 *
 * Minden állítás a kódból jön (a teszt köti őket a sorokhoz):
 * - kezdőlap: a `/` a `kezdolap` webcímű oldalt tölti (src/lib/cms.ts
 *   getHomePage, HOME_PAGE_SLUG). Ha nincs ilyen, a HomeView a beépített
 *   tartalék-kezdőlapot rajzolja. Az onInit (src/payload.config.ts
 *   ensureHomeBaseline → src/lib/home-seed.ts
 *   ensureHomeLayoutFrissTelepitesen) csak teljesen üres Oldalak-gyűjteménynél
 *   hoz létre kezdőlapot, webcímváltás után tehát NEM jön létre új;
 * - Kapcsolat: a /kapcsolat route a `kapcsolat` webcímű oldal szekcióit
 *   rajzolja (kapcsolat/page.tsx), oldal nélkül csak a „Kapcsolat” címet; a
 *   blogbejegyzések végi időpontkérő gombja ide visz (PostCourseCta.tsx
 *   APPOINTMENT_HREF);
 * - jogi oldalak: a lábléc (Footer.tsx FOOTER_LEGAL_LINKS), a hibaoldal
 *   (global-not-found.tsx), a pénztár (CheckoutForm.tsx), a sütisáv és az
 *   űrlapok hozzájárulás-szövegei ezekre a címekre linkelnek;
 * - Tudástár-hub: a HUB_OLDALAK párosítja az Oldal webcímét a blogbejegyzés
 *   webcímével ([slug]/page.tsx, blog/[slug]/page.tsx hubraIranyit);
 * - időpontkérős blogbejegyzés: a cikk végi ajánló változatát a webcím dönti
 *   el (post-article.ts APPOINTMENT_CTA_SLUGS, postCtaVariantOf).
 *
 * Az automatikus mentés a webcím átírását csak piszkozatként írja (a fő
 * dokumentum és a nyilvános lap változatlan), a weboldal a közzétételkor vált
 * az új címre. Mérve 2026-09-23-án a helyi példányon, eldobható, közzétett
 * oldalon (a végén törölve): a Webcím mező átírása után az automatikus mentés
 * (PATCH …?autosave=true&draft=true, 200) után a régi cím 200, az új 404, a
 * fő tábla slugja a régi; a „Módosítások közzététele” után a régi cím 404, az
 * új 200. A core-sort (payload/dist/collections/operations/utilities/
 * update.js: `if (!isSavingDraft) { … db.updateOne`) teszt köti.
 */

/**
 * A határozott névelő („a” vagy „az”) egy utána álló webcím, cím vagy szám
 * elé, a kiejtett első hang szerint: magánhangzó előtt „az”, mássalhangzó
 * előtt „a”; a számnál a kiejtett alak dönt („az 5”, „a 10”, „az 1000”). A
 * bevezető „/”, idézőjel és zárójel nem számít. A mérés (2026-09-23) a
 * sablonos „a „aszf” webcímre” alakot találta, ezt javítja.
 */
export function nevelo(szo: string): 'a' | 'az' {
  const t = szo.replace(/^[\s/„"'(»]+/u, '')
  const szam = /^\d+/.exec(t)
  if (szam) {
    const n = Number(szam[0])
    const az =
      n === 1 ||
      n === 5 ||
      (n >= 50 && n <= 59) ||
      (n >= 500 && n <= 599) ||
      (n >= 1000 && n <= 1999) ||
      (n >= 5000 && n <= 5999)
    return az ? 'az' : 'a'
  }
  return /^[aáeéiíoóöőuúüű]/iu.test(t) ? 'az' : 'a'
}

/** Mondat eleji alak: „A” vagy „Az”. */
export function Nevelo(szo: string): 'A' | 'Az' {
  return nevelo(szo) === 'az' ? 'Az' : 'A'
}

export type Gyujtemeny = 'pages' | 'posts'

export const KAPCSOLAT_WEBCIM = 'kapcsolat'

/** A három jogi oldal webcíme (literál; a teszt a JOGI_OLDALAK-hoz köti). */
export const JOGI_WEBCIMEK: readonly string[] = ['aszf', 'adatvedelem', 'impresszum']

/**
 * A blogbejegyzések, amelyek végén kurzus helyett időpontkérés áll (literál;
 * a teszt a post-article.ts APPOINTMENT_CTA_SLUGS exportjához köti).
 */
export const IDOPONTKEROS_BLOGBEJEGYZESEK: readonly string[] = [
  'befagyott-vall',
  'peace-and-love-friss-serules',
  'gipszben-a-kezed',
]

/** Az Oldalak „Mi ez” oszlopának értékei. */
export type OldalFajta = 'kezdolap' | 'kapcsolat' | 'jogi' | 'hub' | 'aloldal'

export const OLDAL_FAJTA_FELIRAT: Readonly<Record<OldalFajta, string>> = {
  kezdolap: 'Kezdőlap (/)',
  kapcsolat: 'Kapcsolat oldal',
  jogi: 'Jogi oldal',
  hub: 'Tudástár-cikk tükre',
  aloldal: 'Aloldal',
}

/** A „Mi ez” oszlop fejléce (a ui-mező címkéje). */
export const OLDAL_FAJTA_OSZLOP = 'Mi ez'

function webcimSzoveg(slug: unknown): string | null {
  return typeof slug === 'string' && slug.trim().length > 0 ? slug.trim() : null
}

/** Az Oldal webcíméhez tartozó Tudástár-hub, vagy null. */
export function hubOldalbol(slug: unknown): HubOldal | null {
  const webcim = webcimSzoveg(slug)
  return HUB_OLDALAK.find((hub) => hub.slug === webcim) ?? null
}

/** A blogbejegyzés webcíméhez tartozó Tudástár-hub, vagy null. */
export function hubBlogbejegyzesbol(slug: unknown): HubOldal | null {
  const webcim = webcimSzoveg(slug)
  return HUB_OLDALAK.find((hub) => hub.cikkSlug === webcim) ?? null
}

/** Az oldal fajtája a webcíméből (a „Mi ez” oszlop és a tájékoztatók közös forrása). */
export function oldalFajta(slug: unknown): OldalFajta {
  const webcim = webcimSzoveg(slug)
  if (webcim === HOME_PAGE_SLUG) return 'kezdolap'
  if (webcim === KAPCSOLAT_WEBCIM) return 'kapcsolat'
  if (webcim !== null && JOGI_WEBCIMEK.includes(webcim)) return 'jogi'
  if (hubOldalbol(webcim) !== null) return 'hub'
  return 'aloldal'
}

export function oldalFajtaFelirat(slug: unknown): string {
  return OLDAL_FAJTA_FELIRAT[oldalFajta(slug)]
}

/**
 * A közzététel visszavonásának menüpontja az admin dokumentum-nézetének „⋯”
 * menüjében (@payloadcms/ui UnpublishButton: `t('version:unpublish')`,
 * elements/UnpublishButton/index.js:173; a menüt a DocumentControls rajzolja,
 * :310-311). A src/lib/admin/hu-forditas.ts ezt a kulcsot nem írja felül, így
 * a felület a Payload magyar nyelvfájljának értékét mutatja
 * (@payloadcms/translations hu `version.unpublish`). Literál, mert ez a modul a
 * kliensbe is bekerül; a kotott-oldal-visszavonas.test.ts a ténylegesen
 * érvényes fordításhoz köti (a hu-forditas.ts rá fésülve), betűre.
 */
export const VISSZAVONAS_GOMB = 'Közzététel visszavonása'

/** Mire épít a kód, és mi történik az átírás, a közzététel és a visszavonás után. */
export interface KotottWebcim {
  /** Mondatok: mi épít erre a webcímre. */
  mire: string[]
  /** Mondatok: mi történik, ha átírják és közzéteszik. */
  kovetkezmeny: string[]
  /**
   * Egy mondat: mi történik a látogató oldalán, ha a közzétételt visszavonják
   * (modul-térkép H48/6). Az Állapot mező rejtett (Pages.ts `status`,
   * `hidden: true`), ezért a visszavonás hatásáról csak ez a mondat szól.
   */
  visszavonas: string
}

/**
 * A visszavonás mondatai. Az állítások forrása (a kotott-oldal-visszavonas.test.ts
 * köti őket a sorokhoz):
 * - a visszavonás a FŐ dokumentum `_status`-át írja piszkozatra (UnpublishButton
 *   PATCH `{ _status: 'draft' }`, `draft` kapcsoló nélkül, index.js:103-107), a
 *   rejtett `status` ebből szinkronizálódik (publish-status.ts
 *   syncStatusFromDraftStatus), a weboldal pedig csak `status: published`
 *   rekordot olvas (cms.ts PUBLISHED_WHERE, getHomePage, getPageBySlug,
 *   getPostBySlug);
 * - kezdőlap: a getHomePage null-t ad, a HomeView az üres szekciósorral a
 *   beépített kezdőlapot rajzolja (HomeView.tsx `presentHomeLayout(home?.layout
 *   ?? [])`). Új kezdőlap NEM jön létre: az induláskori seed
 *   (home-seed.ts ensureHomeLayoutFrissTelepitesen) csak teljesen üres
 *   Oldalak-gyűjteménynél ír;
 * - Kapcsolat: a /kapcsolat route nem ad hibát, oldal nélkül a „Kapcsolat”
 *   címet rajzolja szekciók nélkül (kapcsolat/page.tsx:66 contactHeading,
 *   :129 rawLayout, :170 `layout.length > 0`); a blogbejegyzések végi
 *   időpontkérő gombja ide visz (PostCourseCta.tsx APPOINTMENT_HREF);
 * - jogi oldal és Tudástár-hub: a [slug] route oldal nélkül notFound()
 *   ([slug]/page.tsx:126-127), a lábléc és a pénztár linkje ettől még ide
 *   mutat (Footer.tsx FOOTER_LEGAL_LINKS, CheckoutForm.tsx TERMS_ASZF_PATH);
 * - hub: a /blog/<cikk> csak közzétett hub-oldalnál irányít át
 *   (blog/[slug]/page.tsx hubraIranyit, hub-oldalak.ts hubAtiranyitasCel),
 *   így visszavonás után a blogbejegyzés újra a saját címén látszik, ha az
 *   közzé van téve;
 * - hub-blogbejegyzés: a hub-oldal a pár blogbejegyzést csak közzétettként
 *   kéri ([slug]/page.tsx hubPostOf → getPostBySlug), nélküle az oldal saját
 *   mezőit rajzolja; a /blog/<cikk> közzétett hubnál átirányít, különben
 *   notFound() (blog/[slug]/page.tsx:86-88);
 * - időpontkérős blogbejegyzés: a /blog/<webcím> notFound() (uo. :87-88).
 */
const VISSZAVONAS_UTAN = `A „${VISSZAVONAS_GOMB}” után`

const JOGI_LINKEK: Readonly<Record<string, string>> = {
  aszf: 'A lábléc, a hibaoldal és a pénztár linkje erre a webcímre mutat.',
  adatvedelem:
    'A lábléc, a hibaoldal, a pénztár, a sütisáv és az űrlapok adatkezelési linkje erre a webcímre mutat.',
  impresszum: 'A lábléc és a hibaoldal linkje erre a webcímre mutat.',
}

function oldalKotes(webcim: string): KotottWebcim | null {
  if (webcim === HOME_PAGE_SLUG) {
    return {
      mire: ['A kezdőlap (/) ezt az oldalt tölti be.'],
      kovetkezmeny: [
        'Ha átírod és közzéteszed, a kezdőlapon a weboldal beépített tartalék-kezdőlapja jelenik meg, és ez így marad, amíg a webcímet vissza nem írod „kezdolap”-ra.',
      ],
      visszavonas: `${VISSZAVONAS_UTAN} a kezdőlapon (/) a weboldal beépített tartalék-kezdőlapja jelenik meg, új kezdőlap nem jön létre, és az újbóli közzététellel ismét ez az oldal látszik.`,
    }
  }
  if (webcim === KAPCSOLAT_WEBCIM) {
    return {
      mire: [
        'A /kapcsolat cím ennek az oldalnak a szekcióit mutatja, és a blogbejegyzések végén álló időpontkérő gomb is ide visz.',
      ],
      kovetkezmeny: [
        'Ha átírod és közzéteszed, a /kapcsolat címen csak a „Kapcsolat” cím marad, szekciók nélkül; a szekciók az új webcímen jelennek meg.',
      ],
      visszavonas: `${VISSZAVONAS_UTAN} a /kapcsolat címen csak a „Kapcsolat” cím marad, szekciók nélkül, és a blogbejegyzések végi időpontkérő gomb is erre a lapra visz.`,
    }
  }
  if (webcim === SZAKEMBEREKNEK_PAGE_SLUG) {
    // A7 (H11): a dedikált /szakembereknek route ezt a rekordot tölti; rekord
    // nélkül a route kódtartaléka áll (szakembereknek/page.tsx).
    return {
      mire: ['A /szakembereknek cím ennek az oldalnak a címét, bevezetőjét és szekcióit mutatja.'],
      kovetkezmeny: [
        'Ha átírod és közzéteszed, a /szakembereknek címen a weboldal beépített tartalék-tartalma jelenik meg, ez az oldal pedig az új webcímen.',
      ],
      visszavonas: `${VISSZAVONAS_UTAN} a /szakembereknek címen a weboldal beépített tartalék-tartalma jelenik meg, és az újbóli közzététellel ismét ez az oldal látszik.`,
    }
  }
  const jogi = JOGI_LINKEK[webcim]
  if (jogi !== undefined) {
    return {
      // A linkfeliratok kódban rögzítettek (Footer.tsx FOOTER_LEGAL_LINKS, a
      // pénztár és a hibaoldal; őr: jogi-linkfeliratok.test.ts), a Cím mező
      // tehát csak magán a lapon hat. A2 kérése, H18.
      mire: [
        jogi,
        'Ezeknek a linkeknek a felirata rögzített: ha a Címet átírod, az csak ezen a lapon látszik, a linkeken nem.',
      ],
      kovetkezmeny: [
        'Ha átírod és közzéteszed, ezek a linkek „az oldal nem található” hibaoldalra visznek.',
      ],
      visszavonas: `${VISSZAVONAS_UTAN} ${nevelo(webcim)} /${webcim} cím „az oldal nem található” hibát ad, és ezek a linkek is oda visznek.`,
    }
  }
  const hub = hubOldalbol(webcim)
  if (hub !== null) {
    return {
      mire: [
        `${Nevelo(hub.slug)} /${hub.slug} címen a /blog/${hub.cikkSlug} blogbejegyzés jelenik meg, és amíg ez az oldal közzé van téve, a /blog/${hub.cikkSlug} cím ide irányít át.`,
      ],
      kovetkezmeny: [
        `Ha átírod és közzéteszed, ${nevelo(hub.slug)} /${hub.slug} cím „az oldal nem található” hibát ad, a blogbejegyzés visszakerül a /blog/${hub.cikkSlug} címre, az új webcímen pedig ennek az oldalnak a saját mezői látszanak, a blogbejegyzés nélkül.`,
      ],
      visszavonas: `${VISSZAVONAS_UTAN} ${nevelo(hub.slug)} /${hub.slug} cím „az oldal nem található” hibát ad, a blogbejegyzés pedig, ha közzé van téve, újra a /blog/${hub.cikkSlug} címen jelenik meg.`,
    }
  }
  return null
}

function blogbejegyzesKotes(webcim: string): KotottWebcim | null {
  const mire: string[] = []
  const kovetkezmeny: string[] = []
  let visszavonas: string | null = null
  const hub = hubBlogbejegyzesbol(webcim)
  if (hub !== null) {
    mire.push(
      `Az Oldalak között ${nevelo(hub.slug)} /${hub.slug} webcímű oldal ezt a blogbejegyzést mutatja, amikor közzé van téve.`,
    )
    kovetkezmeny.push(
      `Ha átírod és közzéteszed, ${nevelo(hub.slug)} /${hub.slug} oldalon a blogbejegyzés helyett az ottani oldal saját mezői jelennek meg, a blogbejegyzés pedig az új /blog/… címre költözik.`,
    )
    visszavonas = `${VISSZAVONAS_UTAN} a /blog/${webcim} cím nem mutatja többé a blogbejegyzést, ${nevelo(hub.slug)} /${hub.slug} oldalon pedig, ha az közzé van téve, a blogbejegyzés helyett az oldal saját mezői jelennek meg.`
  }
  if (IDOPONTKEROS_BLOGBEJEGYZESEK.includes(webcim)) {
    mire.push('A lap végén kurzusajánló helyett időpontkérés áll, ezt a webcím dönti el.')
    kovetkezmeny.push(
      'Ha átírod és közzéteszed, a lap végén az időpontkérés helyett a kurzusajánló jelenik meg.',
    )
    // A hub-pár mondata (fent) az időpontkérős hub-bejegyzésre is igaz, és többet mond.
    visszavonas ??= `${VISSZAVONAS_UTAN} a /blog/${webcim} cím „az oldal nem található” hibát ad.`
  }
  return mire.length > 0 && visszavonas !== null ? { mire, kovetkezmeny, visszavonas } : null
}

/** A webcím kódhoz kötött-e, és ha igen, mire épít a kód. Egyébként null. */
export function kotottWebcim(gyujtemeny: unknown, slug: unknown): KotottWebcim | null {
  const webcim = webcimSzoveg(slug)
  if (webcim === null) return null
  if (gyujtemeny === 'pages') return oldalKotes(webcim)
  if (gyujtemeny === 'posts') return blogbejegyzesKotes(webcim)
  return null
}

/** Az összes kötött webcím gyűjteményenként (a teszt és a doksi felsorolása). */
export function kotottWebcimek(gyujtemeny: Gyujtemeny): string[] {
  if (gyujtemeny === 'pages') {
    return [
      HOME_PAGE_SLUG,
      KAPCSOLAT_WEBCIM,
      SZAKEMBEREKNEK_PAGE_SLUG,
      ...JOGI_WEBCIMEK,
      ...HUB_OLDALAK.map((hub) => hub.slug),
    ]
  }
  return [...new Set([...HUB_OLDALAK.map((hub) => hub.cikkSlug), ...IDOPONTKEROS_BLOGBEJEGYZESEK])]
}
