import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { appointmentCustomerEmail, appointmentStaffEmail } from '../lib/email/templates/appointment'
import { renderLayout } from '../lib/email/templates/layout'
import { orderConfirmationEmail } from '../lib/email/templates/order'

/**
 * LEVÉLSABLONOK — a weboldal design-nyelve és az akadálymentesség őrei.
 * A levelek nem látszanak sem a lapon, sem a böngészőben: senki nem veszi
 * észre, ha a márkaarcuk visszacsúszik vagy az akadálymentességük elromlik.
 * A korábbi váz például ZÖLD (#1a7f5a) volt, miközben az oldal kék — ez
 * hónapokig így ment ki, mert nincs képernyő, ahol szemet szúrna.
 */

const MINTA = renderLayout({
  preheader: 'Előnézeti szöveg',
  eyebrow: 'Kísérőfelirat',
  heading: 'Címsor',
  paragraphsHtml: ['bekezdés'],
  paragraphsText: ['bekezdés'],
  summary: { title: 'Összefoglaló', rows: [{ label: 'Címke', value: 'Érték' }] },
  items: {
    title: 'Tételek',
    rows: [{ title: 'Tétel', meta: '1 db', amount: '1 000 Ft' }],
    totalLabel: 'Végösszeg',
    totalValue: '1 000 Ft',
  },
  cta: { label: 'Gomb', url: 'https://pelda.hu/cel' },
  note: 'Záró jegyzet',
})

describe('levélváz — a weboldal design-nyelve', () => {
  it('a lap tokenjeit használja, és a régi ZÖLD márkaszín eltűnt', () => {
    // A tokens.css értékei. Ha bármelyik kiesik, a levél elszakad az oldaltól.
    expect(MINTA.html).toContain('#2f6e9f') // accent-deep: gomb + hivatkozás
    expect(MINTA.html).toContain('#f6f9fc') // paper: a levél földje
    expect(MINTA.html).toContain('#10243e') // ink: címsor
    expect(MINTA.html).toContain('#e6f0f8') // tint: összefoglaló panel
    // A korábbi váz zöldje SEHOL nem térhet vissza.
    expect(MINTA.html).not.toContain('1a7f5a')
  })

  it('a wordmark ugyanaz a kettéosztott alak, mint a lapon (Kineti + care)', () => {
    expect(MINTA.html).toMatch(/Kineti<span[^>]*>care<\/span>/)
  })

  it('a címsor a lap szeriffes stackjét kapja, a törzs a groteszket', () => {
    expect(MINTA.html).toContain("'Tenor Sans'")
    expect(MINTA.html).toContain("'Nunito Sans'")
  })
})

describe('levélváz — akadálymentesség és kliens-biztonság', () => {
  it('magyar nyelvet deklarál', () => {
    expect(MINTA.html).toContain('<html lang="hu">')
  })

  it('MINDEN elrendezés-táblázat role="presentation"', () => {
    const tablak = MINTA.html.match(/<table[^>]*>/g) ?? []
    expect(tablak.length).toBeGreaterThan(0)
    for (const tabla of tablak) {
      expect(tabla).toContain('role="presentation"')
    }
  })

  it('valódi <h1> címsor van, nem felnagyított bekezdés', () => {
    expect(MINTA.html).toMatch(/<h1[^>]*>Címsor<\/h1>/)
  })

  it('a törzsszöveg legalább 16px (a Litmus minimuma fölött)', () => {
    // A bekezdés-szabály mérete rögzítve: 14px alá csúszás olvashatatlanná tesz.
    expect(MINTA.html).toMatch(/font-size:16px;line-height:1\.7/)
  })

  it('a látható betűméret csak a három NN/g lépcső (14 / 16 / 32 px)', () => {
    const meretek = [...MINTA.html.matchAll(/font-size:(\d+)px/g)].map((talalat) => talalat[1])
    const lathato = meretek.filter((px) => px !== '1')
    expect(new Set(lathato)).toEqual(new Set(['14', '16', '32']))
    expect(MINTA.html).toContain('-moz-osx-font-smoothing:grayscale')
  })

  it('a 32 px-es címsor keskeny kliensen sem nyitja szét a kártyát', () => {
    // 320 px-es kliens, 16 px külső + 32 px kártya-padding → ~222 px hasáb.
    // Az időpontkérő „időpontkérésed" szava 32 px Tenor Sansban ~236 px.
    // A méret marad L (NN/g), a tábla fixed + a cím tördel (WCAG 1.4.10 C33).
    expect(MINTA.html).toMatch(/max-width:600px;table-layout:fixed/)
    expect(MINTA.html).toMatch(/<h1[^>]*overflow-wrap:break-word/)
    const ido = appointmentCustomerEmail({
      name: 'Nagy Péter',
      phone: '+36 30 123 4567',
      availability: 'Hétköznap délelőtt',
      contactUrl: 'https://pelda.hu/kapcsolat',
    })
    expect(ido.html).toContain('időpontkérésed')
    expect(ido.html).toMatch(/<h1[^>]*overflow-wrap:break-word/)
  })

  it('NINCS flexbox és NINCS grid (a levélkliensek nem támogatják)', () => {
    expect(MINTA.html).not.toMatch(/display:\s*flex/)
    expect(MINTA.html).not.toMatch(/display:\s*grid/)
  })

  it('a sötét mód nem forgathatja ki a márkaarcot', () => {
    expect(MINTA.html).toContain('name="color-scheme" content="light"')
  })

  it('az előnézeti szöveg megvan, de rejtve', () => {
    expect(MINTA.html).toContain('Előnézeti szöveg')
    expect(MINTA.html).toMatch(/display:none;max-height:0;overflow:hidden/)
  })

  it('a gomb háttere a CELLÁN ül (Outlook-biztos), nem csak a linken', () => {
    expect(MINTA.html).toMatch(/<td[^>]*bgcolor="#2f6e9f"/)
  })

  it('a gomb mellett ott a másolható tartalék cím is', () => {
    expect(MINTA.html).toContain('Ha a gomb nem működik')
    expect(MINTA.text).toContain('https://pelda.hu/cel')
  })

  it('a strukturált mezők escape-elve mennek ki (XSS az e-mail-törzsben is)', () => {
    const gonosz = renderLayout({
      heading: 'x',
      paragraphsHtml: ['x'],
      paragraphsText: ['x'],
      summary: { rows: [{ label: '<script>', value: '"idéz"' }] },
      items: { rows: [{ title: '<img onerror=1>', amount: '<b>' }] },
    })
    expect(gonosz.html).not.toContain('<script>')
    expect(gonosz.html).not.toContain('<img onerror')
    expect(gonosz.html).toContain('&lt;script&gt;')
  })

  it('a szöveges változat MINDEN blokkot visszaad (nem csak a HTML)', () => {
    expect(MINTA.text).toContain('Címke: Érték')
    expect(MINTA.text).toContain('Tétel')
    expect(MINTA.text).toContain('Végösszeg: 1 000 Ft')
    expect(MINTA.text).toContain('Záró jegyzet')
  })
})

