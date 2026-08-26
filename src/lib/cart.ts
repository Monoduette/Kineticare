'use client'

import { useCallback, useSyncExternalStore } from 'react'

import { ARCHIVED_COURSE_NOTE, UNAVAILABLE_COURSE_NOTE } from './courses'
import { formatPriceHuf } from './format-price'

/**
 * Kosár-tétel vásárolhatósága — megegyezik a kurzusoldal CTA-állapotgéppel + archivált.
 * `paid` = pénztár; `free` = igénylő űrlap; hiányos ár/archivált = nem vásárolható.
 *
 *  - `paid`        — ÉRVÉNYES ára van (`isPaidCourse`), a pénztár útja nyitva;
 *  - `free`        — tudatosan ingyenes (`isFreeCourse`), az igénylő űrlap az útja;
 *  - `archived`    — archivált termék, nem vehető meg (`ARCHIVED_COURSE_NOTE`);
 *  - `unavailable` — hiányos ár-konfiguráció (`UNAVAILABLE_COURSE_NOTE`).
 */
export type CartItemAvailability = 'paid' | 'free' | 'archived' | 'unavailable'

/**
 * Kosár-oldali állapot (egy termék = egy vásárlás a jelenlegi modellben — a
 * több-termékes kosár a jövőbeli bővítés; a konvenció itt is dokumentálva).
 */
export interface CartItem {
  productId: number
  sku: string
  /**
   * A kurzus webcíme a kosárban lévő tétel linkjéhez. OPCIONÁLIS: a mező
   * bevezetése ELŐTT eltárolt (localStorage-ban élő) kosarakban nincs benne —
   * ilyenkor a link a régi, id-alapú címre megy, amit a kurzus-route
   * átirányít a kanonikus címre.
   */
  slug?: string | null
  shortDescription: string | null
  priceHuf: number | null
  /** priceInHUFEnabled === false esetén ingyenes (a forrás: `isFreeCourse`). */
  isFree: boolean
  /**
   * A SZERVER verdiktje a tétel vásárolhatóságáról (a kosár-oldal állítja be a
   * `courses.ts` fogalmaiból). OPCIONÁLIS: a mező bevezetése ELŐTT eltárolt,
   * a látogató localStorage-ában élő kosarakban nincs benne — ilyenkor a
   * `cartItemAvailability` az árból és az `isFree`-ből következtet.
   */
  availability?: CartItemAvailability
}

export interface CartState {
  items: CartItem[]
}

const CART_STORAGE_KEY = 'kineticare-cart-v1'

/**
 * A SZERVER- és a HIDRATÁLÁSI pillanatkép: mindig üres kosár, hivatkozás-stabil.
 * A localStorage csak böngészőben létezik, ezért a szerver-HTML és az első
 * kliens-render is üres kosárral készül — a tárolt tartalom csak a hidratálás
 * UTÁN kerül be. (Ez a korábbi „useState({items:[]}) + useEffect(setState)"
 * megoldás pontos megfelelője, csak effekt nélkül.)
 */
const EMPTY_CART: CartState = { items: [] }

type CartListener = () => void

const cartListeners = new Set<CartListener>()

/** A localStorage-ból olvasott, gyorsítótárazott pillanatkép (hivatkozás-stabilitás). */
let cachedCart: CartState = EMPTY_CART
let cachedCartIsValid = false

/** Írás után: a gyorsítótár érvénytelen + minden feliratkozó értesül. */
function notifyCartChanged(): void {
  cachedCartIsValid = false
  for (const listener of cartListeners) {
    listener()
  }
}

function subscribeToCart(onStoreChange: CartListener): () => void {
  cartListeners.add(onStoreChange)
  return () => {
    cartListeners.delete(onStoreChange)
  }
}

/**
 * Kliens-pillanatkép. A `useSyncExternalStore` elvárja, hogy változatlan
 * tároló mellett UGYANAZT a hivatkozást adja vissza — a `readCart()` minden
 * híváskor új objektumot gyárt, ezért gyorsítótárazzuk, és csak írás után
 * (notifyCartChanged) olvassuk újra.
 */
function getCartSnapshot(): CartState {
  if (!cachedCartIsValid) {
    cachedCart = readCart()
    cachedCartIsValid = true
  }
  return cachedCart
}

function getServerCartSnapshot(): CartState {
  return EMPTY_CART
}

/**
 * A `useCart` mögötti külső store — exportálva, hogy a hidratálási szerződés
 * („a szerver-pillanatkép akkor is üres, ha a tárolóban van tétel") tesztelhető
 * legyen. Komponensben közvetlenül ne használd: erre való a `useCart`.
 */
export const cartStore = {
  subscribe: subscribeToCart,
  getSnapshot: getCartSnapshot,
  getServerSnapshot: getServerCartSnapshot,
}

