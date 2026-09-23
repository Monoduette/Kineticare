'use client'

import { useConfig } from '@payloadcms/ui'
import { usePathname, useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import {
  MEZO_PARAM,
  SZEKCIO_PARAM,
  ervenyesBlokkId,
  ervenyesMezoUtvonal,
  mezoDomId,
  szekcioIndexe,
  szekcioSorDomId,
  szerkesztoUtvonal,
} from '../szekcio-melylink'
import { KetLapFigyelo } from './KetLapFigyelo'
import './SzekcioMegnyito.css'

/**
 * Szekció-mélylink nyitó az adminban (globális kliens-provider,
 * admin.components.providers).
 * A provider rendereli a két lapon nyitott szerkesztő figyelőjét is
 * (KetLapFigyelo.tsx, saját modullal), a nyitó logikájától függetlenül.
 *
 * MIT CSINÁL. Ha az admin egy dokumentum szerkesztőjét nyitja meg
 * `?szekcio=<blokk-azonosító>` paraméterrel (pl. a „Kezdőlapi videó szövegei”
 * menüpont, `/admin/kezdolap-video`), akkor navigációnként egyszer:
 *  1. a dokumentum LEGÚJABB változatából (REST, `draft=true`, a belépett
 *     felhasználó sütijével) kikeresi a szekció sorindexét, mert a Payload a
 *     sort index-alapú `layout-row-<n>` azonosítóval rajzolja;
 *  2. megvárja a sort (MutationObserver, időkorláttal), és ha csukva van, a
 *     Payload SAJÁT kinyitó gombjával kinyitja;
 *  3. KONVERGÁLÓ CIKLUSBAN odagörget úgy, hogy a sor a ragadós fejléc alatt
 *     látsszon (WCAG 2.2 SC 2.4.11 Focus Not Obscured: „Typical types of
 *     content that can overlap focused items are sticky footers, sticky
 *     headers”, https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html).
 *     Egyetlen, előre számolt görgetés nem elég: a Payload a mezőket lustán
 *     rajzolja (@payloadcms/ui/dist/elements/RenderIfInViewport/index.js:
 *     csak a nézet 1000 px-es környezetében vagy a nézet fölött), így görgetés
 *     közben a fölötte álló sorok kinőnek, és a cél lecsúszik (mérve a
 *     kezdőlap „12 · Vélemények” szekciójánál: a lap magassága 9650 → 21043
 *     px). Ezért minden kör:
 *     görgetés → várakozás, amíg a sor teteje és a lap magassága két egymást
 *     követő mintában változatlan → ellenőrzés, és szükség esetén újabb kör.
 *     Csak az első görgetés lehet animált, és az is csak akkor, ha nincs
 *     csökkentett mozgás kérve;
 *  4. a fókuszt a szekció ELSŐ BEVITELI mezőjére teszi (nem az első
 *     fókuszálhatóra: a szekció elején linkek állnak, B2 kérése). A mezőt a
 *     ciklusban keresi, mert csak a nézetbe kerülés után rajzolódik ki. A
 *     sikert a `document.activeElement` igazolja, nem a `focus()` hívása: ha
 *     egy mező nem veszi fel a fókuszt (pl. egy újra becsukott belső sor
 *     mezője, amelyet a Payload `display: none`-nal rejt, de a DOM-ban hagy,
 *     @payloadcms/ui/dist/elements/AnimateHeight/index.js), a következőt
 *     próbálja, legfeljebb FOKUSZ_JELOLTEK_MAX mezőt. Ha a sor látszik, de
 *     beviteli mező nincs benne (csak olvasható vagy mező nélküli szekció),
 *     vagy egyik sem veszi fel a fókuszt, a fókusz magára a sorra kerül
 *     ideiglenes `tabindex="-1"`-gyel (MDN: „may be useful for elements
 *     that should not be navigated to directly using the Tab key, but need
 *     to have keyboard focus set to them”, https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/tabindex),
 *     amely a sor elhagyásakor lekerül;
 *  5. a fókusz UTÁN ellenőriz: a sor a ragadós sáv alatt legalább 8 px-szel
 *     és a nézetablakon belül áll, a fókusz a sorban van. Csak ekkor ad
 *     látható kiemelést (3 px, --theme-success-500, mindkét témán ≥ 3:1,
 *     SC 1.4.11), amely a szekció elhagyásakor megszűnik. A siker után még
 *     UTOKOVETES_MS ideig a helyén tartja a sort, ha a fölötte álló tartalom
 *     később változik (pl. képmezők előnézete);
 *  6. csak az ELLENŐRZÖTT végállapotról ad udvarias élő üzenetet a
 *     sorcímkével (SC 4.1.3 Status Messages: „the success or results of an
 *     action”, https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html).
 *     A hamis „Megnyitva” rosszabb a hallgatásnál; ha a sor a ciklus végén sem
 *     látszik, látható, bezárható magyar figyelmeztetés jelenik meg.
 * Hibás vagy elavult azonosítónál magyar, látható és felolvasott értesítés
 * jelenik meg; kivétel nem szökik ki, a szerkesztő zavartalanul működik.
 *
 * A FELHASZNÁLÓ IRÁNYÍT. Ha a nyitás közben görget, gépel, kattint vagy
 * érint, a nyitó azonnal abbahagyja: nem görget tovább, a fókuszt nem veszi
 * el, és üzenetet sem ad (NN/g, 10 Usability Heuristics, 3. User control and
 * freedom, https://www.nngroup.com/articles/ten-usability-heuristics/).
 * A nyitás alatt ezt a bemeneti események jelzik (BEAVATKOZAS_ESEMENYEK), az
 * utókövetést viszont ezenfelül minden olyan görgetés is leállítja, amelyet
 * nem elrendezés-eltolódás okozott, bemeneti esemény nélkül is (pl.
 * képernyőolvasó vagy hangvezérlés görget). Háttérlapon (pl. új lapon
 * nyitott link) a görgetés a lap láthatóvá válásáig vár, az ott töltött idő
 * nem fogy az időkorlátból.
 *
 * AMIT NEM CSINÁL. Mezőértéket nem ír, ezért a dokumentum nem lesz
 * módosított, és az automatikus mentés sem indul (az Autosave csak
 * `modified` állapotban és megváltozott ÉRTÉKEKNÉL ment,
 * @payloadcms/ui/dist/elements/Autosave/index.js; a sor kinyitása
 * (SET_ROW_COLLAPSED) nem érték). A csukott sort viszont a Payload saját
 * gombja nyitja ki, ezért a Payload ezt ugyanúgy a felhasználó beállításai
 * közé menti, mint egy kézi kattintást (payload-preferences,
 * @payloadcms/ui/dist/fields/Blocks/index.js, setCollapse): a sor legközelebb
 * is nyitva jelenik meg. Ez nem a dokumentum módosítása: a lapra (/api/pages)
 * nem megy írás (mérve 2026-09-23). A paramétert csak mintával ellenőrzött
 * összehasonlításra használja: HTML-be nem kerül, átirányítás nem épül rá
 * (nincs XSS, nincs nyílt átirányítás). Csak a publikus @payloadcms/ui
 * exportokat és a DOM-ot használja.
 *
 * MEZŐ-MÉLYLINK (H06, H50/B26). A `?mezo=<mezőútvonal>` paraméter a nyitást
 * a MEZŐIG viszi, két alakban:
 *  a) `?szekcio=<blokkId>&mezo=captions` (oldalak): a fenti, ELLENŐRZÖTT
 *     sor-pozicionálás után a soron belül megkeresi a mezőt
 *     (`field-layout__<index>__captions`), a csukott belső dobozt a Payload
 *     saját gombjával kinyitja, ugyanazzal a konvergáló ciklussal a ragadós
 *     sáv alá görgeti, a fókuszt a mező első beviteli elemére teszi, és a
 *     MEZŐT emeli ki. Élő üzenet: „Megnyitva: <sorcímke> · <mezőcímke>”. Ha
 *     a mező nincs a sorban, a szekció a mai módon nyílik, és látható,
 *     bezárható figyelmeztetés jelenik meg;
 *  b) `?mezo=howItWorks` (bármely gyűjtemény szerkesztője, pl. a Kurzusok):
 *     a kliens-config mezőfájából kikeresi, melyik FÜL tartalmazza a mezőt
 *     (sorok, csukható dobozok és névtelen fülek bejárásával), a Payload
 *     saját fülgombjával kiválasztja, megvárja a mezőt, majd ugyanúgy görget,
 *     fókuszál és jelent: „Megnyitva: <fül neve> · <mezőcímke>”.
 * Mindkét ágra ugyanazok a garanciák érvényesek: a felhasználó mozdulatára
 * leáll, csökkentett mozgásnál nem animál, háttérlapon vár, értéket nem ír
 * (a fül kiválasztását és a doboz kinyitását a Payload a felhasználó
 * beállításai közé menti, ugyanúgy, mint a sor kinyitását), a paraméter
 * pedig csak mintával ellenőrzött összehasonlításba és CSS.escape-pel
 * képzett szelektorba kerül.
 *
 * MIÉRT ITT, ÉS NEM KÜLÖN DocumentDeepLink KOMPONENSBEN. A modul-térkép
 * eredetileg a Kurzusok szerkesztőjébe (edit.beforeDocumentControls) tett
 * volna egy második nyitót. Két nyitó két viselkedést jelentene ugyanarra a
 * mozdulatra (link → hely a szerkesztőben): más időkorlátot, más
 * leállási szabályt, más üzenetet. A WCAG 2.2 SC 3.2.3 és 3.2.4 (Consistent
 * Navigation / Identification) és az NN/g 4. heurisztikája (Consistency and
 * standards, https://www.nngroup.com/articles/ten-usability-heuristics/)
 * egyaránt azt kéri, hogy ugyanaz a funkció ugyanúgy viselkedjen. Ezért a
 * mező-mélylink a meglévő, globális providerben él, a sor-nyitóval KÖZÖS
 * magon (pozicionalas, veglegesites, utokovetes): a Kurzusok konfigjához
 * nem kell nyúlni, és minden gyűjtemény megkapja.
 */

/** Azok a gyűjtemények, amelyek szerkesztőjében szekció-tömb van, és a tömb mezőneve. */
export const SZEKCIOS_GYUJTEMENYEK: Readonly<Record<string, string>> = {
  pages: 'layout',
}

/** Az első beviteli mező: szöveg, szövegdoboz, választó vagy szövegszerkesztő. */
export const ELSO_BEVITELI_MEZO = [
  'input:not([type="hidden"]):not([type="button"]):not([type="submit"]):not([disabled])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  '[contenteditable="true"]',
].join(', ')

/** A sor és a ragadós sáv alja közti rés görgetés után (px). A kiemelés 7 px-re nyúlik ki. */
export const GORGETESI_TARTALEK_PX = 24

/** Az elfogadási küszöb: a sor legalább ennyivel a ragadós sáv alatt (px). */
export const MIN_RES_PX = 8

/** Ennyi ideig várunk a szekciósorra (a fejlesztői szerver első fordítása lassú). */
export const SOR_IDOKORLAT_MS = 30_000

/**
 * A helyére került sor első mezőjére legfeljebb ennyit várunk, amíg a sor
 * tartalma még nincs kirajzolva (a mezők a nézetbe kerüléskor rajzolódnak).
 */
export const MEZO_IDOKORLAT_MS = 8_000

/** A konvergáló pozicionálás teljes időkorlátja (a háttérlapon töltött idő nélkül). */
export const POZICIO_IDOKORLAT_MS = 15_000

/** Legfeljebb ennyi görgetés–várakozás kör. */
export const MAX_POZICIO_KOR = 12

/** Egy kör leghosszabb várakozása a stabil helyzetre, illetve az első mezőre (ms). */
export const KOR_IDOKORLAT_MS = 1_500

/** Két helyzetminta között a képkocka után ennyit várunk (ms). */
export const MINTA_KOZ_MS = 120

/** A sor ennyivel térhet el a célhelyzettől, hogy helyén lévőnek számítson (px). */
export const POZICIO_TURES_PX = 4

/**
 * A sikeres megnyitás után ennyi ideig tartjuk a sort a helyén (ms), ha a
 * felhasználó nem nyúl semmihez. Ok (mérve a helyi adminban, a kezdőlap
 * szekcióival, a „04 · Kurzuskártyák” sornál): a fölötte álló tartalom az
 * ellenőrzés UTÁN még 45 px-szel rövidült (a képmezők előnézete ekkor
 * töltődött be), és a sor a ragadós sáv alá csúszott.
 */
export const UTOKOVETES_MS = 6_000

/**
 * Az utókövetésben ennyi px-en belüli eltérés nem számít mozgásnak sem a
 * görgetésben, sem a sor nézetbeli tetején (tört képpontos görgetés).
 */
export const UTOKOVETES_TURES_PX = 1

/** A végső fókuszáláskor legfeljebb ennyi beviteli mezőt próbálunk sorban. */
export const FOKUSZ_JELOLTEK_MAX = 10

/** A kiemelt sor adat-attribútuma (a CSS erre épül). */
export const KIEMELES_ATTR = 'data-kc-szekcio-kiemelt'

/**
 * A kiemelt MEZŐ adat-attribútuma (a CSS erre épül). Külön a sorétól, mert a
 * mező doboza maga kapja a körvonalat, nem a benne álló `.collapsible`.
 */
export const MEZO_KIEMELES_ATTR = 'data-kc-mezo-kiemelt'

export type MegnyitasTerv =
  | { tipus: 'nincs' }
  | { tipus: 'hibas-azonosito' }
  | { tipus: 'hibas-mezo' }
  | {
      tipus: 'megnyitas'
      collection: string
      id: string
      /** A szekció-tömb mezőneve (pl. `layout`). */
      mezo: string
      blokkId: string
      /**
       * A `?mezo=` paraméter: a szekción BELÜLI mezőútvonal (pl. `captions`).
       * A név azért nem `mezo`, mert az a szekció-tömb neve (a mai szerződés).
       */
      celMezo?: string
    }
  | {
      tipus: 'mezo-megnyitas'
      collection: string
      id: string
      /** A dokumentum gyökeréhez képesti mezőútvonal (pl. `howItWorks`). */
      mezo: string
    }

/**
 * Kell-e és lehet-e szekciót vagy mezőt nyitni ezen az útvonalon. Csak
 * pontosan egy dokumentum-szerkesztőn (`<admin>/collections/<slug>/<id>`)
 * fut. A `?szekcio=` csak szekció-tömbös gyűjteményben (a mai szabály
 * betűre); a `?mezo=` szekció nélkül bármely gyűjteményben.
 */
export function megnyitasTerv(
  pathname: string | null,
  adminRoute: string,
  szekcio: string | null,
  mezoParam: string | null = null,
): MegnyitasTerv {
  if (pathname === null || (szekcio === null && mezoParam === null)) {
    return { tipus: 'nincs' }
  }
  const utvonal = szerkesztoUtvonal(pathname, adminRoute)
  if (!utvonal) {
    return { tipus: 'nincs' }
  }
  if (szekcio !== null) {
    const mezo = SZEKCIOS_GYUJTEMENYEK[utvonal.collection]
    if (!mezo) {
      return { tipus: 'nincs' }
    }
    if (!ervenyesBlokkId(szekcio)) {
      return { tipus: 'hibas-azonosito' }
    }
    if (mezoParam !== null && !ervenyesMezoUtvonal(mezoParam)) {
      return { tipus: 'hibas-mezo' }
    }
    return {
      tipus: 'megnyitas',
      collection: utvonal.collection,
      id: utvonal.id,
      mezo,
      blokkId: szekcio,
      ...(mezoParam !== null ? { celMezo: mezoParam } : {}),
    }
  }
  if (!ervenyesMezoUtvonal(mezoParam)) {
    return { tipus: 'hibas-mezo' }
  }
  return {
    tipus: 'mezo-megnyitas',
    collection: utvonal.collection,
    id: utvonal.id,
    mezo: mezoParam,
  }
}

export interface Uzenet {
  tipus: 'siker' | 'figyelem'
  /** A látható figyelmeztetés címe (sikernél nincs). */
  cim: string | null
  szoveg: string
}

const SZEKCIOK_HELYE = 'A lap szekcióit lent, a Szekciók alatt találod.'

const MEZOK_HELYE = 'A mezőt a szerkesztő fülein kézzel is megtalálod.'

/** A figyelmeztetés bezáró gombja (a Payload saját ablakaival azonos szó). */
export const BEZARAS_FELIRAT = 'Bezárás'

export const UZENETEK = {
  hibasAzonosito: {
    tipus: 'figyelem',
    cim: 'A hivatkozott szekció nem nyitható meg',
    szoveg: `A link szekció-azonosítója hibás. ${SZEKCIOK_HELYE}`,
  },
  elavult: {
    tipus: 'figyelem',
    cim: 'A hivatkozott szekció nincs ezen a lapon',
    szoveg: `Lehet, hogy azóta törölték, vagy a link régi. ${SZEKCIOK_HELYE}`,
  },
  nemSikerult: {
    tipus: 'figyelem',
    cim: 'A szekciót nem sikerült automatikusan megnyitni',
    szoveg: SZEKCIOK_HELYE,
  },
  hibasMezo: {
    tipus: 'figyelem',
    cim: 'A hivatkozott mező nem nyitható meg',
    szoveg: `A link mezőre mutató része hibás. ${MEZOK_HELYE}`,
  },
  mezoNincsASzekcioban: {
    tipus: 'figyelem',
    cim: null,
    szoveg: 'A hivatkozott mező nincs ebben a szekcióban. A szekciót megnyitottam.',
  },
  mezoNemTalalhato: {
    tipus: 'figyelem',
    cim: null,
    szoveg: 'A hivatkozott mező nem található ezen a lapon.',
  },
  mezoNemSikerult: {
    tipus: 'figyelem',
    cim: 'A mezőt nem sikerült automatikusan megnyitni',
    szoveg: MEZOK_HELYE,
  },
} as const satisfies Record<string, Uzenet>

/**
 * A sikeres megnyitás felolvasott szövege, a látható címkékkel betűre
 * egyezően (SC 3.2.4): a sorcímke (vagy a fül neve), mezőnél utána a mező
 * címkéje, középponttal elválasztva.
 */
export function megnyitvaUzenet(cimke: string, mezoCimke?: string | null): Uzenet {
  const szoveg = mezoCimke ? `${cimke} · ${mezoCimke}` : cimke
  return { tipus: 'siker', cim: null, szoveg: `Megnyitva: ${szoveg}` }
}

/**
 * A sor látható címkéje. A B2 sorcímkéje (`.kc-section-row-label`) az
 * elsődleges forrás; nélküle a Payload alapfejléce (sorszám + típus), végső
 * tartalékként a sorszám.
 */
export function sorCimke(sor: Element, index: number): string {
  const tiszta = (szoveg: string | null | undefined): string =>
    (szoveg ?? '').replace(/\s+/g, ' ').trim()
  const sajat = tiszta(sor.querySelector('.kc-section-row-label')?.textContent)
  if (sajat) {
    return sajat
  }
  const szam = tiszta(sor.querySelector('.blocks-field__block-number')?.textContent)
  const tipus = tiszta(sor.querySelector('.blocks-field__block-pill')?.textContent)
  if (szam && tipus) {
    return `${szam} · ${tipus}`
  }
  return `${String(index + 1).padStart(2, '0')}. szekció`
}

/**
 * A Payload csukható dobozának SAJÁT kinyitó gombja (a belső dobozoké nem):
 * @payloadcms/ui/dist/elements/Collapsible/index.js:76 és 100
 * (`.collapsible` > `.collapsible__toggle-wrap` > `button.collapsible__toggle`).
 */
function csukhatoGombja(doboz: Element): HTMLElement | null {
  return doboz.querySelector<HTMLElement>(
    ':scope > .collapsible__toggle-wrap > .collapsible__toggle',
  )
}

/** A sor saját (legkülső) csukható doboza és annak kinyitó gombja. */
function sorDoboza(sor: Element): { doboz: Element | null; gomb: HTMLElement | null } {
  const doboz = sor.querySelector(':scope > .collapsible')
  return { doboz: doboz ?? null, gomb: doboz ? csukhatoGombja(doboz) : null }
}

/** Csukva van-e a sor (a Payload `collapsible--collapsed` osztálya szerint). */
export function sorCsukva(sor: Element): boolean {
  return sorDoboza(sor).doboz?.classList.contains('collapsible--collapsed') ?? false
}

/** Szerkeszthető-e a beviteli mező (nem csak olvasható). */
function irhatoMezo(mezo: HTMLElement): boolean {
  return (
    !mezo.hasAttribute('readonly') &&
    mezo.getAttribute('aria-readonly') !== 'true' &&
    mezo.getAttribute('contenteditable') !== 'false'
  )
}

/**
 * A sor beviteli mezői a sor SAJÁT tartalmában (a fejléc blokknév-mezője
 * kimarad), a fókuszálás sorrendjében: elöl a szerkeszthetők, utánuk a csak
 * olvashatók, mindkét csoporton belül a dokumentum sorrendjében.
 */
export function beviteliMezok(sor: Element): HTMLElement[] {
  const tartalom = sor.querySelector('.collapsible__content')
  if (!tartalom) {
    return []
  }
  return irhatokElore([...tartalom.querySelectorAll<HTMLElement>(ELSO_BEVITELI_MEZO)])
}

/** Elöl a szerkeszthető mezők, utánuk a csak olvashatók, a sorrendjük megtartásával. */
function irhatokElore(mezok: HTMLElement[]): HTMLElement[] {
  return [...mezok.filter(irhatoMezo), ...mezok.filter((mezo) => !irhatoMezo(mezo))]
}

/**
 * Egy MEZŐ beviteli elemei a fókuszálás sorrendjében. A Payload a szöveges
 * mezőknél magára a beviteli elemre teszi a `field-…` azonosítót
 * (fields/Text/Input.js:117), a csoportnál, tömbnél és blokknál a dobozra
 * (fields/Group/index.js:72): mindkét alakot kezeli.
 */
export function mezoBevitelei(doboz: Element): HTMLElement[] {
  if (doboz instanceof HTMLElement && doboz.matches(ELSO_BEVITELI_MEZO)) {
    return [doboz]
  }
  return irhatokElore([...doboz.querySelectorAll<HTMLElement>(ELSO_BEVITELI_MEZO)])
}

/**
 * A mező doboza egy hatókörön belül, az ABSZOLÚT mezőútvonal alapján: a
 * `field-<útvonal __-vel>` azonosítójú elem (@payloadcms/ui/dist/utilities/
 * generateFieldID.js:5), vagy a Lexical szövegszerkesztő `data-field-path`
 * attribútuma (@payloadcms/richtext-lexical/dist/field/Field.js:139, ennek
 * nincs `field-` azonosítója). Ha az azonosító a beviteli elemen áll, a doboz
 * a körülötte álló `.field-type` (címke + mező + leírás). A paraméter csak
 * CSS.escape-pel kerül a szelektorba.
 */
export function mezoDoboza(hatokor: ParentNode, abszolutUtvonal: string): HTMLElement | null {
  const talalat = hatokor.querySelector<HTMLElement>(
    `#${CSS.escape(mezoDomId(abszolutUtvonal))}, [data-field-path="${CSS.escape(abszolutUtvonal)}"]`,
  )
  if (!talalat) {
    return null
  }
  if (talalat.matches('input, textarea, select')) {
    return talalat.closest<HTMLElement>('.field-type') ?? talalat
  }
  return talalat
}

/** Egy címke-elem látható szövege a kötelező-csillag, a nyelvjel és a hibaszámláló nélkül. */
function lathatoSzoveg(elem: Element | null | undefined): string | null {
  if (!elem) {
    return null
  }
  const masolat = elem.cloneNode(true)
  if (!(masolat instanceof Element)) {
    return null
  }
  for (const zaj of masolat.querySelectorAll('.required, .localized, .error-pill')) {
    zaj.remove()
  }
  const szoveg = (masolat.textContent ?? '').replace(/\s+/g, ' ').trim()
  return szoveg === '' ? null : szoveg
}

/**
 * A mező látható címkéje: a doboz első `.field-label`-je
 * (fields/FieldLabel/index.js:43; a csoportnál és a tömbnél a fejlécben áll,
 * tehát a belső mezők címkéi előtt), végső esetben null.
 */
export function mezoCimkeje(doboz: Element): string | null {
  return lathatoSzoveg(doboz.querySelector('.field-label'))
}

/**
 * A mező és a `hatar` között álló CSUKOTT dobozok, kívülről befelé (a
 * kinyitás sorrendje). A `hatar` (pl. a szekciósor) maga nem számít.
 */
export function csukottOsok(elem: Element, hatar: Element | null): Element[] {
  const osok: Element[] = []
  for (
    let csomopont = elem.parentElement;
    csomopont && csomopont !== hatar;
    csomopont = csomopont.parentElement
  ) {
    if (csomopont.matches('.collapsible.collapsible--collapsed')) {
      osok.unshift(csomopont)
    }
  }
  return osok
}

/**
 * Kirajzolta-e a Payload a mező belsejét. A csoport és a tömb belső mezői
 * lustán rajzolódnak (RenderIfInViewport); a szöveges mezőnek nincs belseje.
 */
export function mezoKirajzolva(doboz: Element): boolean {
  if (doboz.querySelector('.shimmer-effect')) {
    return false
  }
  const belso = doboz.querySelector('.render-fields')
  return belso === null || belso.firstElementChild !== null
}

/**
 * A sor első beviteli mezője (a `beviteliMezok` első eleme): elsőként a
 * szerkeszthető mező; ha nincs (csak olvasható jog), az első mező.
 */
export function elsoBeviteliMezo(sor: Element): HTMLElement | null {
  return beviteliMezok(sor)[0] ?? null
}

/**
 * A ragadós elem beragadási doboza: a legközelebbi ős, amelynek van saját
 * doboza. A `display: contents` ős nem ad dobozt, ezért átlépjük. Ok (mérve
 * a helyi adminban 320 px-en, 2026-09-23): a custom.scss:1005-1016 mobilon a
 * `.doc-controls` sávot és burkolóját `display: contents`-re állítja, így a
 * 48 px-es ragadós gombsor (`.doc-controls__controls-wrapper`) a
 * szerkesztő-oszlopban ragad; a közvetlen szülőre néző szabály kihagyta, és
 * a megnyitott mező teteje a gombsor alá került.
 */
function ragadasiDoboz(elem: Element, ablak: Window): Element | null {
  let szulo = elem.parentElement
  while (szulo && ablak.getComputedStyle(szulo).display === 'contents') {
    szulo = szulo.parentElement
  }
  return szulo
}

/**
 * A sor fölött álló ragadós vagy rögzített sávok alja, beragadt állapotban
 * (px a nézetablak tetejétől). Csak az a sáv számít, amely vízszintesen a
 * sor fölé ér, nem tartalmazza a sort, és nem teljes magasságú oldalsáv.
 * Ragadós (sticky) elem csak akkor, ha a beragadási doboza (a szülője, a
 * `display: contents` ősöket átlépve) a sort is tartalmazza: a ragadós elem
 * ezen belül ragad be, így egy MÁSIK szekció ragadós
 * eszköztára (pl. a szövegszerkesztőé) a cél fölött nem áll.
 */
export function ragadosSavAlja(sor: Element, ablak: Window): number {
  const sorDoboz = sor.getBoundingClientRect()
  let alja = 0
  for (const elem of ablak.document.body.querySelectorAll('*')) {
    if (elem.contains(sor)) {
      continue
    }
    const stilus = ablak.getComputedStyle(elem)
    if (stilus.position !== 'sticky' && stilus.position !== 'fixed') {
      continue
    }
    if (stilus.position === 'sticky' && !ragadasiDoboz(elem, ablak)?.contains(sor)) {
      continue
    }
    const doboz = elem.getBoundingClientRect()
    const atfed = doboz.left < sorDoboz.right && doboz.right > sorDoboz.left
    if (!atfed || doboz.height <= 0 || doboz.height > ablak.innerHeight * 0.5) {
      continue
    }
    if (stilus.position === 'fixed') {
      if (doboz.top <= 1) {
        alja = Math.max(alja, doboz.bottom)
      }
      continue
    }
    const teteje = Number.parseFloat(stilus.top)
    if (Number.isFinite(teteje)) {
      alja = Math.max(alja, teteje + doboz.height)
    }
  }
  return alja
}

/** A görgetés célja: a sor teteje a ragadós sáv alatt a tartalékkal. */
export function gorgetesCel(
  aktualisGorgetes: number,
  sorTeteje: number,
  ragadosAlja: number,
  tartalek: number = GORGETESI_TARTALEK_PX,
): number {
  return Math.max(0, Math.round(aktualisGorgetes + sorTeteje - (ragadosAlja + tartalek)))
}

export interface SorHelyzet {
  /** A sor teteje a nézetablak tetejétől (px). */
  teteje: number
  ragadosAlja: number
  /**
   * Az a görgetési helyzet, amelyben a sor teteje a ragadós sáv alatt a
   * tartalékkal állna, a lap határaira szorítva (az első és az utolsó sor
   * a lap szélén nem vihető feljebb).
   */
  cel: number
  /** A görgetés a célhelyzetben áll (±POZICIO_TURES_PX). */
  helyen: boolean
  /**
   * A sor teteje a ragadós sáv alatt legalább MIN_RES_PX-szel és a
   * nézetablakon belül áll (SC 2.4.11).
   */
  latszik: boolean
}

/** A sor mostani helyzete a nézetablakban és a célhelyzethez képest. */
export function sorHelyzete(
  sor: Element,
  ablak: Window,
  ragadosAlja: number = ragadosSavAlja(sor, ablak),
): SorHelyzet {
  const teteje = sor.getBoundingClientRect().top
  const gyoker = ablak.document.documentElement
  const nezetMagassag = gyoker.clientHeight || ablak.innerHeight
  const maxGorgetes = Math.max(0, gyoker.scrollHeight - nezetMagassag)
  const cel = Math.min(gorgetesCel(ablak.scrollY, teteje, ragadosAlja), maxGorgetes)
  return {
    teteje,
    ragadosAlja,
    cel,
    helyen: Math.abs(ablak.scrollY - cel) <= POZICIO_TURES_PX,
    latszik: teteje >= ragadosAlja + MIN_RES_PX && teteje < ablak.innerHeight,
  }
}

/**
 * Kirajzolta-e már a Payload a sor mezőit. A blokk mezői egy `.render-fields`
 * dobozba kerülnek, amely a nézetbe kerülésig üres
 * (@payloadcms/ui/dist/forms/RenderFields, RenderIfInViewport); betöltés
 * közben a helyén `.shimmer-effect` áll.
 */
export function tartalomKirajzolva(sor: Element): boolean {
  const tartalom = sor.querySelector('.collapsible__content')
  if (!tartalom || tartalom.querySelector('.shimmer-effect')) {
    return false
  }
  return tartalom.querySelector('.render-fields > *') !== null
}

/** Csökkentett mozgást kér-e a felhasználó. */
export function csokkentettMozgas(ablak: Window): boolean {
  return ablak.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

/**
 * Megvárja, hogy a `keres` elemet adjon (MutationObserver), legfeljebb
 * `idokorlat` ms-ig; megszakításnál vagy időtúllépésnél null.
 */
export function varjElemre<T>(
  gyoker: Node,
  keres: () => T | null,
  idokorlat: number,
  signal: AbortSignal,
): Promise<T | null> {
  const most = keres()
  if (most !== null || signal.aborted) {
    return Promise.resolve(most)
  }
  return new Promise((resolve) => {
    const figyelo = new MutationObserver(() => {
      const talalat = keres()
      if (talalat !== null) {
        vege(talalat)
      }
    })
    const ido = setTimeout(() => vege(keres()), idokorlat)
    const megszakitas = () => vege(null)
    function vege(ertek: T | null) {
      figyelo.disconnect()
      clearTimeout(ido)
      signal.removeEventListener('abort', megszakitas)
      resolve(ertek)
    }
    signal.addEventListener('abort', megszakitas)
    figyelo.observe(gyoker, { childList: true, subtree: true, attributes: true })
  })
}

/** A dokumentum legújabb változatának lekérése (REST, a felhasználó sütijével). */
export type DokumentumLekero = (
  collection: string,
  id: string,
  signal: AbortSignal,
) => Promise<unknown>

export type MegnyitasEredmeny =
  | {
      tipus: 'megnyitva'
      cimke: string
      /** A fókuszt kapott beviteli mező; null, ha a fókusz magára a sorra került. */
      mezo: HTMLElement | null
      /** Leveszi a kiemelést és leállítja az utókövetést (navigációkor hívandó). */
      kiemelesVege: () => void
      /**
       * Csak `?mezo=` mellett: megnyílt-e a mező is (a címkéjével), vagy a
       * mező nincs a sorban, és csak a szekció nyílt meg.
       */
      celMezo?: { allapot: 'megnyitva'; cimke: string } | { allapot: 'nincs' }
    }
  | { tipus: 'elavult' }
  | { tipus: 'nem-sikerult' }
  | { tipus: 'felhasznalo-atvette' }
  | { tipus: 'megszakitva' }

/** A következő képkocka; háttérlapon (ahol nincs képkocka) legkésőbb 100 ms múlva. */
function kovetkezoKepkocka(ablak: Window): Promise<void> {
  return new Promise((resolve) => {
    const ido = setTimeout(resolve, 100)
    ablak.requestAnimationFrame(() => {
      clearTimeout(ido)
      resolve()
    })
  })
}

/** `ms` ezredmásodperc várakozás; megszakításnál azonnal véget ér. */
function varakozas(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const vege = () => {
      clearTimeout(ido)
      signal.removeEventListener('abort', vege)
      resolve()
    }
    const ido = setTimeout(vege, Math.max(0, ms))
    signal.addEventListener('abort', vege)
  })
}

