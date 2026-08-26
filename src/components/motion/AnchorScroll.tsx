'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useRef } from 'react'

/**
 * AnchorScroll — hosszú horgony-ugrás rövidítése; fókusz a célra lapon belüli útválasztónál.
 * Nem hív preventDefault-ot: csak `.kc-scroll-instant` osztályt tesz a gyökérre (motion.css).
 * Hideg betöltésnél NEM fókuszál — natív fragment navigáció már beállítja a Tab kiindulópontját.
 * Lapon belül: tabindex="-1" + focus({ preventScroll: true }), különben második smooth görgetés.
 * Csökkentett mozgásnál a fókusz-ág továbbra is fut (2.3.3 ≠ 2.4.3).
 * Előkészítő ugrás: behavior 'instant' kell — 'auto' itt is smooth marad (base.css).
 */

/** A gyökér-osztály, amely a görgetést azonnalivá teszi (motion.css). */
const INSTANT_CLASS = 'kc-scroll-instant'

/** Egy nézetablaknál hosszabb ugrás számít hosszúnak. */
const MAX_ANIMALT_NEZETABLAK = 1

/** Hosszú ugrásnál a cél előtt fél képernyő — az utolsó szakasz sima marad. */
const ELOKESZITO_NEZETABLAK = 0.5

/**
 * Ennyi ideig marad fenn az azonnali mód, ha a böngésző nem ismeri a
 * `scrollend` eseményt. Bőven fedi a lapváltás utáni, késleltetett görgetést
 * is (mérve: hideg betöltésnél ~250 ms-mal a load után indul a görgetés).
 */
const VISSZAALLITAS_MS = 1200

/**
 * Hosszú-e az ugrás? Tiszta függvény, hogy DOM nélkül is őrizhető legyen
 * (őr-teszt: horgony-ugras).
 *
 * @param tavolsagPx a jelenlegi és a cél görgetés-pozíció különbsége (px)
 * @param nezetablakPx a nézetablak magassága (px)
 * @returns true, ha az ugrás egy nézetablaknál hosszabb
 */
export function hosszuUgras(tavolsagPx: number, nezetablakPx: number): boolean {
  if (nezetablakPx <= 0) {
    return false
  }
  return Math.abs(tavolsagPx) > nezetablakPx * MAX_ANIMALT_NEZETABLAK
}

/**
 * A rövidített ugrás KIINDULÓPONTJA: a cél előtt fél képernyővel, a mozgás
 * irányában. Tiszta függvény, hogy DOM nélkül is őrizhető legyen.
 *
 * @param celPx a cél abszolút görgetés-pozíciója
 * @param jelenlegiPx a jelenlegi görgetés-pozíció
 * @param nezetablakPx a nézetablak magassága
 * @returns az a pozíció, ahonnan a böngésző sima görgetése induljon
 */
export function elokeszitoPozicio(
  celPx: number,
  jelenlegiPx: number,
  nezetablakPx: number,
): number {
  const irany = celPx < jelenlegiPx ? -1 : 1
  return Math.max(0, celPx - irany * nezetablakPx * ELOKESZITO_NEZETABLAK)
}

/**
 * A fókuszáláshoz szükséges elem-felület. Azért ez, és nem `HTMLElement`, hogy
 * a `fokuszCelra` DOM nélkül is futtatható legyen (a tesztkörnyezet `node`,
 * jsdom nincs a projektben). Minden `HTMLElement` kielégíti.
 */
export interface FokuszCel {
  readonly tabIndex: number
  hasAttribute(nev: string): boolean
  setAttribute(nev: string, ertek: string): void
  removeAttribute(nev: string): void
  addEventListener(tipus: 'blur', kezelo: () => void, opciok: { once: true }): void
  focus(opciok: { preventScroll: boolean }): void
}

/**
 * Kell-e a célra IDEIGLENES `tabindex`? Csak akkor, ha még nem fókuszálható.
 *
 * A `tabIndex` IDL-tulajdonság a HTML-szabvány szerint az elem alapértelmezett
 * fókuszálhatóságát tükrözi: `a[href]`, `button`, `input` és társaik attribútum
 * nélkül is 0-t adnak, egy sima `section` viszont −1-et. Így egy már
 * fókuszálható célt (pl. ha valaki egy gombra tesz horgonyt) NEM veszünk ki a
 * Tab-sorrendből azzal, hogy ráírunk egy `tabindex="-1"`-et.
 */
function ideiglenesTabindexKell(elem: FokuszCel): boolean {
  return !elem.hasAttribute('tabindex') && elem.tabIndex < 0
}

/**
 * A horgony CÉLJÁRA teszi a fókuszt, GÖRGETÉS NÉLKÜL.
 * A GOV.UK Design System `setFocus()` segédletének mintája: ha a cél még nem
 * fókuszálható, ideiglenes `tabindex="-1"`-et kap, és `blur`-kor visszaszedjük,
 * hogy a lap DOM-ja ne maradjon tartósan átírva. A `preventScroll` a mi
 * kiegészítésünk: enélkül a fókuszálás MÉG EGYSZER odagörgetne, mégpedig
 * animálva (a lap `scroll-behavior: smooth`), és elrontaná az imént beállított
 */
