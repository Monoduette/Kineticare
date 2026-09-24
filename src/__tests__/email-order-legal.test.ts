import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  ASZF_MELLEKLET_FAJLNEV,
  ASZF_MELLEKLET_TIPUS,
  aszfForrasUtvonal,
  aszfKelt,
  aszfMellekletSzoveg,
  formatHungarianPhone,
  orderLegalInfoFromAszf,
  orderLegalInfoFromAszfPage,
  parseSellerIdentity,
} from '../lib/email/templates/order-legal'
import { jogiRichText, lexicalToJogiForras, parseJogiForras } from '../lib/legal-content'

/**
 * A vásárlás-visszaigazoló jogi adatainak EGYETLEN forrása az ÁSZF: élesben a
 * közzétett /aszf oldal, tartalékként a src/lib/legal-source/aszf.txt. Ezek a
 * tesztek azt őrzik, hogy a szolgáltató adatai valóban onnan jönnek, hibás
 * forrásból nem lesz kitalált adat, és a melléklet szó szerint az ÁSZF
 * szövegét hordozza.
 */

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const ASZF = readFileSync(`${REPO_ROOT}src/lib/legal-source/aszf.txt`, 'utf8')
const IMPRESSZUM = readFileSync(`${REPO_ROOT}src/lib/legal-source/impresszum.txt`, 'utf8')

describe('parseSellerIdentity: a valódi ÁSZF-ből', () => {
  const seller = parseSellerIdentity(ASZF)

  it('minden kötelező adatot kiolvas, pontosan', () => {
    expect(seller).toEqual({
      name: 'KINETICARE Kft.',
      seat: '8360 Keszthely, Kacsóh Pongrác utca 1. 2a. ép.',
      companyRegistrationNumber: '20-09-079468',
      registryCourt: 'Zalaegerszegi Törvényszék Cégbírósága',
      taxNumber: '32697865-1-20',
      email: 'egeszsegmozgastamogatas@gmail.com',
      phone: '+36203573493',
      complaintHandledAtSeat: true,
    })
  })

  it('az impresszum ugyanezeket az adatokat mondja (a két jogi dokumentum nem csúszott szét)', () => {
    const impresszum = IMPRESSZUM.replace(/\s+/g, ' ')
    expect(seller).not.toBeNull()
    for (const value of [
      seller?.seat,
      seller?.companyRegistrationNumber,
      seller?.registryCourt,
      seller?.taxNumber,
      seller?.email,
    ]) {
      expect(impresszum).toContain(value)
    }
  })
})

