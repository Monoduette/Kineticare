/**
 * Két lapon nyitott szerkesztő figyelője: tiszta modul (React és Payload
 * nélkül). A KetLapFigyelo.tsx komponens köti a böngészőhöz.
 *
 * MIÉRT KELL. A Payload 3.88 dokumentumzárja csak MÁS felhasználónak jelez
 * (@payloadcms/ui/dist/views/Edit/index.js:446: `currentEditor.id !==
 * user?.id`), a hivatalos leírás is így mondja: „If another user attempts to
 * access the same document, they will be notified that it is currently being
 * edited.” (https://payloadcms.com/docs/admin/locked-documents). Ugyanaz a
 * felhasználó két böngészőlapon jelzés nélkül szerkesztheti ugyanazt a
 * dokumentumot. Mérve eldobható oldalon (A2-2-1 és A1-2-1): mindkét lap a
 * TELJES űrlapját menti (az automatikus mentés is), így amelyik később ment,
 * felülírja azt, amit közben a másik lapon módosítottak. Ez mindkét irányban
 * igaz: a régebbi lap mentése az újabbét, az újabbé a régebbiét írja felül.
 * A veszélyes lap tehát az, amelyik elavult űrlapot tart, és ez BÁRMELYIK
 * lehet, ezért a figyelmeztetés MINDKÉT lapon megjelenik (vezetői döntés).
 *
 * HOGYAN. Broadcast Channel API: „allows basic communication between browsing
 * contexts (that is, windows, tabs, frames, or iframes) and workers on the
 * same origin” (https://developer.mozilla.org/en-US/docs/Web/API/Broadcast_Channel_API).
 * Hálózati kérést nem küld, adatot (dokumentumot, beállítást, zárat) nem ír.
 * A window.opener útra NEM épít: az MDN szerint „Setting target="_blank" on
 * <a> elements implicitly provides the same rel behavior as setting
 * rel="noopener" which does not set window.opener”
 * (https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/a),
 * a kézzel nyitott második lapnak pedig nincs is nyitója.
 *
 * A PROTOKOLL (verziózott, a formátlan vagy ismeretlen üzenetet eldobja):
 * - bejelentés: „ezt a dokumentumot szerkesztem” (belépéskor, bfcache-ből
 *   visszatéréskor). Aki ugyanazt szerkeszti, felveszi a feladót, és válaszol.
 * - kérdés: „ki szerkeszti még?” (láthatóvá váláskor és a lefagyott lap
 *   felébredésekor). Aki ugyanazt szerkeszti, válaszol.
 * - válasz: egy bejelentésre vagy kérdésre, a kérdezőnek címezve.
 * - távozás: a lap elhagyja a dokumentumot (más nézetre lép, bezárul,
 *   pagehide).
 *
 * MIÉRT NINCS IDŐALAPÚ LEJÁRAT. A rejtett lap időzítőit a Chrome fojtja:
 * „The browser will check timers in this group once per second”, öt perc
 * rejtettség után pedig „the browser will check timers in this group once per
 * minute” (https://developer.chrome.com/blog/timer-throttling-in-chrome-88).
 * Egy szívverésre vagy lejáratra épülő jelenlét ezért egy élő, háttérben álló
 * lapot tévesen eltávolítana, pedig éppen az a lap tarthat elavult űrlapot.
 * A jelenlétet ezért csak ÜZENETEK változtatják: a távozás azonnal kivesz, a
 * kérdés pedig újraépíti. Kérdéskor új kör indul, és a VALASZ_ABLAK_MS lezárta
 * után csak az marad bent, aki a kör alatt üzent (válaszolt, bejelentkezett
 * vagy kérdezett). Az ablak időzítője a kérdező lapon fut, amely éppen
 * láthatóvá vált, így nem fojtott; ha mégis késik, csak később vesz ki, soha
 * nem korábban. Így a lefagyott vagy összeomlott lap nem ragad be.
 *
 * A LAP ÉLETCIKLUSA (Page Lifecycle API,
 * https://developer.chrome.com/docs/web-platform/page-lifecycle-api):
 * - rejtett lap: továbbra is jelen van (a rejtett lap is menthet, amikor
 *   visszatérnek rá), ezért rejtéskor nem távozik;
 * - láthatóvá válás és `resume`: kérdés, a jelenlét újraépül;
 * - `pagehide`: távozás, a csatorna lezárul („Never use the unload event on
 *   modern browsers”), és bfcache-ből visszatérve (`pageshow`, „the event's
 *   persisted property is true”) újra bejelentkezik;
 * - lefagyott lap (frozen): „the browser suspends execution of freezable
 *   tasks in the page's task queues until the page is unfrozen”. ISMERT
 *   KORLÁT: a lefagyott lap nem válaszol, amíg fel nem ébred, ezért a másik
 *   lap következő újraépítésekor kikerül; felébredve (resume, láthatóvá
 *   válás) kérdez, és a két lap újra látja egymást. Az eldobott (discarded)
 *   lap újratöltéskor friss lapként jelentkezik be.
 *
 * BEZÁRÁS. A felhasználó a figyelmeztetést bezárhatja. Utána csak akkor jön
 * vissza, ha a helyzet változik: olyan lap jelenik meg, amely a bezáráskor
 * nem volt jelen (új lap, vagy egy távozott lap visszatér).
 *
 * FELOLVASÁS. A figyelmeztetés epizódonként EGYSZER jelenik meg a
 * képernyőolvasónak: ha látható lapon keletkezik, azonnal; ha rejtett lapon
 * (pl. háttérben nyitott új lap), akkor a lap láthatóvá válásakor. Az epizód
 * a figyelmeztetés megszűnéséig tart.
 *
 * AMIT NEM CSINÁL. Hálózati kérést nem küld, dokumentumot, beállítást
 * (payload-preferences) és dokumentumzárat (payload-locked-documents) nem ír,
 * a Payload állapotához nem nyúl, a window.opener-t nem olvassa. Csak a
 * szerkesztő gyökérnézetét figyeli (collections/<slug>/<id> és
 * globals/<slug>): az új dokumentum, a verziók, az API-nézet, a lista, a
 * kuka és az irányítópult nem számít, mert ott nincs menthető űrlap.
 */