/**
 * Megvárja, hogy a lap látható legyen: háttérlapon a böngésző nem rajzol, így
 * a lustán rajzolt mezők sem jelennek meg. Visszaadja a várakozás hosszát
 * (ms), amellyel a hívó az időkorlátot kitolja.
 */
function varjLathatora(dokumentum: Document, signal: AbortSignal): Promise<number> {
  if (dokumentum.visibilityState !== 'hidden' || signal.aborted) {
    return Promise.resolve(0)
  }
  const kezdet = Date.now()
  return new Promise((resolve) => {
    const valtozas = () => {
      if (dokumentum.visibilityState === 'hidden' && !signal.aborted) {
        return
      }
      dokumentum.removeEventListener('visibilitychange', valtozas)
      signal.removeEventListener('abort', valtozas)
      resolve(Date.now() - kezdet)
    }
    dokumentum.addEventListener('visibilitychange', valtozas)
    signal.addEventListener('abort', valtozas)
  })
}

interface HelyzetMinta {
  teteje: number
  magassag: number
}

function helyzetMinta(sor: Element, ablak: Window): HelyzetMinta {
  return {
    teteje: sor.getBoundingClientRect().top,
    magassag: ablak.document.documentElement.scrollHeight,
  }
}

/**
 * Megvárja, hogy a sor teteje és a lap magassága két egymást követő mintában
 * ne változzon (minták: képkocka + MINTA_KOZ_MS), legfeljebb `idokorlat`
 * ms-ig. Igaz, ha a helyzet stabil lett.
 */
