import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it, vi } from 'vitest'

import { pageBlocks } from '../blocks'
import { CSAPATFOTO_FRIZ_JELZES, FRIZ_NEM_LATSZIK_JELZES } from '../blocks/about'
import { KEP_CSERE_SUGO } from '../blocks/kep-csere'
import { SECTION_SETTINGS_LABEL } from '../blocks/section-settings'
import {
  ADMIN_NAV_CSOPORTOK,
  SZERKESZTO_NEZET_LINK,
  UJ_LAPON,
} from '../components/admin/AdminNavLinks'
import { ADMIN_UTAK } from '../components/admin/KezdolapCel'
import {
  CROSS_SELL_HEADING,
  CROSS_SELL_LEAD,
  CROSS_SELL_LEAD_WITH_PRICE,
  RELATED_COURSES_HEADING,
} from '../components/courses/RelatedCourses'
import {
  SZERKESZTO_NEZET_FELIRAT,
  SZERKESZTO_NEZET_SZOVEG,
} from '../components/editor/frontend/SzerkesztoNezetBelepo'
import {
  ARLISTA_NEM_ISMERHETO,
  HUB_BEJEGYZES_FELIRAT,
  HUB_OLDAL_FELIRAT,
  OLDAL_CIMKE_ELOTAG,
  SZERKESZTEM_FELIRAT,
} from '../components/editor/frontend/szerkeszto-szalag'
import { PREVIEW_BAR_SZOVEG, VISSZA_A_SZERKESZTOBE } from '../components/preview/PreviewBar'
import { ARLISTA_FORMAI_SZABALYOK, arlistaSzabalySzoveg } from '../lib/admin/arlista-szabalyok'
import { kotottWebcim, VISSZAVONAS_GOMB } from '../lib/admin/kotott-cimek'
import {
  HASONLO_BEVEZETO,
  HASONLO_TEENDO,
  KEP_TEENDO,
  SZOVEG_TEENDO,
} from '../lib/admin/szekcio-masolatok'
import {
  IKER_LINK_ELOTAG,
  LAP_TETEJE_MAGYARAZAT,
  MEGNEZEM_FELIRAT,
  REJTETT_CIM,
  REJTETT_MAGYARAZAT,
  UGRAS_FELIRAT,
} from '../lib/section-row-label'
import { ADMIN_GROUP_DISPLAY_NAMES } from '../plugins/admin-groups'

// Az AdminNavLinks kliens-komponens is (useAuth, usePathname); a teszt csak az
// exportált állandóit olvassa, ezért a két kliens-hookot csonkkal pótoljuk.
vi.mock('@payloadcms/ui', () => ({
  useAuth: () => ({ user: null }),
  useConfig: () => ({ config: { routes: { admin: '/admin', api: '/api' } } }),
}))
vi.mock('next/navigation', () => ({ usePathname: () => null }))

/**
 * Dokumentum-őr a szerkesztői útmutatóhoz és a „Mi hol szerkeszthető”
 * táblázathoz (modul-térkép H42, H37, H47, H29, H40; B20).
 *
 * A két dokumentum a felület feliratait betűre idézi (W3C ATAG 2.0 A.4.2.2
 * Document All Features: https://www.w3.org/TR/ATAG20/#sc_a422; WCAG 2.2
 * SC 3.2.4 Consistent Identification:
 * https://www.w3.org/WAI/WCAG22/Understanding/consistent-identification.html).
 * Ha egy felirat a kódban átíródik, vagy a dokumentumból kikerül, ez a teszt
 * bukik, így a dokumentáció nem avul el csendben.
 *
 * A dokumentumok kézzel tördeltek, ezért az összevetés előtt minden
 * szóköz-sorozat (sortörés, behúzás) egy szóközzé válik.
 */

const olvas = (relativ: string): string =>
  readFileSync(fileURLToPath(new URL(relativ, import.meta.url)), 'utf8')

const egySorba = (szoveg: string): string => szoveg.replace(/\s+/g, ' ')

const UTMUTATO = egySorba(olvas('../../docs/szerkesztoi-utmutato.md'))
const TABLAZAT = egySorba(olvas('../../docs/mi-hol-szerkesztheto.md'))
const MINDKETTO = `${UTMUTATO} ${TABLAZAT}`

