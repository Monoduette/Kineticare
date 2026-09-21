import { describe, expect, it } from 'vitest'

import {
  ANALITIKA_AZONOSITO_MAX_HOSSZ,
  ISMERETLEN_OLDAL,
  MIT_CSINALTAL_HOSSZU_HIBA,
  MIT_CSINALTAL_MAX_HOSSZ,
  MI_TORTENT_HIANYZIK_HIBA,
  MI_TORTENT_HOSSZU_HIBA,
  MI_TORTENT_MAX_HOSSZ,
  MI_TORTENT_MIN_HOSSZ,
  MI_TORTENT_ROVID_HIBA,
  normalizaltAnalitikaAzonosito,
  normalizaltOldal,
  OLDAL_MAX_HOSSZ,
  parseVisszajelzesBody,
} from '../lib/feedback/validation'

/**
 * VISSZAJELZÉS-DOBOZ (WP65) — a validáció szabályai.
 *
 * A végpont nyilvános, tehát a nyers törzs bármi lehet. Ez a fájl azt méri,
 * hogy a kötelező mező tényleg kötelező, a csapda-mező tényleg némít, a
 * hibás útvonal nem ejti el a bejelentést, és hogy a jegy-jellegű
 * query-paraméter nem jut ki az analitikába.
 */

function rendben(raw: unknown) {
  const eredmeny = parseVisszajelzesBody(raw)
  expect(eredmeny.allapot).toBe('rendben')
  if (eredmeny.allapot !== 'rendben') {
    throw new Error('a validáció nem fogadta el a beküldést')
  }
  return eredmeny.body
}

describe('parseVisszajelzesBody — a kötelező mező', () => {
  it('hiányzó `miTortent` esetén magyar üzenettel elutasít', () => {
    expect(parseVisszajelzesBody({ oldal: '/' })).toEqual({
      allapot: 'hibas',
      uzenet: MI_TORTENT_HIANYZIK_HIBA,
    })
  })

  it('csupa szóközből álló `miTortent` ugyanúgy hiányzónak számít', () => {
    expect(parseVisszajelzesBody({ miTortent: '   \n\t ', oldal: '/' })).toEqual({
      allapot: 'hibas',
      uzenet: MI_TORTENT_HIANYZIK_HIBA,
    })
  })

  it('nem-string `miTortent` (szám, tömb, objektum) is hiányzónak számít', () => {
    for (const ertek of [42, ['a'], { a: 1 }, null, true]) {
      expect(parseVisszajelzesBody({ miTortent: ertek, oldal: '/' })).toEqual({
        allapot: 'hibas',
        uzenet: MI_TORTENT_HIANYZIK_HIBA,
      })
    }
  })

  it('a nem-objektum törzs (string, tömb, null) is a hiányzó mező ágára fut', () => {
    for (const nyers of ['szöveg', ['a'], null, undefined, 7]) {
      expect(parseVisszajelzesBody(nyers)).toEqual({
        allapot: 'hibas',
        uzenet: MI_TORTENT_HIANYZIK_HIBA,
      })
    }
  })

  it('5 karakternél rövidebb leírás elutasítva, pontosan 5 karakteres elfogadva', () => {
    expect(parseVisszajelzesBody({ miTortent: 'hiba', oldal: '/' })).toEqual({
      allapot: 'hibas',
      uzenet: MI_TORTENT_ROVID_HIBA,
    })
    expect(MI_TORTENT_MIN_HOSSZ).toBe(5)
    expect(rendben({ miTortent: 'hiba!', oldal: '/' }).miTortent).toBe('hiba!')
  })

  it('a hosszmérés a TRIMMELT szövegen történik (a körbeszóközölt rövid is rövid)', () => {
    expect(parseVisszajelzesBody({ miTortent: '   ab   ', oldal: '/' })).toEqual({
      allapot: 'hibas',
      uzenet: MI_TORTENT_ROVID_HIBA,
    })
  })

  it('2000 karakter még belefér, 2001 már nem', () => {
    expect(MI_TORTENT_MAX_HOSSZ).toBe(2000)
    expect(rendben({ miTortent: 'a'.repeat(2000), oldal: '/' }).miTortent).toHaveLength(2000)
    expect(parseVisszajelzesBody({ miTortent: 'a'.repeat(2001), oldal: '/' })).toEqual({
      allapot: 'hibas',
      uzenet: MI_TORTENT_HOSSZU_HIBA,
    })
  })

  it('a leírás trimmelve kerül a normalizált alakba', () => {
    expect(rendben({ miTortent: '  nem tölt be a videó  ', oldal: '/' }).miTortent).toBe(
      'nem tölt be a videó',
    )
  })
})