async function varjStabilHelyzetre(
  sor: Element,
  ablak: Window,
  idokorlat: number,
  signal: AbortSignal,
): Promise<boolean> {
  const hatarido = Date.now() + idokorlat
  await kovetkezoKepkocka(ablak)
  let elozo = helyzetMinta(sor, ablak)
  while (!signal.aborted && Date.now() < hatarido) {
    await kovetkezoKepkocka(ablak)
    await varakozas(MINTA_KOZ_MS, signal)
    const most = helyzetMinta(sor, ablak)
    if (Math.abs(most.teteje - elozo.teteje) < 1 && Math.abs(most.magassag - elozo.magassag) < 1) {
      return true
    }
    elozo = most
  }
  return false
}

/** A felhasználó saját mozdulatai: görgetés, billentyű, kattintás, érintés. */
export const BEAVATKOZAS_ESEMENYEK = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const

/** Figyeli, hogy a felhasználó a nyitás közben átvette-e az irányítást. */
function beavatkozasFigyelo(ablak: Window): { volt: () => boolean; vege: () => void } {
  let volt = false
  const jelez = () => {
    volt = true
  }
  for (const nev of BEAVATKOZAS_ESEMENYEK) {
    ablak.addEventListener(nev, jelez, { capture: true, passive: true })
  }
  return {
    volt: () => volt,
    vege: () => {
      for (const nev of BEAVATKOZAS_ESEMENYEK) {
        ablak.removeEventListener(nev, jelez, { capture: true })
      }
    },
  }
}