/** Egy forrásfájl szövege az src mappához képest. */
const forras = (utvonal: string): string => olvas(`../${utvonal}`)

/**
 * Tartalmazás-ellenőrzés rövid hibaüzenettel: bukáskor csak a hiányzó részt
 * írja ki, nem a több száz soros dokumentumot.
 */
function vanBenne(szoveg: string, resz: string): void {
  expect(resz.length, 'üres keresett szöveg').toBeGreaterThan(0)
  expect(szoveg.includes(resz), `hiányzik: „${resz}”`).toBe(true)
}

describe('szerkesztői útmutató: a felület feliratai betűre', () => {
  it.each([
    ['MEGNEZEM_FELIRAT', MEGNEZEM_FELIRAT],
    ['UGRAS_FELIRAT', UGRAS_FELIRAT],
    ['SZERKESZTO_NEZET_FELIRAT', SZERKESZTO_NEZET_FELIRAT],
    ['HASONLO_BEVEZETO', HASONLO_BEVEZETO],
    ['KEP_CSERE_SUGO', KEP_CSERE_SUGO],
    ['RELATED_COURSES_HEADING', RELATED_COURSES_HEADING],
    ['CROSS_SELL_HEADING', CROSS_SELL_HEADING],
    ['IKER_LINK_ELOTAG („A látható párja”)', IKER_LINK_ELOTAG],
  ])('%s szerepel az útmutatóban vagy a táblázatban', (_nev, felirat) => {
    vanBenne(MINDKETTO, egySorba(felirat))
  })

  it('az ikerlink előtagja „A látható párja”, és az útmutató a teljes alakot idézi', () => {
    expect(IKER_LINK_ELOTAG.startsWith('A látható párja')).toBe(true)
    vanBenne(UTMUTATO, `${IKER_LINK_ELOTAG} 02 · `)
  })

  it('az ARLISTA_FORMAI_SZABALYOK minden eleme betűre szerepel', () => {
    expect(ARLISTA_FORMAI_SZABALYOK.length).toBeGreaterThan(0)
    for (const szabaly of ARLISTA_FORMAI_SZABALYOK) {
      vanBenne(UTMUTATO, egySorba(szabaly))
    }
  })

  it('a 18. fejezet az arlistaSzabalySzoveg() mondatait idézi, a bevezetőtől a zárásig', () => {
    const szoveg = arlistaSzabalySzoveg()
    const utolsoSzabaly = ARLISTA_FORMAI_SZABALYOK.at(-1) ?? ''
    // Bevezető: az „1. ” előtti mondat; zárás: az utolsó szabály utáni mondat.
    const elso = szoveg.slice(0, szoveg.indexOf(' 1. ')).trim()
    const utolso = szoveg.slice(szoveg.lastIndexOf(utolsoSzabaly) + utolsoSzabaly.length).trim()
    expect(elso.endsWith('.'), 'a bevezető ponttal zárul, nem kettősponttal').toBe(true)
    expect(utolso.length).toBeGreaterThan(0)
    vanBenne(UTMUTATO, elso)
    vanBenne(UTMUTATO, utolso)
    // A számozott lista a markdownban is 1., 2., … sorrendben áll, így a
    // szóköz-normalizált dokumentum az egész szöveget betűre tartalmazza.
    vanBenne(UTMUTATO, egySorba(szoveg))
  })

  it('a mélylink-folyamat feliratai és üzenetei betűre szerepelnek', () => {
    for (const felirat of [
      SZERKESZTO_NEZET_SZOVEG,
      PREVIEW_BAR_SZOVEG,
      VISSZA_A_SZERKESZTOBE,
      SZERKESZTEM_FELIRAT,
      OLDAL_CIMKE_ELOTAG,
      HUB_BEJEGYZES_FELIRAT,
      HUB_OLDAL_FELIRAT,
      REJTETT_CIM,
      REJTETT_MAGYARAZAT,
      LAP_TETEJE_MAGYARAZAT,
      ARLISTA_NEM_ISMERHETO,
      HASONLO_TEENDO,
      SZOVEG_TEENDO,
      KEP_TEENDO,
      ADMIN_UTAK.videoSzovegei.felirat,
    ]) {
      vanBenne(UTMUTATO, egySorba(felirat))
    }
  })

  it('az oldalsáv Szerkesztő nézet linkje: „Szerkesztő nézet (új lapon)”, a Leggyakrabban használt csoportban', () => {
    const felirat = `${SZERKESZTO_NEZET_LINK.felirat} ${UJ_LAPON}`
    expect(felirat).toBe('Szerkesztő nézet (új lapon)')
    expect(SZERKESZTO_NEZET_LINK.felirat).toBe(SZERKESZTO_NEZET_FELIRAT)
    // A dokumentum azt állítja, hogy a link mindig a kezdőlap piszkozatát nyitja.
    expect(SZERKESZTO_NEZET_LINK.href).toBe('/next/preview?collection=pages&slug=kezdolap')
    const leggyakrabban = ADMIN_NAV_CSOPORTOK.find(
      (csoport) => csoport.cim === 'Leggyakrabban használt',
    )
    expect(leggyakrabban?.linkek).toContain(SZERKESZTO_NEZET_LINK)
    for (const dokumentum of [UTMUTATO, TABLAZAT]) {
      vanBenne(dokumentum, `Leggyakrabban használt → ${felirat}`)
    }
    vanBenne(UTMUTATO, `Kezdőlap, Kezdőlapi videó szövegei, ${felirat}`)
  })

  it('a szekció-megnyitó üzenetei a kódban vannak, ahogy az útmutató idézi', () => {
    const megnyito = forras('components/editor/admin/SzekcioMegnyito.tsx')
    for (const szoveg of ['A hivatkozott szekció nincs ezen a lapon', "'Bezárás'", 'Megnyitva: ']) {
      vanBenne(megnyito, szoveg)
    }
    vanBenne(UTMUTATO, 'A hivatkozott szekció nincs ezen a lapon')
    vanBenne(UTMUTATO, '**Bezárás**')
    vanBenne(UTMUTATO, '„Megnyitva:”')
  })

  it('a kapcsolódó kurzusok bevezetője és az akciós sablon három felirata betűre szerepel', () => {
    vanBenne(UTMUTATO, CROSS_SELL_LEAD_WITH_PRICE)
    vanBenne(UTMUTATO, CROSS_SELL_LEAD.split('. ')[1] ?? CROSS_SELL_LEAD)
    const akcios: ReadonlyArray<readonly [string, string]> = [
      ['components/courses/promo/PromoHero.tsx', 'Akciós ár'],
      ['components/courses/promo/PromoHighlights.tsx', 'A kurzus fő előnyei'],
      ['components/courses/promo/PromoClosingCta.tsx', 'Kezdd el az akciós áron'],
    ]
    for (const [fajl, felirat] of akcios) {
      vanBenne(forras(fajl), felirat)
      vanBenne(UTMUTATO, `„${felirat}”`)
    }
  })

  it('a menü- és blokknevek a mai admin-konfigurációval egyeznek', () => {
    for (const nev of Object.values(ADMIN_GROUP_DISPLAY_NAMES)) {
      vanBenne(UTMUTATO, nev)
    }
    const navLinkek = forras('components/admin/AdminNavLinks.tsx')
    for (const csoport of ['Leggyakrabban használt', 'Kimutatások és kurzusvideók']) {
      vanBenne(navLinkek, `cim: '${csoport}'`)
      vanBenne(UTMUTATO, csoport)
    }
    for (const ut of [ADMIN_UTAK.kezdolap.felirat, ADMIN_UTAK.videoSzovegei.felirat]) {
      vanBenne(TABLAZAT, ut)
    }
    vanBenne(UTMUTATO, SECTION_SETTINGS_LABEL)
    vanBenne(TABLAZAT, SECTION_SETTINGS_LABEL)

    const blokkNevek = new Set(
      pageBlocks.map((blokk) =>
        typeof blokk.labels?.singular === 'string' ? blokk.labels.singular : '',
      ),
    )
    const idezettBlokkok = [
      'Nyitó videó (kéznyitás)',
      'Szakmai háttér sáv',
      'Kurzuskártyák (automatikus)',
      'Ingyenes villámkurzus sáv',
      'Logósor',
      'Üdvözlés és gondok',
      'Ígéretek kártyákon',
      'A kéz három állapota',
      'Képes lista vagy kártyák',
      'Bemutatkozás és számok',
      'Számozott lépések',
      'Vélemények (automatikus)',
      'Tudástár-ajánló (automatikus)',
      'GYIK (gyakori kérdések)',
      'Szakemberek kártyái',
      'Nyitható sorok',
      'Időpontkérés',
      'Szabad szöveg',
      'Gombos kiemelő sáv',
    ]
    for (const nev of idezettBlokkok) {
      expect(blokkNevek.has(nev)).toBe(true)
      vanBenne(UTMUTATO, nev)
    }
  })
})