describe('parseVisszajelzesBody — az opcionális `mitCsinaltal`', () => {
  it('hiányzó vagy üres mezőből `null` lesz (nem üres string)', () => {
    expect(rendben({ miTortent: 'nem megy a gomb', oldal: '/' }).mitCsinaltal).toBeNull()
    expect(
      rendben({ miTortent: 'nem megy a gomb', mitCsinaltal: '   ', oldal: '/' }).mitCsinaltal,
    ).toBeNull()
  })

  it('kitöltve trimmelve marad', () => {
    expect(
      rendben({ miTortent: 'nem megy a gomb', mitCsinaltal: '  a kosárba tettem  ', oldal: '/' })
        .mitCsinaltal,
    ).toBe('a kosárba tettem')
  })

  it('2000 karakter fölött magyar üzenettel elutasít', () => {
    expect(MIT_CSINALTAL_MAX_HOSSZ).toBe(2000)
    expect(
      rendben({ miTortent: 'nem megy', mitCsinaltal: 'b'.repeat(2000), oldal: '/' }).mitCsinaltal,
    ).toHaveLength(2000)
    expect(
      parseVisszajelzesBody({ miTortent: 'nem megy', mitCsinaltal: 'b'.repeat(2001), oldal: '/' }),
    ).toEqual({ allapot: 'hibas', uzenet: MIT_CSINALTAL_HOSSZU_HIBA })
  })
})

describe('parseVisszajelzesBody — a csapda (honeypot)', () => {
  it('kitöltött `weboldal` mezőre csapda-állapot jön vissza', () => {
    expect(
      parseVisszajelzesBody({ miTortent: 'spam szöveg', oldal: '/', weboldal: 'http://spam.hu' }),
    ).toEqual({ allapot: 'csapda' })
  })

  it('a csapda ERŐSEBB a mező-hibáknál (érvénytelen törzsnél sem árul el hibát)', () => {
    // Fontos: a bot ne tudja meg, hogy a mezői rosszak voltak — a csapda-ág
    // MINDEN más ellenőrzés előtt lefut.
    expect(parseVisszajelzesBody({ weboldal: 'x' })).toEqual({ allapot: 'csapda' })
    expect(parseVisszajelzesBody({ miTortent: 'ab', weboldal: 'x' })).toEqual({
      allapot: 'csapda',
    })
  })

  it('üres vagy csak szóközös `weboldal` NEM csapda (a valódi látogató útja)', () => {
    expect(rendben({ miTortent: 'nem megy a gomb', oldal: '/', weboldal: '' }).miTortent).toBe(
      'nem megy a gomb',
    )
    expect(rendben({ miTortent: 'nem megy a gomb', oldal: '/', weboldal: '   ' }).miTortent).toBe(
      'nem megy a gomb',
    )
  })
})