/** A BroadcastChannel neve. */
export const CSATORNA_NEV = 'kc-ket-lap-figyelo'

/** Az üzenetprotokoll verziója; más verziójú üzenetet a figyelő eldob. */
export const PROTOKOLL_VERZIO = 1

/**
 * Egy kérdés után ennyi ideig gyűjti a válaszokat (ms), utána veszi ki, aki
 * nem üzent. A válasz ugyanazon a gépen ezredmásodpercek alatt megérkezik;
 * a tartalék egy éppen elfoglalt (pl. rajzoló) lapnak szól.
 */
export const VALASZ_ABLAK_MS = 1_500

/**
 * A figyelmeztetés címe. A „Figyelem:” előtag a jelentést szövegben mondja
 * ki, ne csak a szín hordozza (WCAG 2.2 SC 1.4.1; a .kc-admin-notice
 * szerződése, custom.scss 9. szakasz). A „dokumentum” szó a Payload saját
 * zár-ablakáé („A dokumentum zárolva van”), így egy fogalom egy szó (SC 3.2.4).
 */
export const KET_LAP_CIM = 'Figyelem: ez a dokumentum egy másik böngészőlapon is nyitva van'

/**
 * A figyelmeztetés szövege: a MÉRT következmény és a kiút (NN/g, Error-Message
 * Guidelines: „Concisely and precisely describe the issue.”, „Offer
 * constructive advice.”, https://www.nngroup.com/articles/error-message-guidelines/).
 * A következmény mindkét irányban igaz (mérve, lásd a fejkommentet). A
 * teendőben az újratöltés azért kell, mert a megtartott lap is lehet elavult:
 * újratöltve a legutóbbi mentett állapotot mutatja (mérve).
 */
export const KET_LAP_SZOVEG =
  'Amelyik lap később ment, akár automatikusan, felülírja a többi lapon közben végzett módosításokat. Zárd be a többi lapot, és töltsd újra ezt, mielőtt tovább szerkesztesz.'

