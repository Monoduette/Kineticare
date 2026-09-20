import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { createElement, Fragment, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { appointment } from '../blocks'
import { Appointment } from '../components/blocks/Appointment'
import { appointmentShowsForm, layoutHasAppointmentBlock } from '../lib/appointment/context'
import { HOME_IMAGES } from '../lib/home-seed'
import { alkalmazSzolgaltatasBlokkKep } from '../scripts/apply-owner-content'
import type { BlockAppointment, Page } from '../payload-types'

/**
 * Az időpontkérő szekció ŰRLAP-KAPCSOLÓJÁNAK őre (`urlapMutatasa`).
 *
 * A kapcsoló alapból BE van kapcsolva, és a /kapcsolat lapon BEKAPCSOLVA is
 * marad: a tulajdonos 2026-08-17-i pontosítása szerint ott IGENIS lehet
 * üzenetben időpontot foglalni. A kapcsoló mégis értékes: ha valaha egy
 * szekcióban csak telefonos utat akarunk, egy pipával megoldható — és akkor a
 * rendelők címe, a telefonszámok és az e-mail-cím MINDIG látszik tovább.
 *
 * Ez az NN/g kapcsolat-oldal irányelvének megengedett iránya: „Offer a contact
 * form only in addition to telephone numbers, not as a replacement" — az űrlap
 * a kiegészítő csatorna, a telefonszám a kötelező
 * (https://www.nngroup.com/articles/contact-us-pages/). A veszély tehát nem az
 * űrlap hiánya, hanem az, hogy egy későbbi szerkesztés az elérhetőséget is
 * elvigye vele. Ezt őrzi ez a fájl.
 *
 * NÉGY SZERZŐDÉS:
 *  1. ALAPÉRTELMEZÉS: kapcsoló nélkül és `true` mellett MINDEN marad a mai
 *     állapotban (a migráció `DEFAULT true`, a kód pedig `!== false`) — az
 *     űrlap sosem tűnhet el véletlenül;
 *  2. KIKAPCSOLVA: nincs `<form>` és nincs beküldő gomb, DE a rendelő minden
 *     adata megvan, a telefonszám kattintható `tel:` linkkel;
 *  3. LEKÉRDEZÉS-TAKARÉKOSSÁG: űrlap nélküli szekciónál a route el sem indítja
 *     az űrlap-azonosító lekérdezését;
 *  4. STÍLUSLAP: az egyhasábos változat és a 44 px-es hívás-célfelület a
 *     fájlban VAN, és nem lehet némán felülírni (a deklarációk SZÁMÁT nézzük,
 *     nem a puszta jelenlétüket — a repó cross-sell-tanulsága szerint egy
 *     későbbi, erősebb szabály különben csendben kiüti a korábbit).
 *
 * HÁLÓZAT: a globális fetch hangosan dobó mock (CLAUDE.md 15. tanulság).
 */

vi.stubGlobal('fetch', () => {
  throw new Error('A tesztből SOSEM mehet ki valódi hálózati hívás.')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function render(node: ReactNode): string {
  return renderToStaticMarkup(createElement(Fragment, null, node))
}

/** A /kapcsolat éles blokkjának alakja (a mezőértékek onnan valók). */
const KAPCSOLAT_BLOKK: Record<string, unknown> = {
  id: 'kap1',
  blockType: 'appointment',
  eyebrow: 'Rendelői kezelés',
  title: 'Kérj időpontot a rendelőbe',
  lead: 'Gyógytorna, manuálterápia és kiegészítő terápiák.',
  magyarazat: 'Hívj minket, és rögtön megbeszéljük az időpontot.',
  urlapCim: 'Időpontkérés',
  gombFelirat: 'Időpontot kérek',
  idopontSavok: [{ id: 's1', felirat: 'Hétköznap délelőtt' }],
  helyszinekFelirat: 'Rendelőink',
  helyszinek: [
    { id: 'h1', cim: '1117 Budapest, Nádorliget u. 7/b' },
    { id: 'h2', cim: '1114 Budapest, Fadrusz utca 15.' },
  ],
  telefonFelirat: 'Telefon',
  telefonszamok: [
    { id: 't1', nev: 'Kocsis Kata', szam: '+36 30 169 2263' },
    { id: 't2', nev: 'Kiss Kata', szam: '+36 20 357 3493' },
  ],
  emailFelirat: 'E-mail',
  email: 'info@kineticare.hu',
  sikerCim: 'Megkaptuk az időpontkérésed',
  sikerSzoveg: 'Két munkanapon belül hívunk.',
  sectionSettings: {},
}

function renderBlokk(felulir: Record<string, unknown> = {}): string {
  return render(
    createElement(Appointment, {
      block: { ...KAPCSOLAT_BLOKK, ...felulir } as unknown as BlockAppointment,
      formId: '42',
      turnstileSiteKey: null,
    }),
  )
}

// ---------------------------------------------------------------------------
// 1. Alapértelmezés — az űrlap nem tűnhet el véletlenül
// ---------------------------------------------------------------------------

describe('alapértelmezés: az űrlap marad', () => {
  it('kapcsoló NÉLKÜL renderel űrlapot (a régi tartalom változatlan marad)', () => {
    const html = renderBlokk()
    expect(html).toContain('<form')
    expect(html).toContain('Időpontot kérek')
    expect(html).toContain('kc-appointment__panel')
  })

  it('`urlapMutatasa: true` mellett is renderel űrlapot', () => {
    const html = renderBlokk({ urlapMutatasa: true })
    expect(html).toContain('<form')
    expect(html).toContain('Időpontot kérek')
  })

  it('a döntés-függvény csak a kifejezett `false`-ra mond nemet', () => {
    expect(appointmentShowsForm(undefined)).toBe(true)
    expect(appointmentShowsForm(null)).toBe(true)
    expect(appointmentShowsForm({})).toBe(true)
    expect(appointmentShowsForm({ urlapMutatasa: null })).toBe(true)
    expect(appointmentShowsForm({ urlapMutatasa: true })).toBe(true)
    expect(appointmentShowsForm({ urlapMutatasa: false })).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 2. Kikapcsolva — űrlap nincs, elérhetőség VAN
// ---------------------------------------------------------------------------

describe('kikapcsolt űrlap', () => {
  const html = () => renderBlokk({ urlapMutatasa: false })

  it('nincs se űrlap, se beküldő gomb, se űrlapkártya', () => {
    const kimenet = html()
    expect(kimenet).not.toContain('<form')
    expect(kimenet).not.toContain('Időpontot kérek')
    expect(kimenet).not.toContain('kc-appointment__panel')
    // A csak-űrlaphoz tartozó mezők értéke sem szivároghat ki máshol.
    expect(kimenet).not.toContain('Időpontkérés')
    expect(kimenet).not.toContain('Hétköznap délelőtt')
    expect(kimenet).not.toContain('Megkaptuk az időpontkérésed')
  })

  it('a szekció-fej és a folyamat magyarázata megmarad', () => {
    const kimenet = html()
    expect(kimenet).toContain('Rendelői kezelés')
    expect(kimenet).toContain('Kérj időpontot a rendelőbe')
    expect(kimenet).toContain('Gyógytorna, manuálterápia és kiegészítő terápiák.')
    expect(kimenet).toContain('Hívj minket, és rögtön megbeszéljük az időpontot.')
  })

  it('MINDEN elérhetőség megvan: két rendelő, két telefonszám, e-mail', () => {
    const kimenet = html()
    expect(kimenet).toContain('1117 Budapest, Nádorliget u. 7/b')
    expect(kimenet).toContain('1114 Budapest, Fadrusz utca 15.')
    // Mindkét cím Google Térkép-link, új lapon, a cím szövege változatlan.
    expect(kimenet).toContain(
      'href="https://www.google.com/maps/search/?api=1&amp;query=1117%20Budapest%2C%20N%C3%A1dorliget%20u.%207%2Fb" target="_blank"',
    )
    expect(kimenet).toContain(
      'href="https://www.google.com/maps/search/?api=1&amp;query=1114%20Budapest%2C%20Fadrusz%20utca%2015." target="_blank"',
    )
    expect(kimenet).toContain('+36 30 169 2263')
    expect(kimenet).toContain('+36 20 357 3493')
    expect(kimenet).toContain('info@kineticare.hu')
  })

  it('a telefonszám hívás-link, az e-mail levélíró-link', () => {
    const kimenet = html()
    expect(kimenet).toContain('href="tel:+36301692263"')
    expect(kimenet).toContain('href="tel:+36203573493"')
    expect(kimenet).toContain('href="mailto:info@kineticare.hu"')
  })

  it('az elrendezés egyhasábos, az elérhetőség pedig FŐ cselekvés lesz', () => {
    const kimenet = html()
    expect(kimenet).toContain('kc-appointment__grid--egyhasabos')
    expect(kimenet).toContain('kc-appointment__contact--fo')
  })

  it('bekapcsolt űrlapnál viszont EGYIK módosító sincs ott', () => {
    const kimenet = renderBlokk({ urlapMutatasa: true })
    expect(kimenet).not.toContain('kc-appointment__grid--egyhasabos')
    expect(kimenet).not.toContain('kc-appointment__contact--fo')
  })
})

// ---------------------------------------------------------------------------
// 3. Lekérdezés-takarékosság és admin-feltételek
// ---------------------------------------------------------------------------

describe('a route és az admin nem dolgozik fölöslegesen', () => {
  it('űrlap nélküli szekciónál nem indul űrlap-lekérdezés', () => {
    expect(layoutHasAppointmentBlock([{ blockType: 'appointment', urlapMutatasa: false }])).toBe(
      false,
    )
  })

  it('űrlapot mutató szekciónál (és kapcsoló nélkül) igenis indul', () => {
    expect(layoutHasAppointmentBlock([{ blockType: 'appointment' }])).toBe(true)
    expect(layoutHasAppointmentBlock([{ blockType: 'appointment', urlapMutatasa: true }])).toBe(true)
  })

  it('több szekcióból elég EGY űrlapos ahhoz, hogy kelljen a lekérdezés', () => {
    expect(
      layoutHasAppointmentBlock([
        { blockType: 'appointment', urlapMutatasa: false },
        { blockType: 'teamMembers' },
        { blockType: 'appointment', urlapMutatasa: true },
      ]),
    ).toBe(true)
  })

  it('időpontkérő szekció nélkül soha', () => {
    expect(layoutHasAppointmentBlock([{ blockType: 'teamMembers' }])).toBe(false)
    expect(layoutHasAppointmentBlock([])).toBe(false)
    expect(layoutHasAppointmentBlock(null)).toBe(false)
  })

  it('a csak-űrlaphoz tartozó mezők az adminban is eltűnnek, ha nincs űrlap', () => {
    /** A Payload feltétel-függvényének harmadik argumentuma (a tesztben nem használt). */
    const kornyezet = { blockData: {}, operation: 'update' as const, path: [], user: null }
    const csakUrlaphoz = ['urlapCim', 'gombFelirat', 'idopontSavok', 'sikerCim', 'sikerSzoveg']
    const mindig = ['eyebrow', 'title', 'lead', 'magyarazat', 'helyszinek', 'telefonszamok', 'email']

    for (const nev of csakUrlaphoz) {
      const mezo = appointment.fields.find((field) => 'name' in field && field.name === nev)
      const feltetel = mezo && 'admin' in mezo ? mezo.admin?.condition : undefined
      expect(feltetel, `${nev}: kell rá admin-feltétel`).toBeTypeOf('function')
      expect(feltetel?.({}, { urlapMutatasa: false }, kornyezet), nev).toBe(false)
      expect(feltetel?.({}, { urlapMutatasa: true }, kornyezet), nev).toBe(true)
      expect(feltetel?.({}, {}, kornyezet), `${nev}: kapcsoló nélkül látszik`).toBe(
        true,
      )
    }

    for (const nev of mindig) {
      const mezo = appointment.fields.find((field) => 'name' in field && field.name === nev)
      const feltetel = mezo && 'admin' in mezo ? mezo.admin?.condition : undefined
      expect(feltetel, `${nev}: NEM kaphat feltételt, mindig kell`).toBeUndefined()
    }
  })

  it('a kapcsoló maga is ott van a blokkban, bekapcsolt alapértékkel', () => {
    const mezo = appointment.fields.find(
      (field) => 'name' in field && field.name === 'urlapMutatasa',
    )
    expect(mezo).toBeDefined()
    expect(mezo && 'type' in mezo ? mezo.type : null).toBe('checkbox')
    expect(mezo && 'defaultValue' in mezo ? mezo.defaultValue : null).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 4. Stíluslap — a szabályok SZÁMA, nem a puszta jelenlétük
// ---------------------------------------------------------------------------

describe('appointment.css — az űrlap nélküli változat szabályai', () => {
  const css = readFileSync(
    fileURLToPath(new URL('../app/(frontend)/styles/blocks/appointment.css', import.meta.url)),
    'utf8',
  )

  it('a rács hasáb-szabálya pontosan KÉT helyen dől el', () => {
    /**
     * MIÉRT SZÁMLÁLUNK: a puszta „szerepel-e a szabály" vizsgálat vakon zöld
     * marad, ha valaki később egy erősebb vagy hátrébb álló szabállyal
     * visszateszi a második hasábot (a repóban ez pontosan megtörtént a
     * cross-sell hatókör-őrénél). Kettő a helyes szám: a 900 px-es kéthasábos
     * alap, és az egyhasábos módosító. Bármi több: valaki felülírja az egyiket.
     */
    // Csak a RÁCS szabályai számítanak; az elérhetőség-lista saját
    // `grid-template-columns`-a másik selektorhoz tartozik.
    const racsSzabalyok =
      css.match(/[^{}]*kc-appointment__grid[^{}]*\{[^}]*grid-template-columns/g) ?? []
    expect(racsSzabalyok).toHaveLength(2)
    expect(racsSzabalyok.filter((szabaly) => szabaly.includes('--egyhasabos'))).toHaveLength(1)
  })

  it('a hívás- és levél-link 44 px magas célfelületet kap MINDKÉT változatban', () => {
    // 2026-08-27: a szabály a `--fo`-ról az alap `.kc-appointment__contact`-ra
    // bővült (a --fo örökli), mert mérve az űrlapos /kapcsolat oldalon a tel-
    // és mailto-link 22 px magas volt — az indoklás az appointment.css-ben.
    const blokk = css.slice(css.indexOf('.kc-appointment__contact dd a'))
    expect(blokk).toContain('min-height: 2.75rem')
    // A célfelület a LINK saját dobozán van, nem a soron: `inline-flex` nélkül
    // a `min-height` egy inline elemen nem hatna.
    expect(blokk.slice(0, 200)).toContain('display: inline-flex')
    // A szűkítő változat-szabály nem térhet vissza: ha valaki újra `--fo`-ra
    // szűkíti, az űrlapos oldal linkjei némán visszazsugorodnak.
    expect(css).not.toContain('.kc-appointment__contact--fo dd a')
  })

  it('320 px-en nem bomlik hasábokra (nem keletkezhet vízszintes görgetés)', () => {
    // A `--fo` lista hasáb-szabálya 600 px-es médialekérdezés mögött áll.
    const index = css.indexOf('.kc-appointment__contact--fo {')
    expect(index).toBeGreaterThan(-1)
    const elotte = css.slice(0, index)
    expect(elotte.lastIndexOf('@media (min-width: 600px)')).toBeGreaterThan(
      elotte.lastIndexOf('@media (min-width: 900px)'),
    )
  })
})

// ---------------------------------------------------------------------------
// 5. A 19. javítás — fotó a szolgáltatás-szekciókba
// ---------------------------------------------------------------------------

describe('19. tartalom-javítás: fotó a szolgáltatás-szekcióba', () => {
  const layoutKeppel = (kep: number | null) =>
    [
      { blockType: 'welcome' as const, title: 'Bevezető' },
      { blockType: 'services' as const, title: 'Miben segíthetünk?', image: kep },
    ] as unknown as NonNullable<Page['layout']>

  const kep = (layout: NonNullable<Page['layout']> | null) => {
    const blokk = layout?.find((b) => b.blockType === 'services')
    return blokk?.blockType === 'services' ? blokk.image : undefined
  }

  it('ÜRES képhelyet kitölt', () => {
    const e = alkalmazSzolgaltatasBlokkKep({
      layout: layoutKeppel(null),
      mediaId: 77,
      oldalCimke: '/rolunk',
      cserelheto: false,
    })
    expect(kep(e.layout)).toBe(77)
    expect(e.modositasok).toHaveLength(1)
  })

  it('MEGLÉVŐ képet csak akkor cserél, ha ezt kifejezetten kérik', () => {
    const ovatos = alkalmazSzolgaltatasBlokkKep({
      layout: layoutKeppel(12),
      mediaId: 77,
      oldalCimke: '/rolunk',
      cserelheto: false,
    })
    expect(ovatos.layout).toBeNull()
    expect(ovatos.kihagyasok[0]?.hangos).toBe(false)

    const csere = alkalmazSzolgaltatasBlokkKep({
      layout: layoutKeppel(12),
      mediaId: 77,
      oldalCimke: '/szolgaltatasok',
      cserelheto: true,
    })
    expect(kep(csere.layout)).toBe(77)
    expect(csere.modositasok[0]?.uzenet).toContain('a Médiatárban marad')
  })

  it('IDEMPOTENS: ugyanazzal a képpel már nem ír', () => {
    const e = alkalmazSzolgaltatasBlokkKep({
      layout: layoutKeppel(77),
      mediaId: 77,
      oldalCimke: '/rolunk',
      cserelheto: true,
    })
    expect(e.layout).toBeNull()
    expect(e.kihagyasok[0]?.hangos).toBe(false)
    expect(e.kihagyasok[0]?.indok).toContain('MÁR ezt a képet')
  })

  it('hiányzó média, hiányzó vagy kétszeres szekció esetén HANGOSAN kihagy', () => {
    const nincsMedia = alkalmazSzolgaltatasBlokkKep({
      layout: layoutKeppel(null),
      mediaId: null,
      oldalCimke: '/rolunk',
      cserelheto: false,
    })
    expect(nincsMedia.layout).toBeNull()
    expect(nincsMedia.kihagyasok[0]?.hangos).toBe(true)

    const nincsSzekcio = alkalmazSzolgaltatasBlokkKep({
      layout: [{ blockType: 'welcome' }] as unknown as NonNullable<Page['layout']>,
      mediaId: 77,
      oldalCimke: '/rolunk',
      cserelheto: false,
    })
    expect(nincsSzekcio.layout).toBeNull()
    expect(nincsSzekcio.kihagyasok[0]?.hangos).toBe(true)

    const ketto = alkalmazSzolgaltatasBlokkKep({
      layout: [
        { blockType: 'services', image: null },
        { blockType: 'services', image: null },
      ] as unknown as NonNullable<Page['layout']>,
      mediaId: 77,
      oldalCimke: '/rolunk',
      cserelheto: false,
    })
    expect(ketto.layout).toBeNull()
    expect(ketto.kihagyasok[0]?.hangos).toBe(true)
  })

  it('a két fotó a seed képlistájában van, magyar alt-szöveggel', () => {
    for (const fajl of ['kezeles-kezen.jpg', 'katak-labdaval.jpg']) {
      const bejegyzes = HOME_IMAGES.find((kepSor) => kepSor.file === fajl)
      expect(bejegyzes, `${fajl}: a HOME_IMAGES-ben kell lennie`).toBeDefined()
      // Enélkül az induláskori önjavítás nem tudná visszatölteni kötetvesztés
      // után, és a kép a Médiatárból pótolhatatlanul eltűnne.
      expect(bejegyzes?.alt.length ?? 0).toBeGreaterThan(20)
    }
  })
})