/** A kosár perzisztencia a localStorage-ban (kliens-oldali minimális — a szerver mindig újraszámolja az árat). */
export function readCart(): CartState {
  if (typeof window === 'undefined') {
    return { items: [] }
  }
  try {
    const raw = window.localStorage.getItem(CART_STORAGE_KEY)
    if (!raw) {
      return { items: [] }
    }
    const parsed = JSON.parse(raw) as CartState
    return Array.isArray(parsed.items) ? parsed : { items: [] }
  } catch {
    return { items: [] }
  }
}

export function writeCart(state: CartState): void {
  if (typeof window === 'undefined') {
    return
  }
  window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(state))
  notifyCartChanged()
}

export function addToCart(item: CartItem): CartState {
  const state = readCart()
  if (state.items.some((existing) => existing.productId === item.productId)) {
    return state // duplikáció nélkül — a checkout-start is blokkolja a duplavásárlást
  }
  const next = { items: [...state.items, item] }
  writeCart(next)
  return next
}

export function removeFromCart(productId: number): CartState {
  const state = readCart()
  const next = { items: state.items.filter((item) => item.productId !== productId) }
  writeCart(next)
  return next
}

/**
 * A tétel tényleges ár-állapota.
 *
 * A `availability` mező a szerver verdiktje, DE a „fizetős" ág ezen felül
 * ÉRVÉNYES árat is követel: ha a kettő mégis szétcsúszna (régi tárolt kosár,
 * időközben átírt termék), a SZIGORÚBB dönt. Így a felület sosem kínálhat
 * olyan vásárlást, amit a checkout ár-kapuja (`coursePriceHuf`) elutasít.
 *
 * A mező NÉLKÜLI, régi kosarak: az `isFree` és az ár alapján következtetünk.
 * A `null`/0/negatív árú, nem ingyenesnek jelölt tétel itt `unavailable` lesz —
 * pontosan ez a tétel adta korábban a „Végösszeg: 0 Ft" hazugságot.
 */
export function cartItemAvailability(item: CartItem): CartItemAvailability {
  if (item.availability === 'archived') {
    return 'archived'
  }
  if (item.availability === 'unavailable') {
    return 'unavailable'
  }
  if (item.availability === 'free' || (item.availability === undefined && item.isFree)) {
    return 'free'
  }
  const price = item.priceHuf
  return typeof price === 'number' && Number.isFinite(price) && price > 0 ? 'paid' : 'unavailable'
}

/**
 * A nem vásárolható tétel magyarázó mondata; `null`, ha a tétellel nincs baj.
 *
 * A szövegek SZÁNDÉKOSAN a `courses.ts` konstansai: a kurzusoldal ugyanezt a
 * két mondatot mondja ugyanezekre az állapotokra, tehát a látogató két
 * felületen ugyanazt olvassa (WCAG 2.2 SC 3.2.4). NN/g, Error-Message
 * Guidelines: „Concisely and precisely describe the issue." és „Merely stating
 * the problem is also not enough; offer some potential remedies."
 * (https://www.nngroup.com/articles/error-message-guidelines/) — a
 * továbblépést a kosár összegző sávja adja meg, a kurzuslistára mutató linkkel.
 */
export function cartItemNote(item: CartItem): string | null {
  switch (cartItemAvailability(item)) {
    case 'archived':
      return ARCHIVED_COURSE_NOTE
    case 'unavailable':
      return UNAVAILABLE_COURSE_NOTE
    default:
      return null
  }
}

/** Kosár összérték — csak `paid` tételekből. A sáv `totalHuf` ettől eltérhet (egytermékes pénztár). */
export function cartTotalHuf(state: CartState): number {
  return state.items.reduce((sum, item) => {
    const price = item.priceHuf
    return cartItemAvailability(item) === 'paid' && typeof price === 'number' ? sum + price : sum
  }, 0)
}

export function cartIsEmpty(state: CartState): boolean {
  return state.items.length === 0
}

/** A csupa ingyenes kosár végösszeg-sorának szövege. */
export const CART_FREE_LABEL = 'Ingyenes'

/**
 * A kosár összegző sávjának állapota:
 *  - `empty`   — nincs tétel (a szerver-pillanatkép mindig ez, lásd EMPTY_CART);
 *  - `blocked` — EGYETLEN tétel sem vásárolható és nem is igényelhető: nincs
 *                végösszeg és nincs sáv-cselekvés, csak alternatíva;
 *  - `free`    — nincs megvehető tétel, de van ingyenes: az igénylés a tétel
 *                SAJÁT sorában áll;
 *  - `amount`  — van megvehető tétel: a pénztár útja nyitva.
 */
export type CartSummaryKind = 'empty' | 'blocked' | 'free' | 'amount'