export type Uzenet =
  | { v: typeof PROTOKOLL_VERZIO; tipus: 'bejelentes'; lap: string; kulcs: string }
  | { v: typeof PROTOKOLL_VERZIO; tipus: 'tavozas'; lap: string; kulcs: string }
  | { v: typeof PROTOKOLL_VERZIO; tipus: 'kerdes'; lap: string; kulcs: string; kerdes: string }
  | {
      v: typeof PROTOKOLL_VERZIO
      tipus: 'valasz'
      lap: string
      kulcs: string
      /** A kérdező (vagy bejelentkező) lap azonosítója. */
      cel: string
      /** A megválaszolt kérdés azonosítója; bejelentésre adott válasznál null. */
      kerdes: string | null
    }

/** Lap- és kérdésazonosító: UUID vagy hexadecimális jel. */
const AZONOSITO_MINTA = /^[A-Za-z0-9-]{16,64}$/

/** Útvonal-szegmens (gyűjtemény- vagy global-slug, dokumentum-azonosító). */
const SZEGMENS_MINTA = /^[A-Za-z0-9_-]{1,120}$/

/** A Payload saját, dokumentum-azonosítónak látszó útvonal-szavai (nem szerkesztők). */
const NEM_DOKUMENTUM = new Set([
  // @payloadcms/next/dist/views/Root/getRouteData.js: /collections/<slug>/create
  'create',
  // …/trash (a kuka listája) és …/trash/<id> (csak olvasható nézet)
  'trash',
  // A mappanézet alapértelmezett slugja (config.folders), ha valaha bekapcsolnák.
  'payload-folders',
])

function szegmens(ertek: unknown): ertek is string {
  return typeof ertek === 'string' && SZEGMENS_MINTA.test(ertek)
}

/** Az admin-útvonal előtagja: a gyökér (`/`) üres, a záró perjel lekerül. */
function adminElotag(adminRoute: string): string {
  const levagott = adminRoute.replace(/\/+$/, '')
  return levagott === '' ? '' : levagott.startsWith('/') ? levagott : `/${levagott}`
}

/**
 * A dokumentum kulcsa, ha az útvonal egy szerkesztő GYÖKÉRNÉZETE:
 * `<admin>/collections/<slug>/<id>` → `collections/<slug>/<id>`,
 * `<admin>/globals/<slug>` → `globals/<slug>`. Minden más útvonalon (új
 * dokumentum, verziók, API-nézet, kuka, lista, irányítópult, saját nézetek)
 * null. Az útvonal-szerkezet forrása:
 * @payloadcms/next/dist/views/Root/getRouteData.js és getDocumentViewInfo.js.
 */
export function dokumentumKulcs(
  pathname: string | null | undefined,
  adminRoute: string = '/admin',
): string | null {
  if (typeof pathname !== 'string') {
    return null
  }
  const elotag = adminElotag(adminRoute)
  if (elotag !== '' && !pathname.startsWith(`${elotag}/`)) {
    return null
  }
  const reszek = pathname.slice(elotag.length).replace(/^\/+/, '').replace(/\/+$/, '').split('/')
  const [tipus, slug, id] = reszek
  if (tipus === 'collections' && reszek.length === 3) {
    return szegmens(slug) && szegmens(id) && !NEM_DOKUMENTUM.has(id)
      ? `collections/${slug}/${id}`
      : null
  }
  if (tipus === 'globals' && reszek.length === 2) {
    return szegmens(slug) ? `globals/${slug}` : null
  }
  return null
}

/** A dokumentumkulcs alakja (a bejövő üzenet ellenőrzéséhez). */
const KULCS_MINTA =
  /^(?:collections\/[A-Za-z0-9_-]{1,120}\/[A-Za-z0-9_-]{1,120}|globals\/[A-Za-z0-9_-]{1,120})$/

function azonosito(ertek: unknown): ertek is string {
  return typeof ertek === 'string' && AZONOSITO_MINTA.test(ertek)
}

/**
 * Egy bejövő üzenet ellenőrzése. Csak a pontos alakot fogadja el, és új
 * objektumot ad vissza (idegen mezőt nem visz tovább); minden más null.
 */