/**
 * A fókusz magára a sorra kerül ideiglenes `tabindex="-1"`-gyel, amely a sor
 * elhagyásakor (blur) lekerül. Ha a sornak saját tabindexe van, azt nem
 * bántja. Visszaadja a takarító függvényt.
 */
function sortFokuszal(sor: HTMLElement): () => void {
  if (sor.hasAttribute('tabindex')) {
    sor.focus({ preventScroll: true })
    return () => undefined
  }
  const levesz = () => {
    sor.removeAttribute('tabindex')
    sor.removeEventListener('blur', levesz)
  }
  sor.setAttribute('tabindex', '-1')
  sor.addEventListener('blur', levesz)
  sor.focus({ preventScroll: true })
  return levesz
}

/**
 * A jelölteket sorban fókuszálja (legfeljebb FOKUSZ_JELOLTEK_MAX mezőt), és
 * azt adja vissza, amelyik a fókuszt ténylegesen felvette
 * (`document.activeElement`). Null, ha egyik sem: például a becsukott belső
 * sor `display: none` mezője nem veszi fel.
 */
function mezotFokuszal(jeloltek: HTMLElement[], dokumentum: Document): HTMLElement | null {
  for (const jelolt of jeloltek.slice(0, FOKUSZ_JELOLTEK_MAX)) {
    jelolt.focus({ preventScroll: true })
    if (dokumentum.activeElement === jelolt) {
      return jelolt
    }
  }
  return null
}

