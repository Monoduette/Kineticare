import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import type { MailAttachment } from '../types'
import { lexicalToJogiForras } from './aszf-forras'

/**
 * A vásárlás-visszaigazoló jogi adatai EGYETLEN forrásból: abból az ÁSZF-ből,
 * amelyet a vevő a pénztárban elfogadott. Ez a KÖZZÉTETT /aszf oldal
 * (Oldalak, webcím: `aszf`): a pénztár ÁSZF-linkje (CheckoutForm) és a
 * lábléc is erre mutat, és az oldalt az adminban szerkesztik. A levél
 * küldésekor az oldal tartalmát a forrásfájlok jelölős formátumára
 * alakítjuk (aszf-forras.ts), és abból épül a melléklet és a szolgáltatói
 * blokk (`orderLegalInfoFromAszfPage`). A szolgáltató adatait az ÁSZF
 * „KINETICARE adatai" blokkjából olvassuk ki, nem a kódba írjuk: ha az ÁSZF-et
 * az adminban átírják, a következő levél már az új szöveget viszi, és
 * kitalált adat nem kerülhet a levélbe.
 *
 * A repó `src/lib/legal-source/aszf.txt` fájlja (ebből jön létre egy friss
 * telepítésen az /aszf oldal, lásd src/lib/legal-content.ts) csak TARTALÉK:
 * ha a közzétett oldal hiányzik, nem olvasható vagy nem értelmezhető, a levél
 * ebből épül, és a küldő (src/lib/order-paid.ts) RIASZT, mert a melléklet
 * ilyenkor eltérhet attól, amit a vevő elfogadott.
 *
 * MIÉRT KELL: a 45/2014. (II. 26.) Korm. rendelet 18. §-a szerint a szerződés
 * megkötése után tartós adathordozón kell visszaigazolni a 11. § (1)
 * szerinti tájékoztatást (szolgáltató neve, székhelye, elérhetősége, ár,
 * panaszkezelés, békéltető testület stb.), és a 29. § (1) m) szerinti
 * elállási kivétel csak akkor él, ha ez a visszaigazolás megtörtént. A
 * weboldalra mutató link NEM tartós adathordozó (C-49/11 Content Services),
 * ezért az ÁSZF teljes szövege mellékletként megy a levéllel.
 */

/**
 * Az ÁSZF-oldal webcíme (Pages.slug). Egyezik a src/lib/legal-content.ts
 * `JOGI_OLDALAK` ÁSZF-sorával és a pénztár, valamint a lábléc linkjével; az
 * egyezést teszt őrzi (src/__tests__/legal-content.test.ts). Itt külön
 * konstans, mert a legal-content.ts a levél futásidejéből nem importálható
 * (lásd aszf-forras.ts).
 */
export const ASZF_OLDAL_WEBCIM = 'aszf'

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
 * Egy adatsor címkéjének legnagyobb hossza. A leghosszabb valódi címke a
 * „Bejegyző bíróság" (16 karakter); a határ bőven fölötte van, de egy
 * mondatközi kettőspont (pl. „…, hogy a Vásárló: …") már nem címke.
 */
const CIMKE_MAX_HOSSZ = 40

/**
 * A szolgáltató adatai az ÁSZF szövegéből. `null`, ha az adatblokk hiányzik,
 * vagy bármelyik kötelező adat (név, székhely, cégjegyzékszám, adószám,
 * e-mail, telefon) hiányzik vagy alakilag hibás. Ilyenkor a hívó RIASZT, és
 * a levél szolgáltatói blokk nélkül megy: rossz adatot nem küldünk ki.
 *
 * Az adatblokk a „KINETICARE adatai:" sor után a következő fejezetcímig (`# `)
 * tart, VAGY az első olyan sorig, amely se a cégnév, se „Címke: érték" alakú
 * adatsor, se a panaszügyintézés helyéről szóló mondat. Ez a második határ
 * azért kell, mert az adminban szerkesztett oldalon a fejezetcím sima
 * (félkövér) bekezdés is lehet, jelölő nélkül: enélkül a keresés a blokkból
 * kifutva egy későbbi fejezet azonos címkéjű sorát venné fel (pl. a békéltető
 * testület „E-mail:" sorát a cég e-mail-címeként). Így a hiányos blokk
 * `null`-t ad és riaszt, sosem kölcsönöz adatot máshonnan.
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
    if (kettospont <= 0 || kettospont > CIMKE_MAX_HOSSZ) {
      if (PANASZ_HELYE.test(tiszta)) {
        continue
      }
      // Az adatblokk első címke nélküli sora a cégnév; minden további ilyen
      // sor már a blokk utáni szöveg.
      if (nev === null) {
        nev = tiszta
        continue
      }
      break
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
 * A KÖZZÉTETT /aszf oldal tartalmából (Pages.content, Lexical) a teljes jogi
 * adatcsomag. `null`, ha a tartalom nem értelmezhető: nem Lexical-fa, vagy
 * nincs benne szöveg. Ilyenkor a hívó a repó szövegére (aszf.txt) esik
 * vissza, és riaszt.
 *
 * Az ujjlenyomat (`sha256`) a TÉNYLEGESEN felhasznált, jelölős forrásszövegé,
 * így a műveletnapló azt a változatot azonosítja, amelyből a melléklet és a
 * szolgáltatói blokk készült.
 */
export function orderLegalInfoFromAszfPage(tartalom: unknown): OrderLegalInfo | null {
  const forras = lexicalToJogiForras(tartalom)
  if (forras.trim().length === 0) {
    return null
  }
  return orderLegalInfoFromAszf(forras)
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
 * Beolvassa a repó ÁSZF-szövegét (TARTALÉK, lásd a fájl fejlécét), és
 * előállítja a jogi adatcsomagot. HIBÁNÁL DOB (pl. hiányzó fájl): a hívó
 * (`onOrderPaid`) riaszt, és a levelet ettől még kiküldi, mert a
 * visszaigazolás többi része ettől független.
 */
export function loadOrderLegalInfo(
  olvas: (utvonal: string) => string = (utvonal) => readFileSync(utvonal, 'utf8'),
): OrderLegalInfo {
  return orderLegalInfoFromAszf(olvas(aszfForrasUtvonal()))
}