export function uzenetErtelmezese(adat: unknown): Uzenet | null {
  if (typeof adat !== 'object' || adat === null || Array.isArray(adat)) {
    return null
  }
  const nyers = adat as Readonly<Record<string, unknown>>
  const { v, tipus, lap, kulcs } = nyers
  if (v !== PROTOKOLL_VERZIO || !azonosito(lap)) {
    return null
  }
  if (typeof kulcs !== 'string' || !KULCS_MINTA.test(kulcs)) {
    return null
  }
  switch (tipus) {
    case 'bejelentes':
    case 'tavozas':
      return { v: PROTOKOLL_VERZIO, tipus, lap, kulcs }
    case 'kerdes':
      return azonosito(nyers.kerdes)
        ? { v: PROTOKOLL_VERZIO, tipus, lap, kulcs, kerdes: nyers.kerdes }
        : null
    case 'valasz': {
      const { cel, kerdes } = nyers
      if (!azonosito(cel) || (kerdes !== null && !azonosito(kerdes))) {
        return null
      }
      return { v: PROTOKOLL_VERZIO, tipus, lap, kulcs, cel, kerdes }
    }
    default:
      return null
  }
}

/** A lapazonosító előállításához szükséges Web Crypto rész. */
export interface Kripto {
  randomUUID?: () => string
  getRandomValues?: <T extends Uint8Array>(tomb: T) => T
}

/**
 * Új lap- vagy kérdésazonosító: crypto.randomUUID, ha elérhető (csak biztonságos
 * környezetben, https vagy localhost), különben 16 véletlen bájt hexában, végső
 * tartalékként Math.random. Nem titok, csak a lapok megkülönböztetésére kell.
 */
export function ujAzonosito(kripto: Kripto | undefined = globalThis.crypto): string {
  try {
    if (typeof kripto?.randomUUID === 'function') {
      return kripto.randomUUID()
    }
    if (typeof kripto?.getRandomValues === 'function') {
      const bajtok = kripto.getRandomValues(new Uint8Array(16))
      return [...bajtok].map((b) => b.toString(16).padStart(2, '0')).join('')
    }
  } catch {
    // A tartalék alább következik.
  }
  let jel = ''
  while (jel.length < 32) {
    jel += Math.floor(Math.random() * 0x1_0000_0000)
      .toString(16)
      .padStart(8, '0')
  }
  return jel.slice(0, 32)
}

/** A csatorna, amelyen a lapok üzennek (a BroadcastChannel vékony burka). */
export interface Csatorna {
  kuld(uzenet: Uzenet): void
  lezar(): void
}

/**
 * Csatorna-gyár: a `fogad` minden bejövő nyers üzenettel hívódik. Null, ha a
 * környezetben nincs csatorna (ilyenkor a figyelő csendben nem csinál semmit).
 */
export type CsatornaGyar = (nev: string, fogad: (adat: unknown) => void) => Csatorna | null

/** A böngésző BroadcastChannel-je; ha nincs, vagy nem hozható létre, null. */
export const bongeszoCsatornaGyar: CsatornaGyar = (nev, fogad) => {
  const Konstruktor: typeof BroadcastChannel | undefined = globalThis.BroadcastChannel
  if (typeof Konstruktor !== 'function') {
    return null
  }
  let csatorna: BroadcastChannel
  try {
    csatorna = new Konstruktor(nev)
  } catch {
    return null
  }
  csatorna.onmessage = (esemeny: MessageEvent<unknown>) => fogad(esemeny.data)
  return {
    kuld: (uzenet) => {
      try {
        csatorna.postMessage(uzenet)
      } catch {
        // Lezárt csatornára küldés: nincs kinek szólni.
      }
    },
    lezar: () => {
      csatorna.onmessage = null
      csatorna.close()
    },
  }
}

/** Időzítő a válaszablakhoz (tesztben injektálható). */
export interface Idozito {
  beallit(teendo: () => void, ms: number): unknown
  torol(azonosito: unknown): void
}

const alapIdozito: Idozito = {
  beallit: (teendo, ms) => setTimeout(teendo, ms),
  torol: (azonosito) => clearTimeout(azonosito as ReturnType<typeof setTimeout>),
}