/**
 * A kiemelés (`attr`) a célra kerül, és akkor szűnik meg, amikor a
 * felhasználó a célon kívülre kattint vagy onnan kiviszi a fókuszt.
 */
function kiemel(cel: Element, dokumentum: Document, attr: string = KIEMELES_ATTR): () => void {
  cel.setAttribute(attr, '')
  const kint = (esemeny: Event) => {
    const celpont = esemeny.target
    if (celpont instanceof Node && cel.contains(celpont)) {
      return
    }
    vege()
  }
  function vege() {
    cel.removeAttribute(attr)
    dokumentum.removeEventListener('pointerdown', kint, true)
    dokumentum.removeEventListener('focusin', kint, true)
  }
  dokumentum.addEventListener('pointerdown', kint, true)
  dokumentum.addEventListener('focusin', kint, true)
  return vege
}

/**
 * Utókövetés a sikeres megnyitás után. Csak az elrendezés-eltolódást
 * igazítja: ha a görgetés nem változott, a cél mégis elmozdult (pl. a fölötte
 * álló képmezők előnézete betöltődött), animáció nélkül visszaviszi a
 * célhelyzetbe. Ha a görgetés változott, de a cél a nézetben helyben maradt,
 * az a böngésző scroll anchoring igazítása („adjusting the scroll position
 * to compensate for the changes outside the viewport”,
 * https://drafts.csswg.org/css-scroll-anchoring/), ezt tudomásul veszi.
 * Minden más görgetésnél azonnal leáll, bemeneti esemény nélkül is (pl.
 * képernyőolvasó vagy hangvezérlés görget), és akkor is, ha a görgetés és a
 * cél egyszerre mozdult, mert kétes esetben a felhasználó a fontosabb.
 * Leáll `idotartam` után, a cél eltűnésekor, a `vege` hívásakor, és amint a
 * felhasználó görget, gépel, kattint vagy érint. A fókuszt nem mozdítja.
 * A célt minden mintánál a `keres` adja (a Payload újrarajzolhatja).
 */
function utokovetes(
  kezdoCel: Element,
  keres: () => Element | null,
  ablak: Window,
  ragadosAlja: number,
  idotartam: number,
): () => void {
  const figyelo = beavatkozasFigyelo(ablak)
  const vezerlo = new AbortController()
  const vege = () => {
    if (!vezerlo.signal.aborted) {
      vezerlo.abort()
      figyelo.vege()
    }
  }
  const hatarido = Date.now() + idotartam
  // A görgetés, amelyet az utolsó saját lépésünk után várunk, és a cél
  // nézetbeli teteje az előző mintában.
  let vart = ablak.scrollY
  let elozoTeteje = kezdoCel.getBoundingClientRect().top
  void (async () => {
    while (!vezerlo.signal.aborted && Date.now() < hatarido) {
      await kovetkezoKepkocka(ablak)
      await varakozas(MINTA_KOZ_MS, vezerlo.signal)
      const cel = keres()
      if (vezerlo.signal.aborted || figyelo.volt() || !cel) {
        break
      }
      const y = ablak.scrollY
      const teteje = cel.getBoundingClientRect().top
      if (Math.abs(y - vart) > UTOKOVETES_TURES_PX) {
        // Nem mi görgettünk. Ha a cél a nézetben is elmozdult, valaki más
        // görgetett (vagy a görgetés és a cél egyszerre mozdult): leállunk.
        // Ha helyben maradt, a böngésző scroll anchoringja igazított.
        if (Math.abs(teteje - elozoTeteje) > UTOKOVETES_TURES_PX) {
          break
        }
        vart = y
      }
      const helyzet = sorHelyzete(cel, ablak, ragadosAlja)
      if (!helyzet.helyen && ablak.document.visibilityState !== 'hidden') {
        ablak.scrollTo({ top: helyzet.cel, behavior: 'instant' })
        vart = ablak.scrollY
      }
      elozoTeteje = cel.getBoundingClientRect().top
    }
    vege()
  })()
  return vege
}

export interface MegnyitasKornyezet {
  ablak: Window
  lekero: DokumentumLekero
  signal: AbortSignal
  /** Tesztekhez: a sor megjelenésének időkorlátja (alap: SOR_IDOKORLAT_MS). */
  sorIdokorlat?: number
  /** Tesztekhez: a helyén álló sor első mezőjére várás (alap: MEZO_IDOKORLAT_MS). */
  mezoIdokorlat?: number
  /** Tesztekhez: a pozicionálás teljes időkorlátja (alap: POZICIO_IDOKORLAT_MS). */
  pozicioIdokorlat?: number
  /** Tesztekhez: egy kör leghosszabb várakozása (alap: KOR_IDOKORLAT_MS). */
  korIdokorlat?: number
  /** Tesztekhez: az utókövetés hossza a sikeres megnyitás után (alap: UTOKOVETES_MS). */
  utokovetes?: number
}

/**
 * A pozicionálás célja: a szekciósor vagy egy mező doboza. A közös mag
 * (pozicionalas, veglegesites) ezen keresztül kezeli mindkettőt.
 */
interface Celpont {
  /** Az élő elem (a Payload újrarajzolhatja, ezért mindig újra keressük). */
  keres: () => HTMLElement | null
  /** Csukva van-e (a sor saját doboza, illetve a mező csukott ősei). */
  csukva: (elem: Element) => boolean
  /** Kinyitás a Payload SAJÁT gombjával. */
  kinyit: (elem: Element) => void
  /** A fókusz jelöltjei, sorrendben. */
  bevitelek: (elem: Element) => HTMLElement[]
  /** Kirajzolta-e már a Payload a tartalmát. */
  kirajzolva: (elem: Element) => boolean
}

function sorCelpont(dokumentum: Document, domId: string): Celpont {
  return {
    keres: () => dokumentum.getElementById(domId),
    csukva: sorCsukva,
    kinyit: (sor) => sorDoboza(sor).gomb?.click(),
    bevitelek: beviteliMezok,
    kirajzolva: tartalomKirajzolva,
  }
}

/** Egy mező doboza mint cél; a `hatar` (pl. a szekciósor) csukott dobozát nem bántja. */
function mezoCelpont(keres: () => HTMLElement | null, hatar: () => Element | null): Celpont {
  return {
    keres,
    csukva: (elem) => csukottOsok(elem, hatar()).length > 0,
    kinyit: (elem) => {
      for (const doboz of csukottOsok(elem, hatar())) {
        csukhatoGombja(doboz)?.click()
      }
    },
    bevitelek: mezoBevitelei,
    kirajzolva: mezoKirajzolva,
  }
}

/** A közös mag környezete: a lekérő nélkül (a mező-ágnak nincs rá szüksége). */
type PozicioKornyezet = Omit<MegnyitasKornyezet, 'lekero'>

type PozicioVege = 'kesz' | 'megszakitva' | 'felhasznalo-atvette'

/**
 * KONVERGÁLÓ POZICIONÁLÁS (a fejkomment 3–4. pontja): kinyitás, görgetés a
 * ragadós sáv alá, várakozás a stabil helyzetre és az első beviteli mezőre,
 * körönként ellenőrizve. `animaltLehet`: az első görgetés lehet-e animált
 * (egy második, mezőszintű szakaszban már nem).
 */
async function pozicionalas(
  cel: Celpont,
  kornyezet: PozicioKornyezet,
  beavatkozott: () => boolean,
  animaltKezdet: boolean,
): Promise<PozicioVege> {
  const { ablak, signal } = kornyezet
  const dokumentum = ablak.document
  const korIdokorlat = kornyezet.korIdokorlat ?? KOR_IDOKORLAT_MS
  const mezoIdokorlat = kornyezet.mezoIdokorlat ?? MEZO_IDOKORLAT_MS
  let hatarido = Date.now() + (kornyezet.pozicioIdokorlat ?? POZICIO_IDOKORLAT_MS)
  let animaltLehet = animaltKezdet && !csokkentettMozgas(ablak)
  let kinyitasok = 0
  let helyenOta: number | null = null
  let uresKorok = 0
  for (let kor = 0; kor < MAX_POZICIO_KOR; kor += 1) {
    hatarido += await varjLathatora(dokumentum, signal)
    if (signal.aborted) {
      return 'megszakitva'
    }
    if (beavatkozott()) {
      return 'felhasznalo-atvette'
    }
    const hatraVan = hatarido - Date.now()
    // A Payload a célt újra is rajzolhatja: mindig az élő elemmel dolgozunk.
    const elem = cel.keres()
    if (hatraVan <= 0 || !elem) {
      break
    }
    if (cel.csukva(elem) && kinyitasok < 2) {
      cel.kinyit(elem)
      kinyitasok += 1
    }
    const ragados = ragadosSavAlja(elem, ablak)
    const elotte = sorHelyzete(elem, ablak, ragados)
    if (!elotte.helyen) {
      // Csak az első görgetés lehet animált; minden korrekció azonnali.
      ablak.scrollTo({ top: elotte.cel, behavior: animaltLehet ? 'smooth' : 'instant' })
      animaltLehet = false
    }
    await varjStabilHelyzetre(elem, ablak, Math.min(korIdokorlat, hatraVan), signal)
    if (signal.aborted) {
      return 'megszakitva'
    }
    if (beavatkozott()) {
      return 'felhasznalo-atvette'
    }
    if (!sorHelyzete(elem, ablak, ragados).helyen) {
      helyenOta = null
      uresKorok = 0
      continue
    }
    if (cel.bevitelek(elem)[0]) {
      break
    }
    // A cél a helyén van, de az első mezője még nincs kirajzolva, vagy nincs is.
    helyenOta ??= Date.now()
    uresKorok = cel.kirajzolva(elem) ? uresKorok + 1 : 0
    if (uresKorok >= 2 || Date.now() - helyenOta >= mezoIdokorlat) {
      break
    }
    await varjElemre(
      elem,
      () => cel.bevitelek(elem)[0] ?? null,
      Math.min(korIdokorlat, Math.max(0, hatarido - Date.now())),
      signal,
    )
    // A mező megjelenése a célt és a lapot is megnövelheti: a következő kör
    // újra ellenőrzi a helyzetet.
  }
  if (signal.aborted) {
    return 'megszakitva'
  }
  if (beavatkozott()) {
    return 'felhasznalo-atvette'
  }
  return 'kesz'
}