export interface CartSummary {
  kind: CartSummaryKind
  /**
   * A MOST FIZETENDŐ összeg — kizárólag abból, amit a sáv gombja tényleg
   * fedez. Lásd a `cartSummary` „MENNYIT MOND A VÉGÖSSZEG" szakaszát: ez NEM
   * a kosár összértéke (`cartTotalHuf`), hanem a következő lépés ára.
   */
  totalHuf: number
  /**
   * A végösszeg-sor szövege, VAGY `null`, ha a kosárnak nincs kimondható
   * végösszege. A `null` nem formalitás: a sáv ilyenkor egyáltalán nem ír ki
   * összeget, mert bármilyen szám hazugság lenne.
   */
  totalLabel: string | null
  /**
   * A sáv CTA-jának CÉLTÉTELE, vagy `null`, ha a sávnak nincs cselekvése.
   *
   * SZÁNDÉKOSAN az első MEGVEHETŐ tétel, nem az `items[0]`: vegyes kosárban a
   * régi, „első tétel" szabály a pénztárba küldte volna az ingyenes vagy az
   * archivált terméket, ahol a pénztár tájékoztató állapotot ad — vagyis egy
   * újabb zsákutcát nyitott volna.
   */
  target: CartItem | null
  /** A megvehető (érvényes árú) tételek. */
  payable: CartItem[]
  /** A nem vásárolható (archivált vagy hiányos konfigurációjú) tételek. */
  blocked: CartItem[]
  /** Az ingyenes tételek. NEM hibásak: saját, működő útjuk van. */
  free: CartItem[]
  /**
   * Amit a sáv gombja NEM fedez. Nem hiba-lista: a saját sorában mindegyik
   * megkapja a maga magyarázatát és cselekvését. A sáv ebből tudja, hogy ki
   * kell-e mondani, MIRE vonatkozik a fizetés (`cartScopeNote`).
   */
  uncovered: CartItem[]
}

/**
 * Kosár összegzése: egy rossz tétel nem blokkolja a fizetést; végösszeg = target tétel.
 * Állapot-sorrend: payable → free → blocked.
 */
export function cartSummary(state: CartState): CartSummary {
  const items = state.items
  if (items.length === 0) {
    return {
      kind: 'empty',
      totalHuf: 0,
      totalLabel: null,
      target: null,
      payable: [],
      blocked: [],
      free: [],
      uncovered: [],
    }
  }

  const payable: CartItem[] = []
  const blocked: CartItem[] = []
  const free: CartItem[] = []
  for (const item of items) {
    switch (cartItemAvailability(item)) {
      case 'paid':
        payable.push(item)
        break
      case 'free':
        free.push(item)
        break
      default:
        blocked.push(item)
    }
  }

  if (payable.length > 0) {
    const target = payable[0]
    // A `paid` ág GARANCIA: a `cartItemAvailability` csak véges, pozitív árra
    // adja — a `?? 0` így nem elnyel hibát, csak a típust szűkíti.
    const totalHuf = target.priceHuf ?? 0
    return {
      kind: 'amount',
      totalHuf,
      totalLabel: formatPriceHuf(totalHuf),
      target,
      payable,
      blocked,
      free,
      uncovered: items.filter((item) => item !== target),
    }
  }

  if (free.length > 0) {
    return {
      kind: 'free',
      totalHuf: 0,
      totalLabel: CART_FREE_LABEL,
      target: free[0],
      payable,
      blocked,
      free,
      // A sávnak ezen az ágon NINCS gombja: az igénylés a tétel saját sorában
      // áll, tehát nincs mit „nem fedeznie".
      uncovered: [],
    }
  }

  return {
    kind: 'blocked',
    totalHuf: 0,
    totalLabel: null,
    target: null,
    payable,
    blocked,
    free,
    uncovered: [],
  }
}

/** Sáv szöveg: mire vonatkozik a fizetés; `null` ha minden tétel lefedett vagy nincs fizetés. */
export function cartScopeNote(summary: CartSummary): string | null {
  if (summary.kind !== 'amount' || summary.target === null || summary.uncovered.length === 0) {
    return null
  }
  return `Most csak ezért a kurzusért fizetsz: ${summary.target.sku}. A kosár többi tételéért nem.`
}

/** Hook a kosárállapothoz (kliens-komponensekhez). */
export function useCart(): {
  state: CartState
  add: (item: CartItem) => void
  remove: (productId: number) => void
  totalHuf: number
  isEmpty: boolean
  summary: CartSummary
} {
  const state = useSyncExternalStore(
    cartStore.subscribe,
    cartStore.getSnapshot,
    cartStore.getServerSnapshot,
  )

  // Az írás (addToCart/removeFromCart → writeCart) maga értesíti a store-t,
  // így nem kell külön setState — a hook a store pillanatképét követi. A
  // callbackok STABILAK (useCallback, üres deps: a modul-szintű függvényekre
  // hivatkoznak), hogy a fogyasztók effekt-függőséglistába tehetők legyenek
  // (a CartView initialItem-effektje így fut le kliens-navigációnál is).
  const add = useCallback((item: CartItem) => {
    addToCart(item)
  }, [])
  const remove = useCallback((productId: number) => {
    removeFromCart(productId)
  }, [])

  return {
    state,
    add,
    remove,
    totalHuf: cartTotalHuf(state),
    isEmpty: cartIsEmpty(state),
    summary: cartSummary(state),
  }
}