describe('parseSellerIdentity: hibás forrásból nem lesz kitalált adat', () => {
  it('adatblokk nélkül null', () => {
    expect(parseSellerIdentity('# Bevezetés\nNincs itt cégadat.\n')).toBeNull()
  })

  it.each([
    ['hiányzó adószám', /Adószám:[^\n]*\n/u, ''],
    ['hiányzó telefonszám', /Telefonszám:[^\n]*\n/u, ''],
    ['hiányzó székhely', /Székhely:[^\n]*\n/u, ''],
    ['alakilag hibás adószám', /32697865-1-20/u, '3269786-1-20'],
    ['alakilag hibás cégjegyzékszám', /20-09-079468/u, '20-09-07946'],
    ['e-mail helyett szöveg', /egeszsegmozgastamogatas@gmail\.com/u, 'lásd a weboldalon'],
  ])('%s → null', (_nev, minta, csere) => {
    expect(parseSellerIdentity(ASZF.replace(minta, csere))).toBeNull()
  })

  it('a panaszügyintézési mondat nélkül a többi adat megmarad, csak a jelző hamis', () => {
    const seller = parseSellerIdentity(
      ASZF.replace('A KINETICARE székhelye egyben a panaszügyintézés helye is.', ''),
    )
    expect(seller?.complaintHandledAtSeat).toBe(false)
    expect(seller?.taxNumber).toBe('32697865-1-20')
  })

  it('CRLF sorvégű forrást is ért', () => {
    expect(parseSellerIdentity(ASZF.replace(/\n/g, '\r\n'))?.name).toBe('KINETICARE Kft.')
  })

  it('jelölő nélküli fejezetcímeknél is a blokk végén megáll: hiányzó cég-e-mail helyett nem veszi fel a békéltető testületét', () => {
    // Az adminban a címsor sima bekezdés is lehet (nincs `# `), és ha a cég
    // e-mail-sorát átírják, a blokkból kifutó keresés a békéltető testület
    // „E-mail:" sorát vette fel a cég címeként. A hiányos blokk null.
    const lapos = ASZF.replace(/^#{1,2} /gmu, '').replace(
      'E-mail: \tegeszsegmozgastamogatas@gmail.com',
      'E-mail cím: egeszsegmozgastamogatas@gmail.com',
    )
    expect(lapos).toMatch(/E-mail:\s+bekelteto\.testulet@bkik\.hu/u)
    expect(parseSellerIdentity(lapos)).toBeNull()
  })

  it('jelölő nélküli fejezetcímeknél is ugyanazt olvassa ki, ha a blokk ép', () => {
    expect(parseSellerIdentity(ASZF.replace(/^#{1,2} /gmu, ''))).toEqual(parseSellerIdentity(ASZF))
  })

  it('a blokkon belüli ismeretlen címkés sor (pl. Weboldal, Képviselő) nem zárja le a blokkot', () => {
    const bovitett = ASZF.replace(
      'Telefonszám: +36203573493',
      'Ügyfélszolgálat: hétköznap 9 és 16 óra között\nTelefonszám: +36203573493',
    )
    expect(parseSellerIdentity(bovitett)?.phone).toBe('+36203573493')
  })
})

describe('orderLegalInfoFromAszfPage: a közzétett /aszf oldalból', () => {
  const oldal = jogiRichText(parseJogiForras(ASZF))

  it('a tartalom-job által épített oldalból ugyanaz a szolgáltató, a „Kelt" és a melléklet minden sora', () => {
    const legal = orderLegalInfoFromAszfPage(oldal)
    expect(legal).not.toBeNull()
    expect(legal?.seller).toEqual(parseSellerIdentity(ASZF))
    expect(legal?.aszf.kelt).toBe(aszfKelt(ASZF))
    const nemUresSorok = (melleklet: string): string[] =>
      melleklet
        .replace(/^﻿/u, '')
        .split('\r\n')
        .filter((sor) => sor.trim() !== '')
    expect(nemUresSorok(String(legal?.aszf.attachment.content))).toEqual(
      nemUresSorok(aszfMellekletSzoveg(ASZF)),
    )
  })

  it('az ujjlenyomat a ténylegesen felhasznált (visszaalakított) forrásszövegé', () => {
    const legal = orderLegalInfoFromAszfPage(oldal)
    expect(legal?.aszf.sha256).toBe(
      createHash('sha256').update(lexicalToJogiForras(oldal), 'utf8').digest('hex'),
    )
  })

  it('üres vagy nem Lexical-tartalomra null (a hívó a tartalékra esik vissza)', () => {
    expect(orderLegalInfoFromAszfPage(null)).toBeNull()
    expect(orderLegalInfoFromAszfPage('szöveg')).toBeNull()
    expect(orderLegalInfoFromAszfPage({ root: { children: [] } })).toBeNull()
    expect(
      orderLegalInfoFromAszfPage({ root: { children: [{ type: 'paragraph', children: [] }] } }),
    ).toBeNull()
  })
})

describe('formatHungarianPhone', () => {
  it('mobilszám és budapesti szám tagolása, a számjegyek változatlanok', () => {
    expect(formatHungarianPhone('+36203573493')).toBe('+36 20 357 3493')
    expect(formatHungarianPhone('+3612345678')).toBe('+36 1 234 5678')
  })

  it('ismeretlen alakot változatlanul hagy', () => {
    expect(formatHungarianPhone('+441234567890')).toBe('+441234567890')
  })
})

describe('aszfMellekletSzoveg: az ÁSZF mint tartós adathordozón adott melléklet', () => {
  const melleklet = aszfMellekletSzoveg(ASZF)

  it('UTF-8 bájtsorrend-jellel kezdődik, és CRLF sortörést használ (RFC 2046, 4.1.1)', () => {
    expect(melleklet.startsWith('﻿')).toBe(true)
    expect(melleklet).toContain('\r\n')
    expect(melleklet.replace(/\r\n/g, '')).not.toContain('\n')
  })

  it('a forrás MINDEN nem üres sora szó szerint benne van (csak a jelölők alakulnak át)', () => {
    const kimenetSorai = new Set(melleklet.replace(/^﻿/u, '').split('\r\n'))
    for (const sor of ASZF.split('\n')) {
      const tiszta = sor.replace(/\s+$/u, '').replace(/^#{1,2} /u, '')
      if (tiszta.trim() === '') continue
      expect(kimenetSorai.has(tiszta), tiszta.slice(0, 60)).toBe(true)
    }
  })

  it('a fejezetcím alá azonos hosszú aláhúzás kerül, a # jelölő eltűnik', () => {
    expect(melleklet).toContain('\r\nElállási jog kizárása\r\n---------------------\r\n')
    expect(melleklet).not.toMatch(/^# /mu)
  })

  it('nincs dupla üres sor és nincs sorvégi szóköz', () => {
    expect(melleklet).not.toContain('\r\n\r\n\r\n')
    expect(melleklet).not.toMatch(/[ \t]\r\n/u)
  })
})

describe('orderLegalInfoFromAszf', () => {
  const legal = orderLegalInfoFromAszf(ASZF)

  it('a melléklet neve, típusa és tartalma', () => {
    expect(legal.aszf.attachment).toEqual({
      filename: ASZF_MELLEKLET_FAJLNEV,
      contentType: ASZF_MELLEKLET_TIPUS,
      content: aszfMellekletSzoveg(ASZF),
    })
    expect(ASZF_MELLEKLET_FAJLNEV).toMatch(/^[A-Za-z0-9._-]+$/)
  })

  it('a változat azonosítható: SHA-256 a forrásszövegre és a „Kelt:" sor', () => {
    expect(legal.aszf.sha256).toBe(createHash('sha256').update(ASZF, 'utf8').digest('hex'))
    expect(legal.aszf.kelt).toBe('2025. 07.05.')
    expect(aszfKelt('nincs dátum')).toBeNull()
  })

  it('a futásidejű útvonal a repó gyökeréhez képest a legal-source/aszf.txt', () => {
    expect(aszfForrasUtvonal('/app')).toBe('/app/src/lib/legal-source/aszf.txt')
  })
})