export function fokuszCelra(elem: FokuszCel, ideiglenesek: Set<FokuszCel>): void {
  if (ideiglenesTabindexKell(elem)) {
    elem.setAttribute('tabindex', '-1')
    ideiglenesek.add(elem)
    elem.addEventListener(
      'blur',
      () => {
        elem.removeAttribute('tabindex')
        ideiglenesek.delete(elem)
      },
      { once: true },
    )
  }
  elem.focus({ preventScroll: true })
}

/** A hash-ből a cél elem — üres, „#" és „#top" esetén a lap teteje. */
function celElem(hash: string): HTMLElement | null {
  const azonosito = decodeURIComponent(hash.replace(/^#/, ''))
  if (azonosito === '') {
    return null
  }
  const talalat =
    document.getElementById(azonosito) ??
    document.querySelector<HTMLElement>(`a[name="${CSS.escape(azonosito)}"]`)
  return talalat instanceof HTMLElement ? talalat : null
}

/** A hash céljának abszolút görgetés-pozíciója; hiányzó célnál null. */
function celPozicio(hash: string): number | null {
  const elem = celElem(hash)
  if (elem === null) {
    return hash === '' || hash === '#' || hash === '#top' ? 0 : null
  }
  return elem.getBoundingClientRect().top + window.scrollY
}

export function AnchorScroll() {
  /**
   * A lapváltás jele. A komponens a storefront-elrendezésben ül, tehát
   * útvonalváltáskor NEM szerelődik újra — a hash céljára kerülő fókuszt
   * ezért az útvonalra fűzött hatás állítja be.
   */
  const utvonal = usePathname()
  /** Az általunk kiosztott, átmeneti `tabindex`-ek — leszereléskor takarítunk. */
  const ideiglenesek = useRef<Set<FokuszCel>>(new Set())

  useEffect(() => {
    const gyoker = document.documentElement
    const nyilvantartas = ideiglenesek.current
    let visszaallitas: ReturnType<typeof setTimeout> | null = null

    /**
     * Csökkentett mozgás: csak a MOZGÁS-ág marad el.
     *
     * Hívásonként kérdezünk rá (nem a felcsatoláskor egyszer), így az
     * időközben átállított rendszer-beállítás azonnal érvényre jut.
     */
    const csokkentettMozgas = (): boolean =>
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const vissza = () => {
      gyoker.classList.remove(INSTANT_CLASS)
      if (visszaallitas !== null) {
        clearTimeout(visszaallitas)
        visszaallitas = null
      }
      window.removeEventListener('scrollend', vissza)
    }

    /** Azonnali módba kapcsol, és gondoskodik a visszaállásról. */
    const azonnal = () => {
      if (csokkentettMozgas()) {
        // Ott a base.css már `scroll-behavior: auto`-t ad: nincs mit átállítani.
        return
      }
      gyoker.classList.add(INSTANT_CLASS)
      if (visszaallitas !== null) {
        clearTimeout(visszaallitas)
      }
      // A `scrollend` a pontos jel; ahol nincs, ott az időzítő zár.
      window.addEventListener('scrollend', vissza, { once: true })
      visszaallitas = setTimeout(vissza, VISSZAALLITAS_MS)
    }

    /**
     * A LAPON BELÜLI hosszú ugrás rövidítése: azonnal a cél elé ugrunk fél
     * képernyővel, a maradékot a böngésző sima görgetése teszi meg (~333 ms).
     * Rövid ugrásnál nem csinál semmit — az eleve sima és rövid.
     */
    const rovidit = (pozicio: number) => {
      if (csokkentettMozgas()) {
        // Ott az érkezés eleve azonnali, tehát nincs mit rövidíteni.
        return
      }
      if (!hosszuUgras(pozicio - window.scrollY, window.innerHeight)) {
        return
      }
      window.scrollTo({
        behavior: 'instant',
        top: elokeszitoPozicio(pozicio, window.scrollY, window.innerHeight),
      })
    }

    /** Ugyanarra az útvonalra (csak horgonyban eltérő) mutat-e a hivatkozás? */
    const azonosOldal = (link: HTMLAnchorElement): boolean =>
      link.pathname === window.location.pathname && link.search === window.location.search

    const onClick = (esemeny: MouseEvent) => {
      // Új lapon nyíló vagy módosítóval indított kattintás nem görget.
      if (esemeny.defaultPrevented || esemeny.button !== 0) {
        return
      }
      if (esemeny.metaKey || esemeny.ctrlKey || esemeny.shiftKey || esemeny.altKey) {
        return
      }
      const cel = esemeny.target
      if (!(cel instanceof Element)) {
        return
      }
      const link = cel.closest('a')
      if (!(link instanceof HTMLAnchorElement) || link.target === '_blank') {
        return
      }
      // Külső hivatkozás: a lap elhagyása, itt nincs mit görgetni.
      if (link.host !== window.location.host) {
        return
      }

      // (a) UGYANAZON az oldalon, horgonyra: a távolság MOST mérhető, tehát a
      //     hosszú utat RÖVIDÍTJÜK, nem tüntetjük el. A látogató a lapot már
      //     látta, a célhoz érkezés így sima marad (tulajdonosi döntés).
      if (azonosOldal(link) && link.hash.length > 0) {
        const pozicio = celPozicio(link.hash)
        if (pozicio !== null) {
          rovidit(pozicio)
        }
        // A FÓKUSZ a célra kerül, hogy a következő Tab onnan folytassa.
        // Sorrend: előbb a mozgás kiindulópontja, utána a fókusz — a
        // `preventScroll` miatt a fókuszálás nem nyúl a pozícióhoz.
        // Azért MÉG az alapértelmezett művelet előtt (elfogási szakasz), mert
        // így a natív horgony-navigáció is a mi célunkat találja már
        // fókuszálhatónak, és a saját lépése nem szedi le róla a fókuszt.
        const celPont = celElem(link.hash)
        if (celPont !== null) {
          fokuszCelra(celPont, nyilvantartas)
        }
        return
      }

      // (b) MÁSIK oldalra, horgonnyal (pl. a fejléc-menü „Rendelői kezelések"
      //     pontja egy másik lapról). A cél most nem mérhető, mert a lap még
      //     nincs kirenderelve — de nem is kell: a felhasználó az ÚJ lapot még
      //     sosem látta, tehát a mozgásnak nincs mit összekötnie a szemében.
      //     Ez a mozgás definíció szerint nem lényegi (WCAG 2.2 SC 2.3.3),
      //     ezért mindig azonnali.
      if (link.hash.length > 0) {
        azonnal()
        return
      }

      // (c) Horgony NÉLKÜLI belső hivatkozás: az útválasztó a lap TETEJÉRE
      //     görget. Mérve: a menüpontra visszakattintva ez ugyanaz a 2055 px-es,
      //     ~700 ms-os elhúzás volt, csak felfelé.
      if (hosszuUgras(window.scrollY, window.innerHeight)) {
        azonnal()
      }
    }

    // Hash-váltás a LAPON BELÜL (pl. böngésző vissza-gombja): a cél mérhető,
    // tehát ugyanaz a rövidítés, mint a kattintásnál.
    const onHashChange = () => {
      const pozicio = celPozicio(window.location.hash)
      if (pozicio !== null) {
        rovidit(pozicio)
      }
      const celPont = celElem(window.location.hash)
      if (celPont !== null) {
        fokuszCelra(celPont, nyilvantartas)
      }
    }

    // Hideg betöltés horgonnyal: a böngésző a lap megjelenése UTÁN, késleltetve
    // indítja az animált görgetést (mérve ~250 ms-mal a load után). Itt a
    // látogató az ÚJ lapot még sosem látta, tehát az érkezés azonnali — a
    // (b) ággal azonos indoklás (WCAG 2.2 SC 2.3.3: nem lényegi mozgás).
    if (window.location.hash.length > 1) {
      const pozicio = celPozicio(window.location.hash)
      if (pozicio !== null && hosszuUgras(pozicio - window.scrollY, window.innerHeight)) {
        azonnal()
      }
    }

    // A kattintást ELFOGÁSI szakaszban nézzük: a `scroll-behavior`-t azelőtt
    // kell átállítani, hogy az útválasztó vagy a böngésző elindítaná a
    // görgetést. Az eseményt nem nyeljük el, csak megjelöljük a módot.
    document.addEventListener('click', onClick, true)
    window.addEventListener('hashchange', onHashChange)

    return () => {
      document.removeEventListener('click', onClick, true)
      window.removeEventListener('hashchange', onHashChange)
      vissza()
      // Az általunk kiosztott `tabindex`-ek nem maradhatnak a DOM-ban, ha a
      // `blur` már nem futna le (leszerelés fókuszban lévő céllal).
      for (const elem of nyilvantartas) {
        elem.removeAttribute('tabindex')
      }
      nyilvantartas.clear()
    }
  }, [])

  /**
 * LAPVÁLTÁS: a fókusz a hash céljára az ÚJ lapon.
 * A kattintás-kezelő a lapon belüli ugrást fedi; lapváltásnál a cél a
 * kattintás pillanatában még nincs a DOM-ban, ezért az új útvonal
 * kirenderelése UTÁN kell fókuszálni. A Next.js a hash-célra
 * `scrollIntoView()`-t hív egy elrendezés-hatásban, a fókuszt szándékosan nem
 * mozdítja — ez a hatás fut utána, tehát a görgetés már megtörtént.
 */
  const elsoFutas = useRef(true)
  useEffect(() => {
    if (elsoFutas.current) {
      elsoFutas.current = false
      return
    }
    if (window.location.hash.length <= 1) {
      return
    }
    const celPont = celElem(window.location.hash)
    if (celPont !== null) {
      fokuszCelra(celPont, ideiglenesek.current)
    }
  }, [utvonal])

  return null
}