describe('a mozgó fotósor feltétele a szerkesztő jelzéseivel azonos', () => {
  const FELTETEL_ELOTAG = 'Ebben a helyzetben a mozgó fotósor nem látszik: '

  it('az útmutató a két jelzést betűre idézi', () => {
    vanBenne(UTMUTATO, egySorba(FRIZ_NEM_LATSZIK_JELZES))
    vanBenne(UTMUTATO, egySorba(CSAPATFOTO_FRIZ_JELZES))
  })

  it('a táblázat a jelzés feltételsorát idézi, és a régi, pontatlan feltétel nem maradt', () => {
    expect(FRIZ_NEM_LATSZIK_JELZES.startsWith(FELTETEL_ELOTAG)).toBe(true)
    const feltetelsor = FRIZ_NEM_LATSZIK_JELZES.slice(FELTETEL_ELOTAG.length).replace(/\.$/, '')
    vanBenne(TABLAZAT, egySorba(FRIZ_NEM_LATSZIK_JELZES))
    vanBenne(TABLAZAT, `A fotósor ${egySorba(feltetelsor)}`)
    for (const regi of [
      'sor csak akkor jelenik meg, ha a szekció közvetlenül a nyitó videó után áll',
      'Csak akkor látszik, ha a szekció közvetlenül a nyitó videó után áll',
      'Ha a szekció közvetlenül a nyitó videó után áll, a kezdőlapon helyette',
    ]) {
      expect(MINDKETTO.includes(regi), `régi feltétel maradt: „${regi}”`).toBe(false)
    }
  })
})