export interface FigyeloAllapot {
  /** A figyelt dokumentum kulcsa; null, ha a lap nem szerkesztő gyökérnézeten áll. */
  kulcs: string | null
  /** Hány MÁSIK lap jelezte, hogy ugyanezt a dokumentumot szerkeszti. */
  masikLapok: number
  /** Van-e olyan másik lap, amelyről a figyelmeztetést nem zártad be. */
  figyelmeztet: boolean
  /**
   * Megjelenjen-e most a figyelmeztetés: figyelmeztet, és a lap látható, vagy
   * ebben az epizódban már megjelent (így epizódonként egyszer olvasódik fel).
   */
  megjelenit: boolean
}

export const KEZDO_ALLAPOT: FigyeloAllapot = Object.freeze({
  kulcs: null,
  masikLapok: 0,
  figyelmeztet: false,
  megjelenit: false,
})

export interface JelenletFigyeloBeallitas {
  /** Ennek a lapnak az azonosítója (alap: ujAzonosito()). */
  lapId?: string
  /** A csatorna forrása (alap: a böngésző BroadcastChannel-je). */
  csatornaGyar?: CsatornaGyar
  idozito?: Idozito
  valaszAblakMs?: number
  /** Látható-e a lap induláskor (alap: igen). */
  lapLathato?: boolean
  /** Kérdésazonosító-forrás (tesztben determinisztikus). */
  azonositoForras?: () => string
}

export interface JelenletFigyelo {
  /** A lap mostani azonosítója. */
  readonly lapId: string
  /** A lap dokumentumkulcsa változott (navigáció); null: nem szerkesztő nézet. */
  kulcsBeallitasa(kulcs: string | null): void
  /** A lap láthatósága változott; láthatóvá váláskor a jelenlét újraépül. */
  lathatosagValtozott(lathato: boolean): void
  /** Kérdés: a jelenlét újraépítése a válaszokból (pl. resume után). */
  ujraEpites(): void
  /** A felhasználó bezárta a figyelmeztetést. */
  bezaras(): void
  /** pagehide: távozás és a csatorna lezárása (bfcache előtt is). */
  felfuggesztes(): void
  /** pageshow (bfcache-ből): a csatorna újranyitása és bejelentkezés. */
  folytatas(): void
  /** Végleges leállás (a komponens lebontása): távozás, lezárás. */
  megszuntetes(): void
  megszunt(): boolean
  allapot(): FigyeloAllapot
  feliratkozas(figyelo: (allapot: FigyeloAllapot) => void): () => void
}

/**
 * A jelenlét állapotkezelője. Minden bemenet (navigáció, láthatóság,
 * üzenet) után kiszámolja az állapotot, és ha változott, értesíti a
 * feliratkozókat. Kivételt nem dob kifelé.
 */
