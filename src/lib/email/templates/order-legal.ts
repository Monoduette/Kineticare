import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import type { MailAttachment } from '../types'

/**
 * A vásárlás-visszaigazoló jogi adatai EGYETLEN forrásból: az ÁSZF szó szerinti
 * szövegéből (`src/lib/legal-source/aszf.txt`, ugyanebből épül a /aszf oldal
 * is, lásd src/lib/legal-content.ts). A szolgáltató adatait az ÁSZF
 * „KINETICARE adatai" blokkjából olvassuk ki, nem a kódba írjuk: ha a jogász a
 * szöveget módosítja, a levél vele együtt változik, és kitalált adat nem
 * kerülhet a levélbe.
 *
 * MIÉRT KELL: a 45/2014. (II. 26.) Korm. rendelet 18. §-a szerint a szerződés
 * megkötése után tartós adathordozón kell visszaigazolni a 11. § (1)
 * szerinti tájékoztatást (szolgáltató neve, székhelye, elérhetősége, ár,
 * panaszkezelés, békéltető testület stb.), és a 29. § (1) m) szerinti
 * elállási kivétel csak akkor él, ha ez a visszaigazolás megtörtént. A
 * weboldalra mutató link NEM tartós adathordozó (C-49/11 Content Services),
 * ezért az ÁSZF teljes szövege mellékletként megy a levéllel.
 */

/** A melléklet fájlneve (ASCII, hogy minden levelezőben és fejlécben ép maradjon). */
export const ASZF_MELLEKLET_FAJLNEV = 'Kineticare-ASZF.txt'

/**
 * A melléklet típusa. Szöveges fájl, nem HTML és nem PDF: minden eszközön
 * megnyílik, nincs benne aktív tartalom, és a levélszűrők sem gyanakodnak rá
 * (a HTML-melléklet adathalász-mintázat). A karakterkészlet kifejezetten
 * UTF-8, az ékezetek miatt.
 */
export const ASZF_MELLEKLET_TIPUS = 'text/plain; charset=utf-8'

/** A szolgáltató (a szerződő vállalkozás) adatai az ÁSZF-ből. */
export interface SellerIdentity {
  /** A cég neve, ahogy az ÁSZF adatblokkjának első sora írja. */
  name: string
  /** Székhely (postai cím). */
  seat: string
  companyRegistrationNumber: string
  /** A cégbíróság neve; hiányzó sor esetén null. */
  registryCourt: string | null
  taxNumber: string
  email: string
  /** A telefonszám a forrás szerinti alakban (pl. +36203573493). */
  phone: string
  /** true, ha az ÁSZF kimondja, hogy a székhely egyben a panaszügyintézés helye. */
  complaintHandledAtSeat: boolean
}

/** A visszaigazolóhoz szükséges jogi adatok egyben. */
export interface OrderLegalInfo {
  /** null, ha az ÁSZF adatblokkja hiányos vagy nem értelmezhető. */
  seller: SellerIdentity | null
  aszf: {
    attachment: MailAttachment
    /** A forrásszöveg SHA-256 ujjlenyomata: ezzel azonosítható, melyik változat ment ki. */
    sha256: string
    /** Az ÁSZF „Kelt:" sorának értéke (pl. „2025. 07.05."); hiányában null. */
    kelt: string | null
  }
}

const ADATBLOKK_KEZDETE = /^\s*KINETICARE adatai:\s*$/u
const PANASZ_HELYE = /székhelye egyben a panaszügyintézés helye/u

/** Az ÁSZF adatblokkjának címkéi → a SellerIdentity mezői. */
const ADAT_CIMKEK: Readonly<Record<string, keyof SellerIdentity>> = {
  Székhely: 'seat',
  Cégjegyzékszám: 'companyRegistrationNumber',
  'Bejegyző bíróság': 'registryCourt',
  Adószám: 'taxNumber',
  'E-mail': 'email',
  Telefonszám: 'phone',
}

