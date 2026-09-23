'use client'

import { useConfig } from '@payloadcms/ui'
import { usePathname, useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import {
  SZEKCIO_PARAM,
  ervenyesBlokkId,
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

export type MegnyitasTerv =
  | { tipus: 'nincs' }
  | { tipus: 'hibas-azonosito' }
  | { tipus: 'megnyitas'; collection: string; id: string; mezo: string; blokkId: string }

/**
 * Kell-e és lehet-e szekciót nyitni ezen az útvonalon. Csak pontosan egy
 * dokumentum-szerkesztőn (`<admin>/collections/<slug>/<id>`) és csak
 * szekció-tömbös gyűjteményben fut.
 */
export function megnyitasTerv(
  pathname: string | null,
  adminRoute: string,
  szekcio: string | null,
): MegnyitasTerv {
  if (pathname === null || szekcio === null) {
    return { tipus: 'nincs' }
  }
  const utvonal = szerkesztoUtvonal(pathname, adminRoute)
  const mezo = utvonal ? SZEKCIOS_GYUJTEMENYEK[utvonal.collection] : undefined
  if (!utvonal || !mezo) {
    return { tipus: 'nincs' }
  }
  if (!ervenyesBlokkId(szekcio)) {
    return { tipus: 'hibas-azonosito' }
  }
  return {
    tipus: 'megnyitas',
    collection: utvonal.collection,
    id: utvonal.id,
    mezo,
    blokkId: szekcio,
  }
}

export interface Uzenet {
  tipus: 'siker' | 'figyelem'
  /** A látható figyelmeztetés címe (sikernél nincs). */
  cim: string | null
  szoveg: string
}

const SZEKCIOK_HELYE = 'A lap szekcióit lent, a Szekciók alatt találod.'

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
} as const satisfies Record<string, Uzenet>

/** A sikeres megnyitás felolvasott szövege, a sorcímkével betűre egyezően (SC 3.2.4). */
export function megnyitvaUzenet(cimke: string): Uzenet {
  return { tipus: 'siker', cim: null, szoveg: `Megnyitva: ${cimke}` }
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

/** A sor saját (legkülső) csukható doboza és annak kinyitó gombja. */
function sorDoboza(sor: Element): { doboz: Element | null; gomb: HTMLElement | null } {
  const doboz = sor.querySelector(':scope > .collapsible')
  const gomb = doboz?.querySelector<HTMLElement>(
    ':scope > .collapsible__toggle-wrap > .collapsible__toggle',
  )
  return { doboz: doboz ?? null, gomb: gomb ?? null }
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
  const mezok = [...tartalom.querySelectorAll<HTMLElement>(ELSO_BEVITELI_MEZO)]
  return [...mezok.filter(irhatoMezo), ...mezok.filter((mezo) => !irhatoMezo(mezo))]
}

/**
 * A sor első beviteli mezője (a `beviteliMezok` első eleme): elsőként a
 * szerkeszthető mező; ha nincs (csak olvasható jog), az első mező.
 */
export function elsoBeviteliMezo(sor: Element): HTMLElement | null {
  return beviteliMezok(sor)[0] ?? null
}

/**
 * A sor fölött álló ragadós vagy rögzített sávok alja, beragadt állapotban
 * (px a nézetablak tetejétől). Csak az a sáv számít, amely vízszintesen a
 * sor fölé ér, nem tartalmazza a sort, és nem teljes magasságú oldalsáv.
 * Ragadós (sticky) elem csak akkor, ha a szülője a sort is tartalmazza: a
 * ragadós elem a szülőjén belül ragad be, így egy MÁSIK szekció ragadós
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
    if (stilus.position === 'sticky' && !elem.parentElement?.contains(sor)) {
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
 * A sor beviteli mezőit sorban fókuszálja (legfeljebb FOKUSZ_JELOLTEK_MAX
 * mezőt), és azt adja vissza, amelyik a fókuszt ténylegesen felvette
 * (`document.activeElement`). Null, ha egyik sem: például a becsukott belső
 * sor `display: none` mezője nem veszi fel.
 */
function mezotFokuszal(sor: Element, dokumentum: Document): HTMLElement | null {
  for (const jelolt of beviteliMezok(sor).slice(0, FOKUSZ_JELOLTEK_MAX)) {
    jelolt.focus({ preventScroll: true })
    if (dokumentum.activeElement === jelolt) {
      return jelolt
    }
  }
  return null
}

/**
 * A kiemelés a szekcióra kerül, és akkor szűnik meg, amikor a felhasználó a
 * szekción kívülre kattint vagy onnan kiviszi a fókuszt.
 */
function kiemel(sor: Element, dokumentum: Document): () => void {
  sor.setAttribute(KIEMELES_ATTR, '')
  const kint = (esemeny: Event) => {
    const cel = esemeny.target
    if (cel instanceof Node && sor.contains(cel)) {
      return
    }
    vege()
  }
  function vege() {
    sor.removeAttribute(KIEMELES_ATTR)
    dokumentum.removeEventListener('pointerdown', kint, true)
    dokumentum.removeEventListener('focusin', kint, true)
  }
  dokumentum.addEventListener('pointerdown', kint, true)
  dokumentum.addEventListener('focusin', kint, true)
  return vege
}

/**
 * Utókövetés a sikeres megnyitás után. Csak az elrendezés-eltolódást
 * igazítja: ha a görgetés nem változott, a sor mégis elmozdult (pl. a fölötte
 * álló képmezők előnézete betöltődött), animáció nélkül visszaviszi a
 * célhelyzetbe. Ha a görgetés változott, de a sor a nézetben helyben maradt,
 * az a böngésző scroll anchoring igazítása („adjusting the scroll position
 * to compensate for the changes outside the viewport”,
 * https://drafts.csswg.org/css-scroll-anchoring/), ezt tudomásul veszi.
 * Minden más görgetésnél azonnal leáll, bemeneti esemény nélkül is (pl.
 * képernyőolvasó vagy hangvezérlés görget), és akkor is, ha a görgetés és a
 * sor egyszerre mozdult, mert kétes esetben a felhasználó a fontosabb.
 * Leáll `idotartam` után, a sor eltűnésekor, a `vege` hívásakor, és amint a
 * felhasználó görget, gépel, kattint vagy érint. A fókuszt nem mozdítja.
 */
function utokovetes(
  kezdoSor: Element,
  ablak: Window,
  ragadosAlja: number,
  idotartam: number,
): () => void {
  const domId = kezdoSor.id
  const figyelo = beavatkozasFigyelo(ablak)
  const vezerlo = new AbortController()
  const vege = () => {
    if (!vezerlo.signal.aborted) {
      vezerlo.abort()
      figyelo.vege()
    }
  }
  const hatarido = Date.now() + idotartam
  // A görgetés, amelyet az utolsó saját lépésünk után várunk, és a sor
  // nézetbeli teteje az előző mintában.
  let vart = ablak.scrollY
  let elozoTeteje = kezdoSor.getBoundingClientRect().top
  void (async () => {
    while (!vezerlo.signal.aborted && Date.now() < hatarido) {
      await kovetkezoKepkocka(ablak)
      await varakozas(MINTA_KOZ_MS, vezerlo.signal)
      const sor = ablak.document.getElementById(domId)
      if (vezerlo.signal.aborted || figyelo.volt() || !sor) {
        break
      }
      const y = ablak.scrollY
      const teteje = sor.getBoundingClientRect().top
      if (Math.abs(y - vart) > UTOKOVETES_TURES_PX) {
        // Nem mi görgettünk. Ha a sor a nézetben is elmozdult, valaki más
        // görgetett (vagy a görgetés és a sor egyszerre mozdult): leállunk.
        // Ha helyben maradt, a böngésző scroll anchoringja igazított.
        if (Math.abs(teteje - elozoTeteje) > UTOKOVETES_TURES_PX) {
          break
        }
        vart = y
      }
      const helyzet = sorHelyzete(sor, ablak, ragadosAlja)
      if (!helyzet.helyen && ablak.document.visibilityState !== 'hidden') {
        ablak.scrollTo({ top: helyzet.cel, behavior: 'instant' })
        vart = ablak.scrollY
      }
      elozoTeteje = sor.getBoundingClientRect().top
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

  // KONVERGÁLÓ POZICIONÁLÁS (a fejkomment 3–4. pontja).
  const korIdokorlat = kornyezet.korIdokorlat ?? KOR_IDOKORLAT_MS
  const mezoIdokorlat = kornyezet.mezoIdokorlat ?? MEZO_IDOKORLAT_MS
  let hatarido = Date.now() + (kornyezet.pozicioIdokorlat ?? POZICIO_IDOKORLAT_MS)
  let animaltLehet = !csokkentettMozgas(ablak)
  let kinyitasok = 0
  let helyenOta: number | null = null
  let uresKorok = 0
  for (let kor = 0; kor < MAX_POZICIO_KOR; kor += 1) {
    hatarido += await varjLathatora(dokumentum, signal)
    if (signal.aborted) {
      return megszakitva
    }
    if (beavatkozott()) {
      return atvette
    }
    const hatraVan = hatarido - Date.now()
    // A Payload a sort újra is rajzolhatja: mindig az élő elemmel dolgozunk.
    const sor = dokumentum.getElementById(domId)
    if (hatraVan <= 0 || !sor) {
      break
    }
    if (sorCsukva(sor) && kinyitasok < 2) {
      sorDoboza(sor).gomb?.click()
      kinyitasok += 1
    }
    const ragados = ragadosSavAlja(sor, ablak)
    const elotte = sorHelyzete(sor, ablak, ragados)
    if (!elotte.helyen) {
      // Csak az első görgetés lehet animált; minden korrekció azonnali.
      ablak.scrollTo({ top: elotte.cel, behavior: animaltLehet ? 'smooth' : 'instant' })
      animaltLehet = false
    }
    await varjStabilHelyzetre(sor, ablak, Math.min(korIdokorlat, hatraVan), signal)
    if (signal.aborted) {
      return megszakitva
    }
    if (beavatkozott()) {
      return atvette
    }
    if (!sorHelyzete(sor, ablak, ragados).helyen) {
      helyenOta = null
      uresKorok = 0
      continue
    }
    if (elsoBeviteliMezo(sor)) {
      break
    }
    // A sor a helyén van, de az első mezője még nincs kirajzolva, vagy nincs is.
    helyenOta ??= Date.now()
    uresKorok = tartalomKirajzolva(sor) ? uresKorok + 1 : 0
    if (uresKorok >= 2 || Date.now() - helyenOta >= mezoIdokorlat) {
      break
    }
    await varjElemre(
      sor,
      () => elsoBeviteliMezo(sor),
      Math.min(korIdokorlat, Math.max(0, hatarido - Date.now())),
      signal,
    )
    // A mező megjelenése a sort és a lapot is megnövelheti: a következő kör
    // újra ellenőrzi a helyzetet.
  }
  if (signal.aborted) {
    return megszakitva
  }
  if (beavatkozott()) {
    return atvette
  }

  // VÉGSŐ ELLENŐRZÉS: „megnyitva” csak igazolt végállapotra (SC 4.1.3).
  const sor = dokumentum.getElementById(domId)
  if (!sor) {
    return { tipus: 'nem-sikerult' }
  }
  const ragados = ragadosSavAlja(sor, ablak)
  if (!sorHelyzete(sor, ablak, ragados).latszik) {
    return { tipus: 'nem-sikerult' }
  }
  const mezo = mezotFokuszal(sor, dokumentum)
  const tabindexLevetele = mezo ? null : sortFokuszal(sor)
  const aktiv = dokumentum.activeElement
  if (!aktiv || !sor.contains(aktiv) || !sorHelyzete(sor, ablak, ragados).latszik) {
    if (aktiv === sor) {
      sor.blur()
    }
    tabindexLevetele?.()
    return { tipus: 'nem-sikerult' }
  }
  const kiemelesLevetele = kiemel(sor, dokumentum)
  const utokovetesVege = utokovetes(sor, ablak, ragados, kornyezet.utokovetes ?? UTOKOVETES_MS)
  return {
    tipus: 'megnyitva',
    cimke: sorCimke(sor, index),
    mezo,
    kiemelesVege: () => {
      utokovetesVege()
      kiemelesLevetele()
    },
  }
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

export function SzekcioMegnyito({ children }: { children?: ReactNode }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { config } = useConfig()
  const adminRoute = config.routes.admin
  const apiAlap = `${config.serverURL ?? ''}${config.routes.api}`
  const szekcio = searchParams?.get(SZEKCIO_PARAM) ?? null
  // Az üzenet a navigációhoz kötött: más útvonalon (vagy bezárás után) nem látszik.
  const [eredmeny, setEredmeny] = useState<{ kulcs: string; uzenet: Uzenet } | null>(null)
  const [bezartKulcs, setBezartKulcs] = useState<string | null>(null)
  const kezeltRef = useRef<string | null>(null)
  const aktualisKulcs = `${pathname ?? ''}?${szekcio ?? ''}`
  const uzenet =
    eredmeny !== null && eredmeny.kulcs === aktualisKulcs && bezartKulcs !== aktualisKulcs
      ? eredmeny.uzenet
      : null

  useEffect(() => {
    const terv = megnyitasTerv(pathname, adminRoute, szekcio)
    if (terv.tipus === 'nincs') {
      kezeltRef.current = null
      return undefined
    }
    const kulcs = `${pathname ?? ''}?${szekcio ?? ''}`
    if (kezeltRef.current === kulcs) {
      return undefined
    }
    kezeltRef.current = kulcs
    if (terv.tipus === 'hibas-azonosito') {
      // Az élő régió már üresen a helyén van, a szöveg utána érkezik: így a
      // képernyőolvasó felolvassa (a betöltéskor már benne álló szöveget nem).
      const ido = window.setTimeout(() => {
        setBezartKulcs(null)
        setEredmeny({ kulcs, uzenet: UZENETEK.hibasAzonosito })
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
    void szekcioMegnyitasa(terv, {
      ablak: window,
      lekero: restLekero(apiAlap),
      signal: vezerlo.signal,
    }).then((vegeredmeny) => {
      if (vegeredmeny.tipus === 'megszakitva') {
        return
      }
      if (vezerlo.signal.aborted) {
        if (vegeredmeny.tipus === 'megnyitva') {
          vegeredmeny.kiemelesVege()
        }
        return
      }
      kesz = true
      if (vegeredmeny.tipus === 'felhasznalo-atvette') {
        // A felhasználó maga görgetett vagy kattintott: nincs mit jelenteni.
        return
      }
      setBezartKulcs(null)
      if (vegeredmeny.tipus === 'megnyitva') {
        kiemelesVege = vegeredmeny.kiemelesVege
        setEredmeny({ kulcs, uzenet: megnyitvaUzenet(vegeredmeny.cimke) })
      } else if (vegeredmeny.tipus === 'elavult') {
        setEredmeny({ kulcs, uzenet: UZENETEK.elavult })
      } else {
        setEredmeny({ kulcs, uzenet: UZENETEK.nemSikerult })
      }
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
  }, [adminRoute, apiAlap, pathname, szekcio])

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