describe('normalizaltOldal — az útvonal ellenőrzése', () => {
  it('a szabályos útvonal változatlanul megmarad', () => {
    expect(normalizaltOldal('/')).toBe('/')
    expect(normalizaltOldal('/kurzusok/otthoni-kezrehab-program')).toBe(
      '/kurzusok/otthoni-kezrehab-program',
    )
    expect(normalizaltOldal('  /kapcsolat  ')).toBe('/kapcsolat')
  })

  it('a séma nélküli abszolút URL (`//idegen.hu`) ELDOBVA', () => {
    // Ez a böngészőben MÁS eredetre mutat: idegen hostot csempészne a riportba.
    expect(normalizaltOldal('//idegen.hu/valami')).toBe(ISMERETLEN_OLDAL)
    expect(normalizaltOldal('///idegen.hu')).toBe(ISMERETLEN_OLDAL)
  })

  it('a perjellel nem kezdődő érték ELDOBVA', () => {
    for (const ertek of [
      'https://idegen.hu',
      'kurzusok',
      'javascript:alert(1)',
      '',
      '   ',
      42,
      null,
      undefined,
      { a: 1 },
      ['/'],
    ]) {
      expect(normalizaltOldal(ertek)).toBe(ISMERETLEN_OLDAL)
    }
  })

  it('a túl hosszú útvonal ELDOBVA', () => {
    expect(normalizaltOldal(`/${'a'.repeat(OLDAL_MAX_HOSSZ)}`)).toBe(ISMERETLEN_OLDAL)
    expect(normalizaltOldal(`/${'a'.repeat(OLDAL_MAX_HOSSZ - 1)}`)).toHaveLength(OLDAL_MAX_HOSSZ)
  })

  it('a jegy-paraméter kivágódik, az utm_* megmarad (M9)', () => {
    expect(normalizaltOldal('/jelszo-visszaallitas?token=titkos-jegy')).toBe(
      '/jelszo-visszaallitas',
    )
    expect(normalizaltOldal('/kurzusok?utm_source=google&token=titkos')).toBe(
      '/kurzusok?utm_source=google',
    )
    expect(normalizaltOldal('/kurzusok#szekcio')).toBe('/kurzusok')
  })

  it('a hibás útvonal NEM ejti el a bejelentést, csak az útvonalat', () => {
    const body = rendben({ miTortent: 'nem tölt be a videó', oldal: 'https://idegen.hu' })
    expect(body.oldal).toBe(ISMERETLEN_OLDAL)
    expect(body.miTortent).toBe('nem tölt be a videó')
  })
})

describe('normalizaltAnalitikaAzonosito — a hozzájárulásos azonosító', () => {
  it('a megadott azonosító trimmelve megy tovább', () => {
    expect(normalizaltAnalitikaAzonosito('  0199-abc  ')).toBe('0199-abc')
  })

  it('hiány, üres érték és nem-string esetén null', () => {
    for (const ertek of [undefined, null, '', '   ', 42, { a: 1 }, ['x']]) {
      expect(normalizaltAnalitikaAzonosito(ertek)).toBeNull()
    }
  })

  it('a PostHog 200 karakteres plafonja fölött null (a doksi szerződése)', () => {
    expect(normalizaltAnalitikaAzonosito('a'.repeat(ANALITIKA_AZONOSITO_MAX_HOSSZ))).toHaveLength(
      ANALITIKA_AZONOSITO_MAX_HOSSZ,
    )
    expect(normalizaltAnalitikaAzonosito('a'.repeat(ANALITIKA_AZONOSITO_MAX_HOSSZ + 1))).toBeNull()
  })

  it('a normalizált törzsbe is így kerül be', () => {
    expect(
      rendben({ miTortent: 'nem megy a gomb', oldal: '/', analitikaAzonosito: ' 0199-abc ' })
        .analitikaAzonosito,
    ).toBe('0199-abc')
    expect(
      rendben({ miTortent: 'nem megy a gomb', oldal: '/', analitikaAzonosito: null })
        .analitikaAzonosito,
    ).toBeNull()
  })
})

describe('VISSZAJELZÉS — az űrlap nem ismer személyes mezőt', () => {
  it('a normalizált törzsnek PONTOSAN négy kulcsa van (nincs e-mail, nincs név)', () => {
    const body = rendben({
      miTortent: 'nem tölt be a videó',
      mitCsinaltal: 'megnyitottam a leckét',
      oldal: '/kurzusaim',
      analitikaAzonosito: '0199-abc',
      // Ami nincs a szerződésben, az át sem jut:
      email: 'teszt@pelda.hu',
      nev: 'Teszt Elek',
      telefon: '+36301234567',
    })
    expect(Object.keys(body).sort()).toEqual([
      'analitikaAzonosito',
      'miTortent',
      'mitCsinaltal',
      'oldal',
    ])
    expect(JSON.stringify(body)).not.toMatch(/@/)
    expect(JSON.stringify(body)).not.toMatch(/\+?\d{6,}/)
  })
})