export function jelenletFigyelo(beallitas: JelenletFigyeloBeallitas = {}): JelenletFigyelo {
  const azonositoForras = beallitas.azonositoForras ?? (() => ujAzonosito())
  const lapId = beallitas.lapId ?? azonositoForras()
  const csatornaGyar = beallitas.csatornaGyar ?? bongeszoCsatornaGyar
  const idozito = beallitas.idozito ?? alapIdozito
  const valaszAblakMs = beallitas.valaszAblakMs ?? VALASZ_ABLAK_MS

  let kulcs: string | null = null
  let lapLathato = beallitas.lapLathato ?? true
  let csatorna: Csatorna | null = null
  let megszuntetve = false
  /** A jelen lévő MÁSIK lapok, a legutóbbi üzenetük körszámával. */
  const jelenlevok = new Map<string, number>()
  /** Azok a lapok, amelyekről a figyelmeztetést a felhasználó bezárta. */
  const bezartak = new Set<string>()
  let kor = 0
  let ablakIdozito: unknown = null
  /** Megjelent-e már a figyelmeztetés a mostani epizódban (látható lapon). */
  let epizodMegjelent = false
  let utolso: FigyeloAllapot = KEZDO_ALLAPOT
  const feliratkozok = new Set<(allapot: FigyeloAllapot) => void>()

  function szamol(): FigyeloAllapot {
    const figyelmeztet = [...jelenlevok.keys()].some((id) => !bezartak.has(id))
    if (!figyelmeztet) {
      epizodMegjelent = false
    } else if (lapLathato) {
      epizodMegjelent = true
    }
    return {
      kulcs,
      masikLapok: jelenlevok.size,
      figyelmeztet,
      megjelenit: figyelmeztet && epizodMegjelent,
    }
  }

  function ertesit(): void {
    const uj = szamol()
    if (
      uj.kulcs === utolso.kulcs &&
      uj.masikLapok === utolso.masikLapok &&
      uj.figyelmeztet === utolso.figyelmeztet &&
      uj.megjelenit === utolso.megjelenit
    ) {
      return
    }
    utolso = uj
    for (const figyelo of [...feliratkozok]) {
      try {
        figyelo(uj)
      } catch {
        // Egy feliratkozó hibája nem állíthatja meg a többit.
      }
    }
  }

  function kuld(uzenet: Uzenet): void {
    csatorna?.kuld(uzenet)
  }

  function ablakTorlese(): void {
    if (ablakIdozito !== null) {
      idozito.torol(ablakIdozito)
      ablakIdozito = null
    }
  }

  /**
   * A lap kikerül a jelenlévők KÖZÜL ÉS a bezártak közül is (a bezártak
   * mindig a jelenlévők részhalmaza): ha később újra megjelenik, az már új
   * helyzet, és a figyelmeztetés visszajön.
   */
  function kivesz(id: string): void {
    jelenlevok.delete(id)
    bezartak.delete(id)
  }

  function uritesEsTorles(): void {
    ablakTorlese()
    jelenlevok.clear()
    bezartak.clear()
  }

  /** Egy másik lap jelen van: felvesz (ha új) és frissíti a körszámát. */
  function jelenVan(id: string): void {
    jelenlevok.set(id, kor)
  }

  function fogad(adat: unknown): void {
    if (megszuntetve) {
      return
    }
    const uzenet = uzenetErtelmezese(adat)
    if (uzenet === null || uzenet.lap === lapId) {
      return
    }
    if (kulcs === null || uzenet.kulcs !== kulcs) {
      // A feladó már nem a mi dokumentumunkon van (pl. elveszett távozás).
      if (jelenlevok.has(uzenet.lap)) {
        kivesz(uzenet.lap)
        ertesit()
      }
      return
    }
    switch (uzenet.tipus) {
      case 'bejelentes':
        // Új csatlakozásnál a lap nincs a bezártak között (lásd kivesz), így
        // a figyelmeztetés bezárás után is visszajön; az ismételt bejelentés
        // csak frissít, nem duplikál.
        jelenVan(uzenet.lap)
        kuld({
          v: PROTOKOLL_VERZIO,
          tipus: 'valasz',
          lap: lapId,
          kulcs,
          cel: uzenet.lap,
          kerdes: null,
        })
        break
      case 'kerdes':
        jelenVan(uzenet.lap)
        kuld({
          v: PROTOKOLL_VERZIO,
          tipus: 'valasz',
          lap: lapId,
          kulcs,
          cel: uzenet.lap,
          kerdes: uzenet.kerdes,
        })
        break
      case 'valasz':
        if (uzenet.cel !== lapId) {
          return
        }
        jelenVan(uzenet.lap)
        break
      case 'tavozas':
        kivesz(uzenet.lap)
        break
    }
    ertesit()
  }

  function csatornaNyitasa(): void {
    if (csatorna !== null || megszuntetve) {
      return
    }
    try {
      csatorna = csatornaGyar(CSATORNA_NEV, fogad)
    } catch {
      csatorna = null
    }
  }

  function csatornaLezarasa(): void {
    const regi = csatorna
    csatorna = null
    try {
      regi?.lezar()
    } catch {
      // A lezárás hibája nem érdekes: a csatornát többé nem használjuk.
    }
  }

  function tavozik(): void {
    if (kulcs !== null) {
      kuld({ v: PROTOKOLL_VERZIO, tipus: 'tavozas', lap: lapId, kulcs })
    }
  }

  function bejelentkezik(): void {
    if (kulcs !== null) {
      kuld({ v: PROTOKOLL_VERZIO, tipus: 'bejelentes', lap: lapId, kulcs })
    }
  }

  /** Új kör: kérdés, és az ablak végén kikerül, aki a kör alatt nem üzent. */
  function kerdez(): void {
    if (kulcs === null || csatorna === null) {
      return
    }
    kor += 1
    const sajatKor = kor
    ablakTorlese()
    kuld({ v: PROTOKOLL_VERZIO, tipus: 'kerdes', lap: lapId, kulcs, kerdes: azonositoForras() })
    ablakIdozito = idozito.beallit(() => {
      ablakIdozito = null
      if (megszuntetve || sajatKor !== kor) {
        return
      }
      for (const [id, utolsoKor] of [...jelenlevok]) {
        if (utolsoKor < sajatKor) {
          kivesz(id)
        }
      }
      ertesit()
    }, valaszAblakMs)
  }

  csatornaNyitasa()

  return {
    lapId,
    kulcsBeallitasa(uj) {
      if (megszuntetve || uj === kulcs) {
        return
      }
      tavozik()
      uritesEsTorles()
      kulcs = uj
      bejelentkezik()
      ertesit()
    },
    lathatosagValtozott(lathato) {
      if (megszuntetve) {
        return
      }
      const lathatoLett = lathato && !lapLathato
      lapLathato = lathato
      if (lathatoLett) {
        kerdez()
      }
      ertesit()
    },
    ujraEpites() {
      if (!megszuntetve) {
        kerdez()
      }
    },
    bezaras() {
      if (megszuntetve) {
        return
      }
      for (const id of jelenlevok.keys()) {
        bezartak.add(id)
      }
      ertesit()
    },
    felfuggesztes() {
      if (megszuntetve) {
        return
      }
      tavozik()
      csatornaLezarasa()
      uritesEsTorles()
      ertesit()
    },
    folytatas() {
      if (megszuntetve || csatorna !== null) {
        return
      }
      csatornaNyitasa()
      bejelentkezik()
    },
    megszuntetes() {
      if (megszuntetve) {
        return
      }
      tavozik()
      csatornaLezarasa()
      uritesEsTorles()
      megszuntetve = true
      feliratkozok.clear()
    },
    megszunt: () => megszuntetve,
    allapot: () => utolso,
    feliratkozas(figyelo) {
      feliratkozok.add(figyelo)
      return () => {
        feliratkozok.delete(figyelo)
      }
    },
  }
}