interface Vegallapot {
  /** Az élő cél a végállapotban. */
  elem: HTMLElement
  /** A fókuszt kapott beviteli mező; null, ha a fókusz magára a célra került. */
  mezo: HTMLElement | null
  kiemelesVege: () => void
}

/**
 * VÉGSŐ ELLENŐRZÉS: „megnyitva” csak igazolt végállapotra (SC 4.1.3). A cél
 * a ragadós sáv alatt látszik, a fókusz a célban van (activeElement); csak
 * ekkor kap kiemelést és utókövetést. Null, ha nem igazolható.
 */
function veglegesites(cel: Celpont, kornyezet: PozicioKornyezet, attr: string): Vegallapot | null {
  const { ablak } = kornyezet
  const dokumentum = ablak.document
  const elem = cel.keres()
  if (!elem) {
    return null
  }
  const ragados = ragadosSavAlja(elem, ablak)
  if (!sorHelyzete(elem, ablak, ragados).latszik) {
    return null
  }
  const mezo = mezotFokuszal(cel.bevitelek(elem), dokumentum)
  const tabindexLevetele = mezo ? null : sortFokuszal(elem)
  const aktiv = dokumentum.activeElement
  if (!aktiv || !elem.contains(aktiv) || !sorHelyzete(elem, ablak, ragados).latszik) {
    if (aktiv === elem) {
      elem.blur()
    }
    tabindexLevetele?.()
    return null
  }
  const kiemelesLevetele = kiemel(elem, dokumentum, attr)
  const utokovetesVege = utokovetes(
    elem,
    cel.keres,
    ablak,
    ragados,
    kornyezet.utokovetes ?? UTOKOVETES_MS,
  )
  return {
    elem,
    mezo,
    kiemelesVege: () => {
      utokovetesVege()
      kiemelesLevetele()
    },
  }
}

/**
 * A megnyitás lépései (a DOM és a lekérő injektálva, így tesztelhető).
 * Kivételt nem dob: minden hiba az eredményben jelenik meg.
 */
export async function szekcioMegnyitasa(
  terv: Extract<MegnyitasTerv, { tipus: 'megnyitas' }>,
  kornyezet: MegnyitasKornyezet,
): Promise<MegnyitasEredmeny> {
  const figyelo = beavatkozasFigyelo(kornyezet.ablak)
  try {
    return await megnyitasLepesei(terv, kornyezet, figyelo.volt)
  } finally {
    figyelo.vege()
  }
}

async function megnyitasLepesei(
  terv: Extract<MegnyitasTerv, { tipus: 'megnyitas' }>,
  kornyezet: MegnyitasKornyezet,
  beavatkozott: () => boolean,
): Promise<MegnyitasEredmeny> {
  const { ablak, lekero, signal } = kornyezet
  const dokumentum = ablak.document
  const megszakitva = { tipus: 'megszakitva' } as const
  const atvette = { tipus: 'felhasznalo-atvette' } as const
  let adat: unknown
  try {
    adat = await lekero(terv.collection, terv.id, signal)
  } catch {
    return signal.aborted ? megszakitva : { tipus: 'nem-sikerult' }
  }
  if (signal.aborted) {
    return megszakitva
  }
  const tomb =
    typeof adat === 'object' && adat !== null
      ? (adat as Readonly<Record<string, unknown>>)[terv.mezo]
      : undefined
  const index = szekcioIndexe(tomb, terv.blokkId)
  if (index === null) {
    return { tipus: 'elavult' }
  }

  const domId = szekcioSorDomId(terv.mezo, index)
  const elsoSor = await varjElemre(
    dokumentum.body,
    () => dokumentum.getElementById(domId),
    kornyezet.sorIdokorlat ?? SOR_IDOKORLAT_MS,
    signal,
  )
  if (signal.aborted) {
    return megszakitva
  }
  if (!elsoSor) {
    return { tipus: 'nem-sikerult' }
  }
  if (beavatkozott()) {
    return atvette
  }

  const sorCel = sorCelpont(dokumentum, domId)
  const sorPozicio = await pozicionalas(sorCel, kornyezet, beavatkozott, true)
  if (sorPozicio !== 'kesz') {
    return sorPozicio === 'megszakitva' ? megszakitva : atvette
  }

  if (terv.celMezo !== undefined) {
    // MEZŐSZINTŰ SZAKASZ (a fejkomment „Mező-mélylink” a) pontja): a sor már
    // a helyén van, a mezőt a sorban keressük.
    const abszolut = `${terv.mezo}.${String(index)}.${terv.celMezo}`
    const mezoKeres = () => {
      const sor = dokumentum.getElementById(domId)
      return sor ? mezoDoboza(sor, abszolut) : null
    }
    const korIdokorlat = kornyezet.korIdokorlat ?? KOR_IDOKORLAT_MS
    const mezoIdokorlat = kornyezet.mezoIdokorlat ?? MEZO_IDOKORLAT_MS
    const talalt = await varjElemre(
      dokumentum.body,
      mezoKeres,
      Math.min(korIdokorlat, mezoIdokorlat),
      signal,
    )
    if (signal.aborted) {
      return megszakitva
    }
    if (beavatkozott()) {
      return atvette
    }
    if (talalt) {
      const mezoCel = mezoCelpont(mezoKeres, () => dokumentum.getElementById(domId))
      const mezoPozicio = await pozicionalas(mezoCel, kornyezet, beavatkozott, false)
      if (mezoPozicio !== 'kesz') {
        return mezoPozicio === 'megszakitva' ? megszakitva : atvette
      }
      const vegso = veglegesites(mezoCel, kornyezet, MEZO_KIEMELES_ATTR)
      const sor = dokumentum.getElementById(domId)
      if (!vegso || !sor) {
        vegso?.kiemelesVege()
        return { tipus: 'nem-sikerult' }
      }
      return {
        tipus: 'megnyitva',
        cimke: sorCimke(sor, index),
        mezo: vegso.mezo,
        kiemelesVege: vegso.kiemelesVege,
        celMezo: {
          allapot: 'megnyitva',
          cimke: mezoCimkeje(vegso.elem) ?? terv.celMezo,
        },
      }
    }
    // A mező nincs a sorban: a szekció a mai módon nyílik, figyelmeztetéssel.
  }

  const vegso = veglegesites(sorCel, kornyezet, KIEMELES_ATTR)
  if (!vegso) {
    return { tipus: 'nem-sikerult' }
  }
  return {
    tipus: 'megnyitva',
    cimke: sorCimke(vegso.elem, index),
    mezo: vegso.mezo,
    kiemelesVege: vegso.kiemelesVege,
    ...(terv.celMezo !== undefined ? { celMezo: { allapot: 'nincs' } as const } : {}),
  }
}

/** Egy fül a mezőhöz vezető úton: hányadik fül, hány fülből, és a címkéje. */
export interface FulLepes {
  index: number
  darab: number
  /** A fül címkéje a kliens-configból (null, ha nincs szöveges címke). */
  cimke: string | null
}

export interface MezoHelye {
  /** A kiválasztandó fülek kívülről befelé (üres, ha a mező nincs fülön). */
  fulak: FulLepes[]
  /** A mező címkéje a kliens-configból. */
  cimke: string | null
}

type Rekord = Readonly<Record<string, unknown>>

function rekord(ertek: unknown): ertek is Rekord {
  return typeof ertek === 'object' && ertek !== null && !Array.isArray(ertek)
}

/**
 * A config-címke szövege: szöveg, vagy nyelvenkénti változat (a magyar, ha
 * van, különben az első szöveges); minden más null. A függvény-címkéket a
 * Payload a kliens-configban már szöveggé oldja
 * (payload/dist/fields/config/client.js, `tabs` ág).
 */
function cimkeSzoveg(cimke: unknown): string | null {
  if (typeof cimke === 'string') {
    return cimke.trim() === '' ? null : cimke
  }
  if (rekord(cimke)) {
    const hu = cimke.hu
    if (typeof hu === 'string' && hu.trim() !== '') {
      return hu
    }
    const elso = Object.values(cimke).find(
      (ertek): ertek is string => typeof ertek === 'string' && ertek.trim() !== '',
    )
    return elso ?? null
  }
  return null
}