describe('„Ami nem a lapon látszik”: a leírt tartalékláncok a kódban', () => {
  it('a megosztási kép tartaléklánca: Megosztási kép, majd Fejléckép vagy Borítókép, majd az alapkép', () => {
    const seo = forras('lib/seo.ts')
    vanBenne(seo, 'return mediaOgImage(og) ?? mediaOgImage(hero)')
    vanBenne(seo, 'heroImage: product.coverImage')
    vanBenne(seo, "url: absoluteUrl('/opengraph-image')")
    vanBenne(forras('app/opengraph-image.tsx'), 'founders-intro-white-1600.webp')
    vanBenne(UTMUTATO, '| Oldal (a Kapcsolat is) | Megosztási kép | Fejléckép |')
    vanBenne(UTMUTATO, '| Kurzus | Megosztási kép | Borítókép |')
    vanBenne(UTMUTATO, 'a Kineticare alapképe')
  })

  it('a visszaigazoló levél ígérete a kódban van, ahogy az útmutató idézi', () => {
    const level = forras('lib/email/templates/appointment.ts')
    for (const resz of [
      'Megkaptuk az időpontkérésed: Kineticare',
      'két munkanapon belül',
      'Az első alkalom minden esetben 50 perces vizsgálattal kezdődik.',
    ]) {
      vanBenne(level, resz)
      vanBenne(UTMUTATO, resz)
    }
  })

  it('a számlanév a Belső azonosító (a rendelés pillanatképe)', () => {
    vanBenne(forras('lib/order-integrity.ts'), 'item.titleSnapshot = product.sku')
    vanBenne(forras('plugins/ecommerce.ts'), "label: 'Belső azonosító'")
    vanBenne(UTMUTATO, 'Alapadatok → Belső azonosító')
  })
})