/** Az ablak és a dokumentum eseményeinek az a része, amelyre a figyelő épít. */
export interface FigyeltAblak {
  addEventListener(tipus: string, kezelo: (esemeny: Event) => void): void
  removeEventListener(tipus: string, kezelo: (esemeny: Event) => void): void
  document: {
    visibilityState: DocumentVisibilityState
    addEventListener(tipus: string, kezelo: (esemeny: Event) => void): void
    removeEventListener(tipus: string, kezelo: (esemeny: Event) => void): void
  }
}

/**
 * A lap életciklus-eseményeinek bekötése (Page Lifecycle API): láthatóság,
 * felébredés (resume), pagehide és pageshow. Visszaadja a leválasztót.
 */
export function eletciklusBekotese(figyelo: JelenletFigyelo, ablak: FigyeltAblak): () => void {
  const dokumentum = ablak.document
  const lathatosag = () => figyelo.lathatosagValtozott(dokumentum.visibilityState === 'visible')
  const ebredes = () => figyelo.ujraEpites()
  const elrejtes = () => figyelo.felfuggesztes()
  const megjelenes = (esemeny: Event) => {
    if ((esemeny as PageTransitionEvent).persisted === true) {
      figyelo.folytatas()
      lathatosag()
    }
  }
  dokumentum.addEventListener('visibilitychange', lathatosag)
  dokumentum.addEventListener('resume', ebredes)
  ablak.addEventListener('pagehide', elrejtes)
  ablak.addEventListener('pageshow', megjelenes)
  return () => {
    dokumentum.removeEventListener('visibilitychange', lathatosag)
    dokumentum.removeEventListener('resume', ebredes)
    ablak.removeEventListener('pagehide', elrejtes)
    ablak.removeEventListener('pageshow', megjelenes)
  }
}