function mezoKereses(
  mezok: readonly unknown[],
  szegmensek: readonly string[],
  fulak: readonly FulLepes[],
): MezoHelye | null {
  const [elso, ...tobbi] = szegmensek
  for (const mezo of mezok) {
    if (!rekord(mezo)) {
      continue
    }
    const nev = typeof mezo.name === 'string' && mezo.name !== '' ? mezo.name : null
    if (mezo.type === 'tabs' && Array.isArray(mezo.tabs)) {
      const tabok: readonly unknown[] = mezo.tabs
      for (const [index, ful] of tabok.entries()) {
        if (!rekord(ful) || !Array.isArray(ful.fields)) {
          continue
        }
        const fulNev = typeof ful.name === 'string' && ful.name !== '' ? ful.name : null
        const lepes: FulLepes = {
          index,
          darab: tabok.length,
          cimke: cimkeSzoveg(ful.label) ?? fulNev,
        }
        const belso: readonly unknown[] = ful.fields
        // A nevesített fül az útvonal része (mint a csoport), a névtelen nem.
        const talalat =
          fulNev === null
            ? mezoKereses(belso, szegmensek, [...fulak, lepes])
            : fulNev === elso && tobbi.length > 0
              ? mezoKereses(belso, tobbi, [...fulak, lepes])
              : null
        if (talalat) {
          return talalat
        }
      }
      continue
    }
    if (nev === null) {
      // Sor, csukható doboz, névtelen csoport: az útvonalnak nem része.
      if (Array.isArray(mezo.fields)) {
        const belso: readonly unknown[] = mezo.fields
        const talalat = mezoKereses(belso, szegmensek, fulak)
        if (talalat) {
          return talalat
        }
      }
      continue
    }
    if (nev !== elso) {
      continue
    }
    if (tobbi.length === 0) {
      return { fulak: [...fulak], cimke: cimkeSzoveg(mezo.label) }
    }
    if (mezo.type === 'group' && Array.isArray(mezo.fields)) {
      const belso: readonly unknown[] = mezo.fields
      return mezoKereses(belso, tobbi, fulak)
    }
    return null
  }
  return null
}

/**
 * Hol van a mező a gyűjtemény kliens-config mezőfájában: a hozzá vezető
 * fülek (tabs, a sorok, csukható dobozok és névtelen fülek bejárásával), és a
 * címkéje. Null, ha a mező nincs a fában (ismeretlen mező).
 */
export function mezoHelye(mezok: readonly unknown[], mezoUtvonal: string): MezoHelye | null {
  return mezoKereses(mezok, mezoUtvonal.split('.'), [])
}

/** A gyűjtemény mezőfája a kliens-configból; null, ha nem érhető el. */
export function gyujtemenyMezoi(
  gyujtemenyek: readonly unknown[] | null | undefined,
  slug: string,
): readonly unknown[] | null {
  if (!Array.isArray(gyujtemenyek)) {
    return null
  }
  const lista: readonly unknown[] = gyujtemenyek
  const gyujtemeny = lista.find((elem) => rekord(elem) && elem.slug === slug)
  if (!rekord(gyujtemeny) || !Array.isArray(gyujtemeny.fields)) {
    return null
  }
  const mezok: readonly unknown[] = gyujtemeny.fields
  return mezok
}

/**
 * A fülsor gombjai a Payload szerkezetében: `.tabs-field` >
 * `.tabs-field__tabs-wrap` > `.tabs-field__tabs` > `button.tabs-field__tab-button`
 * (@payloadcms/ui/dist/fields/Tabs/index.js:22 és 261-267, Tab/index.js:12 és 36).
 * A gombok a config sorrendjében állnak, a feltétel miatt rejtettek is
 * (`--hidden`), így az index a config indexével egyezik (Tabs/index.js:83-91).
 */
export function fulGombok(fulMezo: Element): HTMLElement[] {
  return [
    ...fulMezo.querySelectorAll<HTMLElement>(
      ':scope > .tabs-field__tabs-wrap > .tabs-field__tabs > .tabs-field__tab-button',
    ),
  ]
}

/** A fülgomb látható felirata (a hibaszámláló nélkül). */
export function fulGombCimke(gomb: Element): string | null {
  return lathatoSzoveg(gomb)
}

/**
 * A lépéshez tartozó fülsor a hatókörben: azonos számú fülgomb, és ha a
 * config-címke ismert, a megfelelő gomb felirata is egyezik.
 */
export function fulMezoKeresese(hatokor: ParentNode, lepes: FulLepes): Element | null {
  const jeloltek = [...hatokor.querySelectorAll('.tabs-field')].filter(
    (ful) => fulGombok(ful).length === lepes.darab,
  )
  if (lepes.cimke !== null) {
    const cimkevel = jeloltek.find((ful) => {
      const gomb = fulGombok(ful)[lepes.index]
      return gomb !== undefined && fulGombCimke(gomb) === lepes.cimke
    })
    if (cimkevel) {
      return cimkevel
    }
  }
  return jeloltek[0] ?? null
}

export type MezoMegnyitasEredmeny =
  | {
      tipus: 'megnyitva'
      /** A kiválasztott (legbelső) fül látható neve; null, ha a mező nincs fülön. */
      fulNev: string | null
      /** A mező látható címkéje (tartalékként a config-címke, végül az útvonal). */
      mezoCimke: string
      /** A fókuszt kapott beviteli elem; null, ha a fókusz a mező dobozára került. */
      mezo: HTMLElement | null
      kiemelesVege: () => void
    }
  | { tipus: 'mezo-nem-talalhato' }
  | { tipus: 'nem-sikerult' }
  | { tipus: 'felhasznalo-atvette' }
  | { tipus: 'megszakitva' }

export interface MezoKornyezet extends PozicioKornyezet {
  /** A gyűjtemény kliens-config mezőfája; null, ha nem érhető el. */
  mezok: readonly unknown[] | null
}

/**
 * Mező-mélylink szekció nélkül (a fejkomment „Mező-mélylink” b) pontja).
 * Kivételt nem dob: minden hiba az eredményben jelenik meg.
 */
export async function mezoMegnyitasa(
  terv: Extract<MegnyitasTerv, { tipus: 'mezo-megnyitas' }>,
  kornyezet: MezoKornyezet,
): Promise<MezoMegnyitasEredmeny> {
  const figyelo = beavatkozasFigyelo(kornyezet.ablak)
  try {
    return await mezoLepesei(terv, kornyezet, figyelo.volt)
  } finally {
    figyelo.vege()
  }
}

/**
 * A fül-lánc élő elemei (fülsor + a lépés gombja), kívülről befelé; null, ha
 * valamelyik még nincs a DOM-ban.
 */
function fulLanc(
  dokumentum: Document,
  fulak: readonly FulLepes[],
): Array<{ ful: Element; gomb: HTMLElement }> | null {
  const lanc: Array<{ ful: Element; gomb: HTMLElement }> = []
  let hatokor: ParentNode = dokumentum
  for (const lepes of fulak) {
    const ful = fulMezoKeresese(hatokor, lepes)
    const gomb = ful ? fulGombok(ful)[lepes.index] : undefined
    if (!ful || !gomb) {
      return null
    }
    lanc.push({ ful, gomb })
    hatokor = ful.querySelector(':scope > .tabs-field__content-wrap') ?? ful
  }
  return lanc
}

function aktivFulGomb(gomb: Element): boolean {
  return gomb.classList.contains('tabs-field__tab-button--active')
}

/**
 * Legfeljebb ennyiszer választjuk ki a fület. Ok (mérve a helyi adminban,
 * 2026-09-23, /admin/collections/products/2?mezo=howItWorks): a Payload
 * Tabs mezője a felhasználó elmentett fülét a csatolás UTÁN, aszinkron
 * állítja vissza (@payloadcms/ui/dist/fields/Tabs/index.js:156-166,
 * getPreference → setActiveTabIndex), és ez felülírta a kattintásunkat: a
 * „Kurzusoldal” helyett a korábban használt „Haladás” fül maradt nyitva.
 * Ha a mező emiatt tűnik el, a fület újra kiválasztjuk.
 */
export const FUL_PROBA_MAX = 3

async function mezoLepesei(
  terv: Extract<MegnyitasTerv, { tipus: 'mezo-megnyitas' }>,
  kornyezet: MezoKornyezet,
  beavatkozott: () => boolean,
): Promise<MezoMegnyitasEredmeny> {
  const { ablak, signal } = kornyezet
  const dokumentum = ablak.document
  const megszakitva = { tipus: 'megszakitva' } as const
  const atvette = { tipus: 'felhasznalo-atvette' } as const
  const sorIdokorlat = kornyezet.sorIdokorlat ?? SOR_IDOKORLAT_MS
  const mezoIdokorlat = kornyezet.mezoIdokorlat ?? MEZO_IDOKORLAT_MS
  const hely = kornyezet.mezok ? mezoHelye(kornyezet.mezok, terv.mezo) : null
  if (kornyezet.mezok && hely === null) {
    // A config szerint nincs ilyen mező: nincs mire várni.
    return { tipus: 'mezo-nem-talalhato' }
  }
  const fulak = hely?.fulak ?? []
  const fulakAktivak = () => {
    const lanc = fulLanc(dokumentum, fulak)
    return lanc !== null && lanc.every(({ gomb }) => aktivFulGomb(gomb))
  }
  // A mező a teljes dokumentumban egyedi azonosítójú: ott keressük, mert a
  // fül tartalmát a Payload a váltáskor újrarajzolja.
  const keres = () => mezoDoboza(dokumentum, terv.mezo)
  let fulNev: string | null = null

  for (let proba = 0; proba < FUL_PROBA_MAX; proba += 1) {
    // FÜLVÁLASZTÁS a Payload saját fülgombjával, kívülről befelé.
    for (let lepes = 0; lepes < fulak.length; lepes += 1) {
      const eddig = fulak.slice(0, lepes + 1)
      const talalat = await varjElemre(
        dokumentum.body,
        () => fulLanc(dokumentum, eddig)?.at(-1) ?? null,
        proba === 0 ? sorIdokorlat : mezoIdokorlat,
        signal,
      )
      if (signal.aborted) {
        return megszakitva
      }
      if (!talalat) {
        return { tipus: 'nem-sikerult' }
      }
      if (beavatkozott()) {
        return atvette
      }
      if (!aktivFulGomb(talalat.gomb)) {
        talalat.gomb.click()
      }
      fulNev = fulGombCimke(talalat.gomb) ?? fulak[lepes]?.cimke ?? null
    }

    const elso = await varjElemre(
      dokumentum.body,
      keres,
      fulak.length > 0 ? mezoIdokorlat : sorIdokorlat,
      signal,
    )
    if (signal.aborted) {
      return megszakitva
    }
    if (beavatkozott()) {
      return atvette
    }
    if (!elso) {
      if (fulakAktivak()) {
        return { tipus: 'mezo-nem-talalhato' }
      }
      continue
    }
    const cel = mezoCelpont(keres, () => null)
    const pozicio = await pozicionalas(cel, kornyezet, beavatkozott, proba === 0)
    if (pozicio !== 'kesz') {
      return pozicio === 'megszakitva' ? megszakitva : atvette
    }
    const vegso = veglegesites(cel, kornyezet, MEZO_KIEMELES_ATTR)
    if (vegso) {
      return {
        tipus: 'megnyitva',
        fulNev,
        mezoCimke: mezoCimkeje(vegso.elem) ?? hely?.cimke ?? terv.mezo,
        mezo: vegso.mezo,
        kiemelesVege: vegso.kiemelesVege,
      }
    }
    if (fulakAktivak()) {
      // Nem a fül váltott vissza: a mező a helyén van, de nem igazolható.
      return { tipus: 'nem-sikerult' }
    }
  }
  return { tipus: 'nem-sikerult' }
}

