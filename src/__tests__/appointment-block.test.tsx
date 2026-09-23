import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import type { Field } from 'payload'
import { createElement, Fragment, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { appointment, pageBlockSlugs } from '../blocks'
import { Appointment, AppointmentIntro, appointmentPhones } from '../components/blocks/Appointment'
import { RenderBlocks } from '../components/blocks/RenderBlocks'
import { APPOINTMENT_CONSENT_TEXT } from '../lib/appointment/consent-text'
import { APPOINTMENT_UNAVAILABLE_ERROR } from '../lib/appointment/submit'
import { APPOINTMENT_UI_TEXT } from '../lib/appointment/validation'
import { MAPS_LINK_HINT } from '../lib/maps-href'
import type { BlockAppointment, Page } from '../payload-types'

/**
 * Időpontkérő szekció (appointment) — fókuszált tesztek, DB nélkül.
 *
 * Öt szerződést rögzítenek:
 *  1. a BLOKK-DEFINÍCIÓ: benne van a katalógusban, a sorok kötelező mezői
 *     helyesek, és a szekció-beállítások ott vannak;
 *  2. a RENDERELÉS: szekció-fej, rendelő-adatok, kattintható telefon és e-mail,
 *     hiányzó mező helykitöltő nélkül marad ki;
 *  3. a SZEKCIÓ-ADAPTER: a RenderBlocks switch ismeri a blokkot, a horgony és a
 *     háttérsáv átmegy, `visible: false` esetén a szekció kimarad, és az
 *     űrlap-környezet (form id, Turnstile) végigmegy a propokon;
 *  4. az ŰRLAP kezdő állapota: label minden mezőn, nem előpipált hozzájárulás
 *     az /adatvedelem linkkel, „nem kötelező" jelölés, honeypot, és a
 *     nem-elérhető űrlap magyar magyarázata;
 *  5. a TELJES CMS-VEZÉRELTSÉG: a szekció-fej + rendelő-adatok látható szövege
 *     KIZÁRÓLAG a mezők értéke (a teamMembers/accordion guard-tesztjének
 *     mintája). Az ŰRLAP szükségszerűen visel rögzített felületi szöveget, de
 *     az mind az `APPOINTMENT_UI_TEXT` egyetlen forrásából jön — erre külön
 *     asszertálás van.
 *
 * A stíluslap szabályai (három betűméret-token, akcent-korlát, érintőcél,
 * prefers-reduced-motion) fájl-szinten őrzöttek: mind olyan, amit egy későbbi
 * szerkesztés csendben elronthatna.
 *
 * HÁLÓZAT: a globális fetch hangosan dobó mock, hogy a render semmilyen ágon ne
 * indíthasson hívást (CLAUDE.md 15. tanulság).
 */

vi.stubGlobal('fetch', () => {
  throw new Error('A tesztből SOSEM mehet ki valódi hálózati hívás.')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
// Fixture-ök
// ---------------------------------------------------------------------------

type Layout = NonNullable<Page['layout']>

function render(node: ReactNode): string {
  return renderToStaticMarkup(createElement(Fragment, null, node))
}

/** Egy appointment blokk renderelése önmagában (a szekció-adapteren kívül). */
function renderBlock(
  block: Record<string, unknown>,
  context: { formId?: string | null; turnstileSiteKey?: string | null } = {},
): string {
  return render(
    createElement(Appointment, {
      block: block as unknown as BlockAppointment,
      formId: context.formId ?? '42',
      turnstileSiteKey: context.turnstileSiteKey ?? null,
    }),
  )
}

/** Ugyanaz a blokk a RenderBlocks switchén keresztül (regisztráció-ellenőrzés). */
function renderViaSwitch(
  block: Record<string, unknown>,
  appointmentContext?: { formId: string | null; turnstileSiteKey: string | null },
): string {
  return render(
    createElement(RenderBlocks, {
      layout: [block] as unknown as Layout,
      products: [],
      posts: [],
      testimonials: [],
      ...(appointmentContext ? { appointment: appointmentContext } : {}),
    }),
  )
}

/** Teljes, minden mezőt kitöltő blokk — a legtöbb teszt ezt szűkíti. */
const TELJES_BLOKK: Record<string, unknown> = {
  id: 'a1',
  blockType: 'appointment',
  eyebrow: 'Rendelői kezelés',
  title: 'Kérj időpontot a rendelőbe',
  lead: 'Gyógytorna és manuálterápia.',
  magyarazat: 'Ez az űrlap nem foglalás.',
  urlapCim: 'Időpontkérés',
  gombFelirat: 'Időpontot kérek',
  idopontSavok: [{ id: 's1', felirat: 'Hétköznap délelőtt' }, { id: 's2', felirat: 'Rugalmas vagyok' }],
  helyszinekFelirat: 'Rendelőink',
  helyszinek: [{ id: 'h1', cim: '1117 Budapest, Nádorliget u. 7/b' }],
  telefonFelirat: 'Telefon',
  telefonszamok: [{ id: 't1', nev: 'Kocsis Kata', szam: '+36 30 169 2263' }],
  emailFelirat: 'E-mail',
  email: 'info@kineticare.hu',
  sikerCim: 'Megkaptuk az időpontkérésed',
  sikerSzoveg: 'Két munkanapon belül hívunk.',
  sectionSettings: {},
}

// ---------------------------------------------------------------------------
// 1. Blokk-definíció
// ---------------------------------------------------------------------------

describe('appointment blokk-definíció', () => {
  it('a katalógus része, és a slug/interfész a generált típussal egyezik', () => {
    expect(appointment.slug).toBe('appointment')
    expect(appointment.interfaceName).toBe('BlockAppointment')
    expect(pageBlockSlugs).toContain('appointment')
  })

  it('a rendelő-adatok soraiban a lényegi mező kötelező, a kiegészítés nem', () => {
    const arrayField = (name: string) =>
      appointment.fields.find(
        (field): field is Extract<typeof field, { fields: unknown[] }> =>
          'name' in field && field.name === name && 'fields' in field,
      )

    const helyszinek = arrayField('helyszinek')
    expect(helyszinek, 'nincs `helyszinek` tömb a blokkban').toBeDefined()
    const helyszinMezok = new Map(
      (helyszinek?.fields ?? []).flatMap((field) =>
        'name' in field && typeof field.name === 'string' ? [[field.name, field] as const] : [],
      ),
    )
    expect(helyszinMezok.get('cim')).toMatchObject({ type: 'text', required: true })
    const megjegyzes = helyszinMezok.get('megjegyzes')
    expect(megjegyzes && 'required' in megjegyzes ? megjegyzes.required === true : false).toBe(false)

    const telefonszamok = arrayField('telefonszamok')
    const telefonMezok = new Map(
      (telefonszamok?.fields ?? []).flatMap((field) =>
        'name' in field && typeof field.name === 'string' ? [[field.name, field] as const] : [],
      ),
    )
    expect(telefonMezok.get('szam')).toMatchObject({ type: 'text', required: true })
    const nev = telefonMezok.get('nev')
    expect(nev && 'required' in nev ? nev.required === true : false).toBe(false)

    const savok = arrayField('idopontSavok')
    expect(savok).toMatchObject({ type: 'array', maxRows: 6 })
    const savMezok = new Map(
      (savok?.fields ?? []).flatMap((field) =>
        'name' in field && typeof field.name === 'string' ? [[field.name, field] as const] : [],
      ),
    )
    expect(savMezok.get('felirat')).toMatchObject({ type: 'text', required: true })
  })

  it('a szekció-beállítások ott vannak, és a háttér alapból világoskék', () => {
    const settings = adatMezo(appointment.fields, 'sectionSettings')
    expect(settings).toBeDefined()
    expect(settings?.type).toBe('group')
    const hatter =
      settings && settings.type === 'group'
        ? settings.fields.find((field) => 'name' in field && field.name === 'hatter')
        : undefined
    expect(hatter).toMatchObject({ defaultValue: 'tint' })
  })

  it('a szekció-beállítások az utolsó, alapból csukott „Megjelenés és elrejtés” részben állnak', () => {
    const utolso = appointment.fields.at(-1)
    expect(utolso?.type).toBe('collapsible')
    expect(utolso && 'name' in utolso).toBe(false)
    expect(utolso?.type === 'collapsible' ? utolso.label : null).toBe('Megjelenés és elrejtés')
    expect(utolso?.type === 'collapsible' ? utolso.admin?.initCollapsed : null).toBe(true)
  })
})

/**
 * Mező keresése az ADATSZINTEN: a név nélküli elrendező mezőket (collapsible,
 * row, név nélküli fül) bejárja, a nevesített group/array belsejébe nem lép.
 * A találat így azt is bizonyítja, hogy az adatútvonal a blokk gyökerében
 * maradt (pl. `sectionSettings.hatter`).
 */
function adatMezo(fields: readonly Field[], nev: string): Field | undefined {
  for (const field of fields) {
    if ('name' in field && field.name === nev) {
      return field
    }
    if (field.type === 'collapsible' || field.type === 'row') {
      const talalat = adatMezo(field.fields, nev)
      if (talalat) {
        return talalat
      }
    }
    if (field.type === 'tabs') {
      for (const tab of field.tabs) {
        const talalat = 'name' in tab && tab.name ? undefined : adatMezo(tab.fields, nev)
        if (talalat) {
          return talalat
        }
      }
    }
  }
  return undefined
}

// ---------------------------------------------------------------------------
// 2. Renderelés
// ---------------------------------------------------------------------------

describe('Appointment renderelés', () => {
  it('a szekció-fej és a rendelő adatai megjelennek, a telefon és az e-mail kattintható', () => {
    const html = renderBlock(TELJES_BLOKK)

    expect(html).toContain('Rendelői kezelés')
    expect(html).toContain('Kérj időpontot a rendelőbe')
    expect(html).toContain('Ez az űrlap nem foglalás.')
    expect(html).toContain('1117 Budapest, Nádorliget u. 7/b')
    // A megjelenített szám TAGOLT marad, a hívás-link csak a számjegyeket viszi.
    expect(html).toContain('+36 30 169 2263')
    expect(html).toContain('href="tel:+36301692263"')
    expect(html).toContain('href="mailto:info@kineticare.hu"')
    // A cím is kattintható: a látható szöveg maga a cím, a link a Google
    // Térképet nyitja új lapon, a rejtett toldat a képernyőolvasónak szól.
    expect(html).toContain(
      '<a href="https://www.google.com/maps/search/?api=1&amp;query=1117%20Budapest%2C%20N%C3%A1dorliget%20u.%207%2Fb" target="_blank" rel="noopener noreferrer">1117 Budapest, Nádorliget u. 7/b<span class="kc-visually-hidden"> (Google Térkép, új lapon nyílik)</span></a>',
    )
  })

  it('cím nélküli szekció nem visz aria-labelledby-t (nincs név nélküli landmark)', () => {
    expect(renderBlock(TELJES_BLOKK)).toContain('aria-labelledby="appointment-cim-a1"')

    const cimNelkul = renderBlock({ ...TELJES_BLOKK, title: '   ' })
    expect(cimNelkul).not.toContain('aria-labelledby')
    expect(cimNelkul).not.toContain('kc-appointment__title')
  })

  it('a szám nélküli telefon-sor kimarad, a nem tagolt szám is kap hívás-linket', () => {
    expect(
      appointmentPhones({
        telefonszamok: [
          { id: 't1', nev: 'Van', szam: '+36 30 169 2263' },
          { id: 't2', nev: 'Nincs száma', szam: '   ' },
          { id: 't3', nev: 'Tagolatlan', szam: '06301692263' },
        ],
      } as unknown as BlockAppointment),
    ).toEqual([
      { nev: 'Van', szam: '+36 30 169 2263', href: 'tel:+36301692263' },
      { nev: 'Tagolatlan', szam: '06301692263', href: 'tel:06301692263' },
    ])
  })

  it('adat nélkül nincs üres adat-lista, és a sávok nélkül a „mikor alkalmas" kérdés kimarad', () => {
    const html = renderBlock({ id: 'a2', blockType: 'appointment', sectionSettings: {} })
    expect(html).not.toContain('kc-appointment__contact')
    expect(html).not.toContain(APPOINTMENT_UI_TEXT.availabilityLegend)
    // Az űrlap viszont ilyenkor is ott van: a szekciónak űrlap a lényege.
    expect(html).toContain('kc-appointment__form')
  })

  it('a felkínált időpont-sávok a CMS-mezőből jönnek, jelölőnégyzetként', () => {
    const html = renderBlock(TELJES_BLOKK)
    expect(html).toContain(APPOINTMENT_UI_TEXT.availabilityLegend)
    expect(html).toContain(APPOINTMENT_UI_TEXT.availabilityHint)
    expect(html).toContain('value="Hétköznap délelőtt"')
    expect(html).toContain('value="Rugalmas vagyok"')
    expect((html.match(/kc-appointment__option-label/g) ?? []).length).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// 3. Szekció-adapter (RenderBlocks)
// ---------------------------------------------------------------------------

describe('Appointment a szekció-rendszerben', () => {
  it('a RenderBlocks switch ismeri a blokkot: horgony és háttérsáv átmegy', () => {
    const html = renderViaSwitch(
      {
        ...TELJES_BLOKK,
        sectionSettings: { visible: true, anchorId: 'idopontkeres', hatter: 'tint' },
      },
      { formId: '7', turnstileSiteKey: null },
    )
    expect(html).toContain('id="idopontkeres"')
    expect(html).toContain('kc-section--tint')
    expect(html).toContain('kc-appointment')
  })

  it('sötét háttérsáv esetén a `dark` változat kerül a szekcióra', () => {
    const html = renderViaSwitch(
      { ...TELJES_BLOKK, sectionSettings: { visible: true, hatter: 'sotet' } },
      { formId: '7', turnstileSiteKey: null },
    )
    expect(html).toContain('kc-section--dark')
  })

  it('visible=false esetén a szekció kimarad', () => {
    expect(
      renderViaSwitch(
        { ...TELJES_BLOKK, sectionSettings: { visible: false } },
        { formId: '7', turnstileSiteKey: null },
      ),
    ).toBe('')
  })

  it('az űrlap-környezet nélkül a szekció MEGJELENIK, de az űrlap letiltva renderel', () => {
    // Ez az alapállapot (EMPTY_APPOINTMENT_CONTEXT): a route nem adott át
    // form-azonosítót. A rendelő elérhetőségei ilyenkor is látszanak, tehát a
    // lap nem lesz zsákutca.
    const html = renderViaSwitch(TELJES_BLOKK)
    expect(html).toContain('+36 30 169 2263')
    expect(html).toContain(APPOINTMENT_UNAVAILABLE_ERROR)
    expect(html).toContain('disabled=""')
  })

  it('a Turnstile-widget CSAK beállított site key mellett kerül a DOM-ba', () => {
    // A widget a site key-t NEM írja a jelölésbe (a szkript állítja be
    // futásidőben), ezért a helyfoglaló konténer megléte a jel.
    const kulcsNelkul = renderViaSwitch(TELJES_BLOKK, { formId: '7', turnstileSiteKey: null })
    expect(kulcsNelkul).not.toContain('kc-contact-form__turnstile')

    const kulccsal = renderViaSwitch(TELJES_BLOKK, { formId: '7', turnstileSiteKey: '0xTESZT' })
    expect(kulccsal).toContain('kc-contact-form__turnstile')
  })

  it('a blokk NEM ad ki strukturált adatot (nem GYIK és nem esemény)', () => {
    const html = renderViaSwitch(TELJES_BLOKK, { formId: '7', turnstileSiteKey: null })
    expect(html).not.toContain('application/ld+json')
  })
})

// ---------------------------------------------------------------------------
// 4. Az űrlap kezdő állapota
// ---------------------------------------------------------------------------

describe('AppointmentForm — kezdő állapot', () => {
  const html = renderBlock(TELJES_BLOKK)

  it('minden mezőnek van labelje, és a label az inputra mutat', () => {
    for (const [id, label] of [
      ['kc-field-appointmentName', APPOINTMENT_UI_TEXT.nameLabel],
      ['kc-field-appointmentPhone', APPOINTMENT_UI_TEXT.phoneLabel],
      ['kc-field-appointmentEmail', APPOINTMENT_UI_TEXT.emailLabel],
      ['kc-appointment-reason', APPOINTMENT_UI_TEXT.reasonLabel],
    ] as const) {
      expect(html, `hiányzó label: ${label}`).toContain(`for="${id}"`)
      expect(html).toContain(`id="${id}"`)
      expect(html).toContain(label)
    }
  })

  it('a KÖTELEZŐ mezők csillagot kapnak, a nem kötelezők „(nem kötelező)" jelölést', () => {
    // Kötelező: név, telefon, hozzájárulás (a Field required propja adja a
    // csillagot és a képernyőolvasós „(kötelező)" szöveget).
    expect((html.match(/kc-field__required/g) ?? []).length).toBe(3)
    expect(html).toContain('(kötelező)')
    // Nem kötelező: e-mail, panasz-leírás, időpont-sávok.
    expect(APPOINTMENT_UI_TEXT.emailLabel).toContain('(nem kötelező)')
    expect(APPOINTMENT_UI_TEXT.reasonLabel).toContain('(nem kötelező)')
    expect(APPOINTMENT_UI_TEXT.availabilityLegend).toContain('(nem kötelező)')
  })

  it('a beviteli célok gépi azonosíthatóak (WCAG 2.2 1.3.5: autocomplete)', () => {
    // A React szerver-renderelője a `autoComplete`/`maxLength` propokat a JSX
    // írásmódjával adja ki; a HTML attribútumnév viszont kis-nagybetű-független,
    // ezért az összevetés is az. (Ellenőrizve: renderToStaticMarkup kimenete.)
    const lower = html.toLowerCase()
    expect(lower).toContain('autocomplete="name"')
    expect(lower).toContain('autocomplete="tel"')
    expect(lower).toContain('autocomplete="email"')
  })

  it('a hozzájárulás NINCS előpipálva, és az /adatvedelem oldalra linkel', () => {
    expect(html).toContain('id="kc-appointment-consent"')
    expect(html).toContain('href="/adatvedelem"')
    expect(html).toContain(APPOINTMENT_CONSENT_TEXT.linkLabel)
    // A kifejezett hozzájárulás (GDPR 9. cikk (2) a)) nevesíti az egészségügyi adatot.
    expect(html).toContain('egészségügyi adatokat')
    expect(html).not.toContain('checked=""')
  })

  it('kezdetben nincs hibaüzenet és nincs siker-nézet', () => {
    expect(html).not.toContain('role="alert"')
    expect(html).not.toContain(APPOINTMENT_UI_TEXT.successTitle)
    expect(html).not.toContain(APPOINTMENT_UI_TEXT.errorSummary)
  })

  it('a honeypot mező rejtett (aria-hidden, tabIndex=-1)', () => {
    expect(html).toContain('kc-appointment__hp')
    expect(html).toContain('tabindex="-1"')
  })

  it('a hiba- és a siker-állapot programból fókuszálható (a lap odaugrik)', () => {
    // A jelölést a komponens forrása rögzíti: a hiba-összefoglaló és a
    // siker-címsor `tabIndex={-1}` + ref párost visel, és a beküldés-ág
    // fókuszálja őket. Enélkül a visszajelzés a képernyőn kívülre eshet.
    const forras = readFileSync(
      fileURLToPath(new URL('../components/blocks/AppointmentForm.tsx', import.meta.url)),
      'utf8',
    )
    expect(forras).toContain('errorSummaryRef.current?.focus()')
    expect(forras).toContain('successHeadingRef.current?.focus()')
    expect(forras).toMatch(/ref=\{errorSummaryRef\}[\s\S]{0,80}tabIndex=\{-1\}/)
    expect(forras).toMatch(/ref=\{successHeadingRef\} tabIndex=\{-1\}/)
    // A hiba-fókusz EFFEKTBŐL fut, a beküldés-kezelő csak a számlálót növeli:
    // a kezelőben hívott focus még `null` refre futna (a hiba-összefoglaló
    // csak a következő renderben kerül a DOM-ba). Élő lapon mérve ez volt a
    // különbség fókuszált és nem fókuszált hibaüzenet között.
    expect(forras).toContain('setHibasKiserlet((elozo) => elozo + 1)')
    expect(forras).toMatch(/useEffect\(\(\) => \{\s*if \(hibasKiserlet > 0\)/)
  })

  it('a gomb felirata a §3.2 SZÓTÁRBÓL jön, és a mezők nincsenek letiltva', () => {
    // 2026-08-18, tulajdonosi döntés: a szótári cselekvéseknél a KÓD nyer, a
    // blokk „A gomb felirata" mezője a feliratra nem hat. A döntő bizonyíték:
    // `src/__tests__/cms-nem-nyomja-el-a-szotart.test.tsx`.
    expect(html).toContain(APPOINTMENT_UI_TEXT.submitLabel)
    expect(html).not.toContain('disabled=""')
  })

  it('a panasz-mező hossza korlátozott (adattakarékosság), és van magyarázó segédszöveg', () => {
    expect(html.toLowerCase()).toContain('maxlength="1000"')
    // A segédszövegben magyar idézőjel van, a HTML-ben a `"` escape-elve — a
    // kis-nagybetűtől független összevetés helyett itt a látható szöveget nézzük.
    expect(html).toContain('Elég néhány szó')
  })
})

// ---------------------------------------------------------------------------
// 5. Teljes CMS-vezéreltség
// ---------------------------------------------------------------------------

describe('Appointment — a szekció-fej és a rendelő adatai az adminból jönnek', () => {
  /** Látható szöveg a renderelt HTML-ből: tag-ek nélkül, összevont szóközökkel. */
  function visibleText(html: string): string {
    return html
      .replace(/<[^>]*>/g, ' ')
      .replace(/&#x27;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim()
  }

  it('az intro látható szövege KIZÁRÓLAG a mezők értéke — nincs beégetett szöveg', () => {
    // A jelzőértékek szándékosan NEM részhalmazai egymásnak: a kivonás egymás
    // után fut, egy közös részszó hamis maradékot hagyna.
    const sentinels = {
      eyebrow: 'Aa-jelzo',
      title: 'Bb-jelzo',
      lead: 'Cc-jelzo',
      magyarazat: 'Dd-jelzo',
      helyszinekFelirat: 'Ee-jelzo',
      cim: 'Ff-jelzo',
      megjegyzes: 'Gg-jelzo',
      telefonFelirat: 'Hh-jelzo',
      nev: 'Ii-jelzo',
      emailFelirat: 'Jj-jelzo',
    }
    const szam = '+36 1 234 5678'
    const email = 'valaki@pelda.hu'
    const html = render(
      createElement(AppointmentIntro, {
        block: {
          id: 'a9',
          blockType: 'appointment',
          eyebrow: sentinels.eyebrow,
          title: sentinels.title,
          lead: sentinels.lead,
          magyarazat: sentinels.magyarazat,
          helyszinekFelirat: sentinels.helyszinekFelirat,
          helyszinek: [{ id: 'h1', cim: sentinels.cim, megjegyzes: sentinels.megjegyzes }],
          telefonFelirat: sentinels.telefonFelirat,
          telefonszamok: [{ id: 't1', nev: sentinels.nev, szam }],
          emailFelirat: sentinels.emailFelirat,
          email,
        } as unknown as BlockAppointment,
        headingId: 'appointment-cim-a9',
      }),
    )

    let remaining = visibleText(html)
    for (const value of [...Object.values(sentinels), szam, email]) {
      expect(remaining, `hiányzó mező-érték a kimenetből: ${value}`).toContain(value)
      remaining = remaining.split(value).join(' ')
    }
    // Az EGYETLEN rögzített szöveg az intróban a címlink képernyőolvasó-toldata
    // (`kc-visually-hidden`, a látó vevő nem látja): a linknek meg kell
    // mondania, hogy térképet nyit új lapon (WCAG 2.2 SC 2.4.4, SC 3.2.5).
    remaining = remaining.split(MAPS_LINK_HINT.trim()).join(' ')
    expect(remaining.replace(/\s/g, '')).toBe('')
  })

  it('üres mezők nem kapnak helykitöltőt — a hiányzó rész kimarad', () => {
    const html = render(
      createElement(AppointmentIntro, {
        block: { id: 'a10', blockType: 'appointment' } as unknown as BlockAppointment,
        headingId: 'appointment-cim-a10',
      }),
    )
    expect(visibleText(html)).toBe('')
    expect(html).not.toContain('kc-appointment__eyebrow')
    expect(html).not.toContain('kc-appointment__title')
    expect(html).not.toContain('kc-appointment__lead')
    expect(html).not.toContain('kc-appointment__note')
    expect(html).not.toContain('kc-appointment__contact')
  })

  it('az ŰRLAP rögzített szövege KIZÁRÓLAG az APPOINTMENT_UI_TEXT és a jogi szöveg', () => {
    // A teljes szekció látható szövegéből kivonjuk a CMS-mezőket, az űrlap
    // egyetlen forrásból jövő felületi szövegeit és a hozzájárulás jogi
    // mondatát — nem maradhat semmi. Ez az az őr, ami megakadályozza, hogy
    // marketingmondat kerüljön a komponensbe.
    const html = renderBlock(TELJES_BLOKK)
    const cmsErtekek = [
      'Rendelői kezelés',
      'Kérj időpontot a rendelőbe',
      'Gyógytorna és manuálterápia.',
      'Ez az űrlap nem foglalás.',
      'Időpontkérés',
      'Hétköznap délelőtt',
      'Rugalmas vagyok',
      'Rendelőink',
      '1117 Budapest, Nádorliget u. 7/b',
      'Telefon',
      'Kocsis Kata',
      '+36 30 169 2263',
      'E-mail',
      'info@kineticare.hu',
      'Időpontot kérek',
    ]
    const urlapSzovegek = [
      APPOINTMENT_UI_TEXT.nameLabel,
      APPOINTMENT_UI_TEXT.phoneLabel,
      APPOINTMENT_UI_TEXT.phoneHint,
      APPOINTMENT_UI_TEXT.emailLabel,
      APPOINTMENT_UI_TEXT.emailHint,
      APPOINTMENT_UI_TEXT.reasonLabel,
      APPOINTMENT_UI_TEXT.reasonHint,
      APPOINTMENT_UI_TEXT.availabilityLegend,
      APPOINTMENT_UI_TEXT.availabilityHint,
      APPOINTMENT_CONSENT_TEXT.before,
      APPOINTMENT_CONSENT_TEXT.linkLabel,
      APPOINTMENT_CONSENT_TEXT.after,
      // A címlink képernyőolvasó-toldata (rejtett, src/lib/maps-href.ts).
      MAPS_LINK_HINT.trim(),
      // A `Field` primitív képernyőolvasós kiegészítései és a honeypot felirata.
      '(kötelező)',
      'Weboldal',
      '*',
    ]

    let remaining = visibleText(html)
    // A leghosszabb minták előbb: a rövid részszó különben feldarabolná a hosszút.
    for (const value of [...cmsErtekek, ...urlapSzovegek].sort((a, b) => b.length - a.length)) {
      remaining = remaining.split(value).join(' ')
    }
    expect(remaining.replace(/\s/g, '')).toBe('')
  })
})

// ---------------------------------------------------------------------------
// 6. Stíluslap-őrök
// ---------------------------------------------------------------------------

describe('appointment.css szabály-őrök', () => {
  const css = readFileSync(
    fileURLToPath(new URL('../app/(frontend)/styles/blocks/appointment.css', import.meta.url)),
    'utf8',
  )

  it('PONTOSAN HÁROM betűméret-token szerepel, mind a közös skáláról', () => {
    // A skála tokenjei `--kc-font-l/m/s` — a régi `--kc-text-*` lépcsősor
    // megszűnt, és a szüretnél ez a stíluslap még arra hivatkozott. A minta
    // ezért MINDEN `--kc-*` betűméret-hivatkozást begyűjt, nem csak a régi
    // előtagot: így egy jövőbeli visszacsúszás is elbukik itt, nem csak a
    // központi őrben (src/__tests__/tipografia-harom-meret.test.ts).
    const meretek = [...css.matchAll(/font-size:\s*var\((--kc-[a-z0-9-]+)\)/g)].map(
      (match) => match[1],
    )
    expect(new Set(meretek)).toEqual(new Set(['--kc-font-l', '--kc-font-m', '--kc-font-s']))
  })

  it('elemre írt px/rem betűméret NINCS (UX-skill 4. pont)', () => {
    expect(css).not.toMatch(/font-size:\s*[\d.]+(px|rem|em)/)
  })

  it('a kiemelt szöveg accent-DEEP-et visz; a nyers `accent` sehol nem jelenik meg', () => {
    expect(css).toContain('--kc-appointment-accent-text: var(--kc-color-primary)')
    // A --kc-color-primary maga az accent-deep aliasa (tokens.css). A nyers
    // --kc-color-accent a hűvös felületeken 4,07:1 — AA alatt, ezért itt tilos.
    expect(css).not.toMatch(/var\(--kc-color-accent\)/)
  })

  it('a jelölőnégyzet legalább 24×24 px, a kattintható sor legalább 44 px (WCAG 2.2 2.5.8)', () => {
    const checkbox = css.slice(css.indexOf('.kc-appointment__checkbox {'))
    const checkboxBlock = checkbox.slice(0, checkbox.indexOf('}'))
    expect(checkboxBlock).toContain('width: 1.5rem')
    expect(checkboxBlock).toContain('height: 1.5rem')

    const option = css.slice(css.indexOf('.kc-appointment__option {'))
    expect(option.slice(0, option.indexOf('}'))).toContain('min-height: 2.75rem')
  })

  it('a háttér-átmenet `prefers-reduced-motion: reduce` esetén kikapcsol', () => {
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))
    expect(reduced).toContain('transition: none')
  })

  it('a folyószöveg sorhossza a közös mérték-tokenről jön (45–75 karakter)', () => {
    expect(css).toContain('max-width: var(--kc-measure)')
  })

  it('a linkek aláhúzottak (WCAG 2.2 1.4.1: a szín nem lehet az egyetlen jel)', () => {
    // A repó alap link-nyelve ink-színű és aláhúzás nélküli; ebben a szekcióban
    // a linkek folyószövegben és adat-listában állnak, tehát máshogy nem
    // különböztethetők meg a környező szövegtől.
    expect(css).toContain('.kc-appointment a:not(.kc-button)')
    const szabaly = css.slice(css.indexOf('.kc-appointment a:not(.kc-button)'))
    expect(szabaly.slice(0, szabaly.indexOf('}'))).toContain('text-decoration: underline')
  })

  it('a `legend` nem csúszik ki a mezőfeliratok vonalából', () => {
    expect(css).toContain('.kc-appointment__fieldset > legend')
  })

  it('a Turnstile-widget helyfoglalása itt is megvan (a kapcsolat.css nem tölt be máshol)', () => {
    expect(css).toContain('.kc-appointment__form .kc-contact-form__turnstile')
    expect(css).toContain('min-height: 65px')
  })
})