describe('„Amit a rendszer induláskor visszahoz”: a leírt feltételek a kódban', () => {
  it('az onInit a kezdőlapot, a véleményeket és a három űrlapot ellenőrzi', () => {
    const config = forras('payload.config.ts')
    for (const hivas of [
      'await ensureHomeLayout(payload, mediaIds)',
      'await ensureHomeTestimonials(payload)',
      'await ensureContactForm(payload)',
      'await ensureNewsletterForm(payload)',
      'await ensureAppointmentForm(payload)',
    ]) {
      vanBenne(config, hivas)
    }
  })

  it('a kezdőlap a webcíme szerint, közzétéve jön létre; szekciósor csak üres sornál', () => {
    const seed = forras('lib/home-seed.ts')
    vanBenne(seed, 'where: { slug: { equals: HOME_PAGE_SLUG } }')
    vanBenne(seed, 'if (existing.docs.length === 0) {')
    vanBenne(seed, "_status: 'published'")
    vanBenne(seed, 'if (Array.isArray(home.layout) && home.layout.length > 0) {')
    vanBenne(UTMUTATO, 'Ha az Oldalak között nincs „kezdolap” webcímű oldal')
    vanBenne(UTMUTATO, 'Egy új, azonnal közzétett kezdőlapot az alap-szekciósorral')
  })

  it('a három induló véleményt név szerint keresi, és kiemelve hozza létre', () => {
    const seed = forras('lib/home-seed.ts')
    vanBenne(seed, 'where: { authorName: { equals: testimonial.authorName } }')
    vanBenne(seed, 'featured: true')
    const nevek = [...seed.matchAll(/authorName: '([^']+)'/g)].map((talalat) => talalat[1])
    expect(nevek).toHaveLength(3)
    for (const nev of nevek) {
      vanBenne(UTMUTATO, nev ?? '')
      vanBenne(TABLAZAT, nev ?? '')
    }
  })

  it('az űrlapokat pontos név szerint keresi', () => {
    vanBenne(
      forras('lib/appointment/form.ts'),
      'where: { title: { equals: APPOINTMENT_FORM_TITLE } }',
    )
    vanBenne(
      forras('lib/newsletter/form.ts'),
      'where: { title: { equals: NEWSLETTER_FORM_TITLE } }',
    )
    vanBenne(forras('payload.config.ts'), 'where: { title: { equals: CONTACT_FORM_TITLE } }')
    vanBenne(UTMUTATO, '(Időpontkérés, Hírlevél, Kapcsolat)')
  })

  it('a kezdőlap közzétételének visszavonásáról ugyanazt mondja, mint a webcím doboza', () => {
    const mondat = kotottWebcim('pages', 'kezdolap')?.visszavonas ?? ''
    expect(mondat.startsWith(`A „${VISSZAVONAS_GOMB}” után`)).toBe(true)
    const kezdet = UTMUTATO.indexOf('## 16. Amit a rendszer induláskor visszahoz')
    const vege = UTMUTATO.indexOf('## 17. ')
    expect(kezdet).toBeGreaterThanOrEqual(0)
    expect(vege).toBeGreaterThan(kezdet)
    vanBenne(UTMUTATO.slice(kezdet, vege), `„${egySorba(mondat)}”`)
    vanBenne(TABLAZAT, `„${VISSZAVONAS_GOMB}” után`)
  })

  it('a kezdőlap összes szekciójának törléséről ugyanazt mondja, mint a szerkesztő doboza', () => {
    const doboz = forras('components/admin/HomePageEditNotice.tsx')
    const talalat = /export const MINDEN_SZEKCIO_TORLESE_PONT =\s*'([^']+)'/.exec(doboz)
    const mondat = talalat?.[1] ?? ''
    expect(mondat.length).toBeGreaterThan(0)
    vanBenne(UTMUTATO, mondat)
  })
})