/** A valódi lekérő: a Payload REST API-ja, a legújabb változat, mélység nélkül. */
function restLekero(apiAlap: string): DokumentumLekero {
  return async (collection, id, signal) => {
    const valasz = await fetch(
      `${apiAlap}/${encodeURIComponent(collection)}/${encodeURIComponent(id)}?depth=0&draft=true`,
      { credentials: 'include', headers: { Accept: 'application/json' }, signal },
    )
    if (!valasz.ok) {
      throw new Error(`HTTP ${String(valasz.status)}`)
    }
    return valasz.json() as Promise<unknown>
  }
}

/** A provider teendője egy nyitás végén. */
type Kimenet =
  | { tipus: 'megszakitva' }
  | { tipus: 'csend' }
  | { tipus: 'uzenet'; uzenet: Uzenet; kiemelesVege?: () => void }

function szekcioKimenet(vegeredmeny: MegnyitasEredmeny): Kimenet {
  switch (vegeredmeny.tipus) {
    case 'megszakitva':
      return { tipus: 'megszakitva' }
    case 'felhasznalo-atvette':
      // A felhasználó maga görgetett vagy kattintott: nincs mit jelenteni.
      return { tipus: 'csend' }
    case 'megnyitva': {
      const { celMezo, kiemelesVege } = vegeredmeny
      const uzenet =
        celMezo?.allapot === 'nincs'
          ? UZENETEK.mezoNincsASzekcioban
          : megnyitvaUzenet(
              vegeredmeny.cimke,
              celMezo?.allapot === 'megnyitva' ? celMezo.cimke : null,
            )
      return { tipus: 'uzenet', uzenet, kiemelesVege }
    }
    case 'elavult':
      return { tipus: 'uzenet', uzenet: UZENETEK.elavult }
    case 'nem-sikerult':
      return { tipus: 'uzenet', uzenet: UZENETEK.nemSikerult }
  }
}

function mezoKimenet(vegeredmeny: MezoMegnyitasEredmeny): Kimenet {
  switch (vegeredmeny.tipus) {
    case 'megszakitva':
      return { tipus: 'megszakitva' }
    case 'felhasznalo-atvette':
      return { tipus: 'csend' }
    case 'megnyitva': {
      const { fulNev, mezoCimke, kiemelesVege } = vegeredmeny
      const uzenet =
        fulNev === null ? megnyitvaUzenet(mezoCimke) : megnyitvaUzenet(fulNev, mezoCimke)
      return { tipus: 'uzenet', uzenet, kiemelesVege }
    }
    case 'mezo-nem-talalhato':
      return { tipus: 'uzenet', uzenet: UZENETEK.mezoNemTalalhato }
    case 'nem-sikerult':
      return { tipus: 'uzenet', uzenet: UZENETEK.mezoNemSikerult }
  }
}

export function SzekcioMegnyito({ children }: { children?: ReactNode }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { config } = useConfig()
  const adminRoute = config.routes.admin
  const apiAlap = `${config.serverURL ?? ''}${config.routes.api}`
  // A bejelentkezés előtti (hitelesítetlen) kliens-configban nincs mezőfa: a
  // mező-ág ekkor fülválasztás nélkül, csak a DOM-ban keres.
  const gyujtemenyek: readonly unknown[] | undefined = config.collections
  const szekcio = searchParams?.get(SZEKCIO_PARAM) ?? null
  const mezoParam = searchParams?.get(MEZO_PARAM) ?? null
  // Az üzenet a navigációhoz kötött: más útvonalon (vagy bezárás után) nem látszik.
  const [eredmeny, setEredmeny] = useState<{ kulcs: string; uzenet: Uzenet } | null>(null)
  const [bezartKulcs, setBezartKulcs] = useState<string | null>(null)
  const kezeltRef = useRef<string | null>(null)
  const aktualisKulcs = `${pathname ?? ''}?${szekcio ?? ''}&${mezoParam ?? ''}`
  const uzenet =
    eredmeny !== null && eredmeny.kulcs === aktualisKulcs && bezartKulcs !== aktualisKulcs
      ? eredmeny.uzenet
      : null

  useEffect(() => {
    const terv = megnyitasTerv(pathname, adminRoute, szekcio, mezoParam)
    if (terv.tipus === 'nincs') {
      kezeltRef.current = null
      return undefined
    }
    const kulcs = `${pathname ?? ''}?${szekcio ?? ''}&${mezoParam ?? ''}`
    if (kezeltRef.current === kulcs) {
      return undefined
    }
    kezeltRef.current = kulcs
    if (terv.tipus === 'hibas-azonosito' || terv.tipus === 'hibas-mezo') {
      const hibaUzenet =
        terv.tipus === 'hibas-azonosito' ? UZENETEK.hibasAzonosito : UZENETEK.hibasMezo
      // Az élő régió már üresen a helyén van, a szöveg utána érkezik: így a
      // képernyőolvasó felolvassa (a betöltéskor már benne álló szöveget nem).
      const ido = window.setTimeout(() => {
        setBezartKulcs(null)
        setEredmeny({ kulcs, uzenet: hibaUzenet })
      }, 0)
      return () => {
        window.clearTimeout(ido)
        if (kezeltRef.current === kulcs) {
          kezeltRef.current = null
        }
      }
    }

    const vezerlo = new AbortController()
    let kesz = false
    let kiemelesVege: (() => void) | null = null
    const folyamat: Promise<Kimenet> =
      terv.tipus === 'megnyitas'
        ? szekcioMegnyitasa(terv, {
            ablak: window,
            lekero: restLekero(apiAlap),
            signal: vezerlo.signal,
          }).then(szekcioKimenet)
        : mezoMegnyitasa(terv, {
            ablak: window,
            mezok: gyujtemenyMezoi(gyujtemenyek, terv.collection),
            signal: vezerlo.signal,
          }).then(mezoKimenet)
    void folyamat.then((kimenet) => {
      if (kimenet.tipus === 'megszakitva') {
        return
      }
      if (vezerlo.signal.aborted) {
        if (kimenet.tipus === 'uzenet') {
          kimenet.kiemelesVege?.()
        }
        return
      }
      kesz = true
      if (kimenet.tipus === 'csend') {
        return
      }
      setBezartKulcs(null)
      kiemelesVege = kimenet.kiemelesVege ?? null
      setEredmeny({ kulcs, uzenet: kimenet.uzenet })
    })
    return () => {
      vezerlo.abort()
      kiemelesVege?.()
      // A React fejlesztői módban kétszer futtatja a hatást: a félbeszakadt
      // megnyitást a második futás még elvégezheti.
      if (!kesz && kezeltRef.current === kulcs) {
        kezeltRef.current = null
      }
    }
  }, [adminRoute, apiAlap, gyujtemenyek, mezoParam, pathname, szekcio])

  const figyelem = uzenet?.tipus === 'figyelem'
  return (
    <>
      {children}
      <div
        className={
          figyelem
            ? 'kc-szekcio-megnyito kc-szekcio-megnyito--figyelem'
            : 'kc-szekcio-megnyito kc-szekcio-megnyito--rejtett'
        }
      >
        <div aria-atomic="true" className="kc-szekcio-megnyito__allapot" role="status">
          {uzenet ? (
            <>
              {uzenet.cim ? <p className="kc-szekcio-megnyito__cim">{uzenet.cim}</p> : null}
              <p className="kc-szekcio-megnyito__szoveg">{uzenet.szoveg}</p>
            </>
          ) : null}
        </div>
        {figyelem ? (
          <button
            className="kc-szekcio-megnyito__bezaras"
            onClick={() => setBezartKulcs(aktualisKulcs)}
            type="button"
          >
            {BEZARAS_FELIRAT}
          </button>
        ) : null}
      </div>
      <KetLapFigyelo bezarasFelirat={BEZARAS_FELIRAT} szekcioErtesitesLatszik={figyelem} />
    </>
  )
}

export default SzekcioMegnyito