describe('vásárlás-visszaigazoló', () => {
  const level = orderConfirmationEmail({
    orderNumber: 'KIN-2026-000418',
    buyerName: 'Kovács Anna',
    items: [{ title: 'Otthoni KézRehab', quantity: 2, totalHuf: 39900 }],
    totalHuf: 39900,
    coursesUrl: 'https://pelda.hu/kurzusaim',
    invoiceNote: true,
  })

  it('a rendelésszám a kiemelt panelben áll, nem bekezdésben', () => {
    expect(level.html).toMatch(/#e6f0f8[\s\S]*Rendelésszám[\s\S]*KIN-2026-000418/)
  })

  it('a tételek táblában állnak, végösszeggel', () => {
    expect(level.html).toContain('Otthoni KézRehab')
    expect(level.html).toContain('2 db')
    // H16: az ÁSZF szava („fizetendő végösszeg”), áfa-utalás nélkül.
    expect(level.html).toContain('Fizetendő végösszeg')
  })

  it('a számla-mondat a gomb után áll, nem a rendelés adatai előtt', () => {
    const szamlaIndex = level.html.indexOf('Számlázz.hu')
    const tetelIndex = level.html.indexOf('Otthoni KézRehab')
    expect(szamlaIndex).toBeGreaterThan(tetelIndex)
  })
})

describe('időpontkérés-visszaigazoló a beküldőnek', () => {
  const level = appointmentCustomerEmail({
    name: 'Nagy Péter',
    phone: '+36 30 123 4567',
    availability: 'Hétköznap délelőtt',
    contactUrl: 'https://pelda.hu/kapcsolat',
  })

  it('kimondja, hogy ez MÉG NEM foglalás', () => {
    expect(level.html).toContain('nem foglalás')
    expect(level.text).toContain('nem foglalás')
  })

  it('visszaadja, amit a beküldő megadott', () => {
    expect(level.text).toContain('Név: Nagy Péter')
    expect(level.text).toContain('Telefonszám: +36 30 123 4567')
  })

  it('NINCS benne gomb: a következő lépés nálunk van, nem a címzettnél', () => {
    expect(level.html).not.toMatch(/<td[^>]*bgcolor="#2f6e9f"/)
  })

  it('ADATTAKARÉKOS: az egészségügyi panasz NEM megy vissza a levélben', () => {
    /**
     * A stáb-levél SZÁNDÉKOSAN tartalmazza a panaszt (abból dolgoznak), a
     * visszaigazolás viszont SZÁNDÉKOSAN nem (GDPR 5. cikk (1) c) — a beküldő
     * tudja, mit írt, egy postaláda-értesítő viszont mások elé teheti.
     * A két levél szembeállítása bizonyítja, hogy ez döntés, nem véletlen.
     */
    const panasz = 'gépelés közben fáj a jobb csuklóm'
    const stab = appointmentStaffEmail({
      name: 'Nagy Péter',
      phone: '+36 30 123 4567',
      email: 'peter@example.hu',
      availability: 'Hétköznap délelőtt',
      reason: panasz,
      submittedAt: '2026-08-17 18:00',
    })
    expect(stab.html).toContain(panasz)
    expect(level.html).not.toContain(panasz)
    expect(level.text).not.toContain(panasz)
  })

  it('a küldése BE VAN KÖTVE a beküldés-kezelőbe (nem csak megírtuk)', () => {
    const config = readFileSync(
      fileURLToPath(new URL('../payload.config.ts', import.meta.url)),
      'utf8',
    )
    const kommentNelkul = config.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    // Meghívjuk, és a BEKÜLDŐ címére küldjük — nem a stáb-listára.
    expect(kommentNelkul).toMatch(/appointmentCustomerEmail\(\{/)
    expect(kommentNelkul).toMatch(/sendMail\(\{\s*to:\s*beküldőEmail/)
  })
})