/** A kötelező mezők alaki ellenőrzése: hibás forrásból ne menjen ki félrevezető adat. */
const ALAKOK: Readonly<Partial<Record<keyof SellerIdentity, RegExp>>> = {
  companyRegistrationNumber: /^\d{2}-\d{2}-\d{6}$/u,
  taxNumber: /^\d{8}-\d-\d{2}$/u,
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/u,
  phone: /^\+?\d{7,15}$/u,
}

function normalizaltSorok(nyers: string): string[] {
  return nyers.replace(/\r\n?/g, '\n').split('\n')
}

/** A tabulátorok és a többszörös szóközök egyetlen szóközzé válnak. */
function tomorit(ertek: string): string {
  return ertek.replace(/\s+/gu, ' ').trim()
}

/**
 * A szolgáltató adatai az ÁSZF szövegéből. `null`, ha az adatblokk hiányzik,
 * vagy bármelyik kötelező adat (név, székhely, cégjegyzékszám, adószám,
 * e-mail, telefon) hiányzik vagy alakilag hibás. Ilyenkor a hívó RIASZT, és
 * a levél szolgáltatói blokk nélkül megy: rossz adatot nem küldünk ki.
 */
export function parseSellerIdentity(aszf: string): SellerIdentity | null {
  const sorok = normalizaltSorok(aszf)
  const kezdet = sorok.findIndex((sor) => ADATBLOKK_KEZDETE.test(sor))
  if (kezdet < 0) {
    return null
  }
  const talalt: Partial<Record<keyof SellerIdentity, string>> = {}
  let nev: string | null = null
  for (const sor of sorok.slice(kezdet + 1)) {
    if (sor.startsWith('# ')) {
      break
    }
    const tiszta = tomorit(sor)
    if (tiszta.length === 0) {
      continue
    }
    const kettospont = tiszta.indexOf(':')
    if (kettospont < 0) {
      // Az adatblokk első címke nélküli sora a cégnév.
      if (nev === null && !PANASZ_HELYE.test(tiszta)) {
        nev = tiszta
      }
      continue
    }
    const mezo = ADAT_CIMKEK[tiszta.slice(0, kettospont).trim()]
    const ertek = tiszta.slice(kettospont + 1).trim()
    if (mezo !== undefined && ertek.length > 0 && talalt[mezo] === undefined) {
      talalt[mezo] = ertek
    }
  }
  const telefon = talalt.phone?.replace(/[\s()/-]/gu, '')
  const kotelezo = {
    seat: talalt.seat,
    companyRegistrationNumber: talalt.companyRegistrationNumber,
    taxNumber: talalt.taxNumber,
    email: talalt.email,
    phone: telefon,
  }
  if (nev === null) {
    return null
  }
  for (const [mezo, ertek] of Object.entries(kotelezo) as [keyof SellerIdentity, unknown][]) {
    const alak = ALAKOK[mezo]
    if (typeof ertek !== 'string' || ertek.length === 0 || (alak && !alak.test(ertek))) {
      return null
    }
  }
  return {
    name: nev,
    seat: kotelezo.seat as string,
    companyRegistrationNumber: kotelezo.companyRegistrationNumber as string,
    registryCourt: talalt.registryCourt ?? null,
    taxNumber: kotelezo.taxNumber as string,
    email: kotelezo.email as string,
    phone: kotelezo.phone as string,
    complaintHandledAtSeat: sorok.some((sor) => PANASZ_HELYE.test(sor)),
  }
}

/**
 * Magyar telefonszám olvasható tagolással: `+36203573493` → `+36 20 357 3493`,
 * budapesti számnál `+3612345678` → `+36 1 234 5678`. Más alakot változatlanul
 * hagy (a számjegyek sosem változnak, csak a tagolás).
 */
export function formatHungarianPhone(phone: string): string {
  const mobil = /^\+36(\d{2})(\d{3})(\d{4})$/u.exec(phone)
  if (mobil) {
    return `+36 ${mobil[1]} ${mobil[2]} ${mobil[3]}`
  }
  const budapest = /^\+361(\d{3})(\d{4})$/u.exec(phone)
  if (budapest) {
    return `+36 1 ${budapest[1]} ${budapest[2]}`
  }
  return phone
}