describe('a „Mi hol szerkeszthető” táblázat', () => {
  /** A 2026-09-22-i leltár (modul-térkép leltar.json) 46 oldal- és modulcsoportja. */
  const LELTAR_CSOPORTOK = [
    'minden oldal (layout.tsx)',
    'minden oldal (JSON-LD)',
    'minden oldal (megosztási előnézet): /rolunk, /kapcsolat, 8 tünet-hub, jogi oldalak, /kurzusok, /blog, /blog/[slug], /szakembereknek, 404',
    'minden oldal, cikk és kurzus (megosztási előnézet)',
    '/llms.txt (gépi olvasás)',
    '/llms-full.txt (gépi olvasás)',
    '/szolgaltatasok, /rolunk, /kapcsolat (JSON-LD)',
    '/',
    '/, /rolunk, /szolgaltatasok',
    '/, /szolgaltatasok',
    '/rolunk',
    '/rolunk, /kapcsolat, cikkek szerző-doboza',
    '/rolunk, /szolgaltatasok, jogi oldalak (minden nem-hub [slug] oldal)',
    '/szolgaltatasok',
    '/kapcsolat (saját route)',
    '/kapcsolat (saját route) és minden időpontkérő szekció',
    '/szakembereknek',
    '/szakembereknek, /llms.txt, tünet-hubok',
    '/kurzusok',
    '/kurzusok/[slug] (normál sablon)',
    '/kurzusok/[slug] (akciós sablon)',
    '8 tünet-hub: /keztoalagut-szindroma, /inhuvelygyulladas, /teniszkonyok, /csuklo-es-kezfajdalom, /kez-zsibbadas, /pattano-ujj, /csuklotores-utani-gyogytorna, /befagyott-vall',
    '8 tünet-hub: /keztoalagut-szindroma, /inhuvelygyulladas, /teniszkonyok, /csuklo-es-kezfajdalom, /kez-zsibbadas, /pattano-ujj, /csuklotores-utani-gyogytorna, /befagyott-vall és /blog/[slug]',
    '8 tünet-hub és /blog/[slug]',
    '/blog',
    '/blog/kategoria/[slug]',
    '/blog/[slug]',
    '/aszf, /adatvedelem, /impresszum',
    '/belepes, /regisztracio, /elfelejtett-jelszo, /jelszo-visszaallitas, /belepes-atallas',
    '/fiok, /kurzusaim, /kurzusaim/[id]',
    '/kosar, /penztar, /fizetes/koszonom, /sikertelen',
    '404, hibaoldal',
    'e-mail',
    'e-mail: időpontkérés visszaigazolója a beküldőnek',
    'e-mail: rendelés-visszaigazoló; számla; Barion fizetőoldal',
    'admin: minden szekciós oldal',
    'admin',
    'frontend → admin',
    'admin: Űrlapok (lábléc, /kapcsolat)',
    'admin: Űrlapok (lábléc hírlevele, /kapcsolat időpontkérője)',
    'admin: Űrlapok (minden beküldés)',
    'admin: Vélemények (hatás: /, /rolunk, /szolgaltatasok)',
    'admin: Oldalak > Webcím (hatás: /, /kapcsolat, /aszf, /adatvedelem, /impresszum, 8 tünet-hub)',
    'admin: Blogbejegyzés-szerkesztő (hatás: /blog/[slug] és a 8 tünet-hub)',
    'admin: minden nézet',
    'üzemeltetés',
  ]

  it('a leltár mind a 46 csoportja szerepel a függelékben', () => {
    expect(new Set(LELTAR_CSOPORTOK).size).toBe(46)
    for (const csoport of LELTAR_CSOPORTOK) {
      vanBenne(TABLAZAT, `\`${csoport}\``)
    }
  })

  it('a kódban lévő elemeknél egységesen a fejlesztőhöz irányít', () => {
    expect(TABLAZAT.split('kódban van, szólj a fejlesztőnek').length - 1).toBeGreaterThan(30)
  })

  it('a 19. „Amihez ne nyúlj” fejezet tilalmai megmaradtak', () => {
    const kezdet = UTMUTATO.indexOf('## 19. Amihez ne nyúlj')
    const vege = UTMUTATO.indexOf('## 20. Hibát látsz?')
    expect(kezdet).toBeGreaterThanOrEqual(0)
    expect(vege).toBeGreaterThan(kezdet)
    const fejezet = UTMUTATO.slice(kezdet, vege)
    for (const tilalom of [
      'A **Rendeléseket, Kosarakat, Tranzakciókat** ne írd át, ne töröld.',
      'A **Szerepkör** mezőt csak a tulajdonos tudja állítani',
      'Felhasználót **ne törölj**',
      'A **Megvásárolt kurzusok** listát ne pipáld kézzel',
      '**Törlés helyett rejts el.**',
      '**Élő tartalom webcímét (slug) ne írd át**',
    ]) {
      vanBenne(fejezet, tilalom)
    }
  })
})