/** Az ÁSZF „Kelt:" sorának értéke, ha van. */
export function aszfKelt(aszf: string): string | null {
  for (const sor of normalizaltSorok(aszf)) {
    const talalat = /^\s*Kelt:\s*(.+?)\s*$/u.exec(sor)
    if (talalat) {
      return talalat[1]
    }
  }
  return null
}

/**
 * Az ÁSZF mellékletként küldött, olvasható szövege.
 *
 * A szavak SZÓ SZERINT a forrásból jönnek; csak a megjelenítési jelölők
 * alakulnak át: a `#`/`##` fejezetcím alá aláhúzás kerül (a sima szöveg
 * bevett címjelölése), a sorvégi szóközök elmaradnak, és a többszörös üres
 * sor egyre rövidül. A sortörés CRLF (RFC 2046, 4.1.1: a text típus kanonikus
 * sortörése), az elején UTF-8 bájtsorrend-jel áll, hogy a lementett fájlt a
 * régebbi szövegszerkesztők is helyes ékezetekkel nyissák meg.
 */
export function aszfMellekletSzoveg(aszf: string): string {
  const kimenet: string[] = []
  for (const sor of normalizaltSorok(aszf)) {
    const tiszta = sor.replace(/\s+$/u, '')
    const cim = /^#{1,2} (.+)$/u.exec(tiszta)
    if (cim) {
      const szoveg = cim[1].trim()
      if (kimenet.length > 0 && kimenet[kimenet.length - 1] !== '') {
        kimenet.push('')
      }
      kimenet.push(szoveg, '-'.repeat([...szoveg].length), '')
      continue
    }
    if (tiszta === '' && (kimenet.length === 0 || kimenet[kimenet.length - 1] === '')) {
      continue
    }
    kimenet.push(tiszta)
  }
  while (kimenet.length > 0 && kimenet[kimenet.length - 1] === '') {
    kimenet.pop()
  }
  return `﻿${kimenet.join('\r\n')}\r\n`
}

/** Az ÁSZF forrásszövegéből a teljes jogi adatcsomag (tiszta függvény). */
export function orderLegalInfoFromAszf(aszf: string): OrderLegalInfo {
  const normalizalt = aszf.replace(/\r\n?/g, '\n')
  return {
    seller: parseSellerIdentity(normalizalt),
    aszf: {
      attachment: {
        filename: ASZF_MELLEKLET_FAJLNEV,
        content: aszfMellekletSzoveg(normalizalt),
        contentType: ASZF_MELLEKLET_TIPUS,
      },
      sha256: createHash('sha256').update(normalizalt, 'utf8').digest('hex'),
      kelt: aszfKelt(normalizalt),
    },
  }
}

/**
 * Az ÁSZF forrásfájljának útja FUTÁSIDŐBEN.
 *
 * A `process.cwd()` a repó gyökere: az éles indítás a gyökérből futtatja a
 * `payload migrate && next start` parancsot (railway.json), és a `src/`
 * mappa a futó képben is ott van, mert maga a migrate is onnan olvas. A
 * `src/app/opengraph-image.tsx` ugyanígy a `process.cwd()`-ből olvas
 * futásidőben. Az `import.meta.url` itt nem megbízható: a Next szerver-bundle
 * a modult máshová fordítja.
 */
export function aszfForrasUtvonal(gyoker: string = process.cwd()): string {
  return path.join(gyoker, 'src', 'lib', 'legal-source', 'aszf.txt')
}

/**
 * Beolvassa az ÁSZF-et, és előállítja a jogi adatcsomagot. HIBÁNÁL DOB (pl.
 * hiányzó fájl): a hívó (`onOrderPaid`) riaszt, és a levelet ettől még
 * kiküldi, mert a visszaigazolás többi része ettől független.
 */
export function loadOrderLegalInfo(
  olvas: (utvonal: string) => string = (utvonal) => readFileSync(utvonal, 'utf8'),
): OrderLegalInfo {
  return orderLegalInfoFromAszf(olvas(aszfForrasUtvonal()))
}
