'use client'

import { useConfig, useDocumentInfo, useFormFields } from '@payloadcms/ui'
import { useEffect, useState, type JSX } from 'react'

import {
  EMAIL_MEZOK,
  HASONLO_KIHAGYOTT_TIPUSOK,
  KEP_MEZOK,
  MUNKATARS_HIBA,
  OLDAL_HIBA,
  TELEFON_MEZOK,
  csoportBevezeto,
  csoportTeendo,
  esMeg,
  szekcioMasolatok,
  type BlokkCimkeForras,
  type MasolatHely,
  type MasolatMunkatars,
  type MasolatOldal,
  type SzekcioMasolatModell,
} from '../../lib/admin/szekcio-masolatok'
import { helybenUgras } from './helyben-ugras'
import { useSiblingRows } from './SectionRowLabel'

import './section-copies.css'

/**
 * „Ugyanaz máshol”: a szekció második mezője (`type: 'ui'`, adatbázis-oszlop
 * nélkül; a blocks/index.ts withSectionAdmin-ja teszi a forrás-jelzés alá).
 * Kimondja, ha más oldalon hasonló, de FÜGGETLEN szekció áll, vagy ha a
 * telefonszám, az e-mail-cím vagy a kép máshol is szerepel (modul-térkép H10,
 * H49). A szabályok és a szövegek a tiszta src/lib/admin/szekcio-masolatok.ts
 * modulban élnek (ott a források is), itt csak az adatbetöltés és a rajz.
 *
 * ADAT. A szerkesztett oldal szekciósora az űrlapállapotból jön (useSiblingRows,
 * mentés nélkül is friss), a többi oldal és a Felhasználók arcképe egy-egy REST
 * listából, DOKUMENTUMONKÉNT EGYSZER: a 15 szekció jelzése ugyanazt a
 * modul-szintű Promise-t kapja (`<api>|<dokumentum>` kulcs). A bejegyzés addig
 * él, amíg legalább egy jelzés csatolva van (hivatkozásszámlálás az effect
 * cleanupjában); az utolsó lecsatolása után törlődik, így egy később újra
 * megnyitott dokumentum friss listát kér. A lekérés a
 * bejelentkezett szerkesztő jogával fut (`credentials: 'include'`), szerepkör-
 * szűrő nélkül: a Felhasználók `role` mezőjének olvasási joga nem garantált, és
 * az access-szabályokhoz nem nyúlunk. A Payload 3.88 forrása szerint:
 * - a `draft=true` a listában a verziótáblából a LEGÚJABB változatot adja
 *   (payload/dist/collections/operations/find.js:103-127 → queryDrafts,
 *   @payloadcms/drizzle/dist/queryDrafts.js: `latest: { equals: true }`), vagyis
 *   a még közzé nem tett piszkozatot is, amit a többi szerkesztő lát;
 * - a `select[layout]=true` a blocks mezőt egészben adja (a drizzle
 *   find/traverseFields.js blocks-ága `blocksSelect === true` esetén minden
 *   blokktípust kiolvas), a verziós lekérésnél `{ parent: true, version: … }`
 *   alakban (getQueryDraftsSelect.js), az azonosító tehát megvan.
 * Hibánál vagy nem-ok válasznál az adott lista null, és a modul OLDAL_HIBA,
 * illetve MUNKATARS_HIBA mondata jelenik meg: a doboz hiánya hamisan azt
 * sugallná, hogy nincs másolat. Ha a blokktípus se a hasonló-szabály, se a közös
 * adat mezői alá nem esik (Szabad szöveg, Vélemények, Tudástár), nincs lekérés.
 *
 * MEGJELENÉS. A meglévő `.kc-admin-notice` doboz (custom.scss stílusszerződés;
 * szöveg a doboz alapján világos témán 12,13:1, sötéten 13,75:1, a hibás,
 * figyelem-változaton 12,08:1 és 13,88:1, mérve a Payload colors.scss
 * tokenjeiből, WCAG 2.2 SC 1.4.3). Csoportonként egy bevezető mondat, a helyek
 * listája, a „és még N”, végül a teendő. Minden hely link, a szövege a hely
 * teljes neve (oldal + a cél sorcímkéje betűre), így a cél már a link
 * szövegéből kiderül (WCAG 2.2 SC 2.4.4, W3C G91: „The objective of this
 * technique is to describe the purpose of a link in the text of the link.”,
 * https://www.w3.org/WAI/WCAG22/Techniques/general/G91). A lista a pásztázást
 * segíti (GOV.UK Design System, Lists: „Use lists to make blocks of text easier
 * to read, and to break information into manageable chunks.”,
 * https://design-system.service.gov.uk/styles/lists/). Ugyanennek az oldalnak egy
 * másik sora a lapot nem tölti újra (helybenUgras: a `?szekcio=` paramétert a
 * History API-val írja, a mélylink-nyitó kinyitja a sort, a beírt, mentetlen
 * érték megmarad); más oldal és a Felhasználók adatlapja sima link.
 *
 * Nincs `role="alert"` és `role="status"`: a doboz a szekció statikus
 * kiegészítő tartalma, nem a szerkesztő egy műveletének eredménye. A WCAG 2.2
 * SC 4.1.3 a „change in content that is not a change of context” és a művelet
 * eredményéről szóló üzenetre vonatkozik
 * (https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html); egy
 * oldalon 15 szekció jelzése töltődik be egyszerre, élő régióként mind
 * beszólna. A GOV.UK Inset text mintája a kiegészítő információhoz való, és
 * „Use inset text very sparingly” (https://design-system.service.gov.uk/components/inset-text/),
 * ezért a doboz csak akkor áll, ha van mit mondani; betöltés közben semmi nem
 * látszik (nincs 15 „Betöltés…” felirat).
 */

interface SectionCopiesProps {
  /** A UI-mező útvonala, pl. `layout.3.szekcioMasolatJelzes` (a Payload adja). */
  path?: string
  /** Blokktípus → sorcímke-forrás (a blocks/index.ts SZEKCIO_CIMKE_FORRASOK-a). */
  cimkek?: Readonly<Record<string, BlokkCimkeForras>>
}

/**
 * A UI-mező útvonalából a blokk útvonala és sorindexe. A SectionSourceNotice
 * blockPathOf-jának helyi mása (az ott nem exportált, és azt a fájlt ez a
 * csomag nem módosíthatja); a harvestnél egy közös segédbe vonható.
 */
function blockPathOf(path: string): { blockPath: string; rowIndex: number } {
  const blockPath = path.slice(0, Math.max(0, path.lastIndexOf('.')))
  const rowIndex = Number(blockPath.slice(blockPath.lastIndexOf('.') + 1))
  return { blockPath, rowIndex: Number.isInteger(rowIndex) && rowIndex >= 0 ? rowIndex : 0 }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Kell-e ennél a blokktípusnál a többi oldal (hasonló-szabály vagy közös adat). */
export function kellLekeres(blockType: string): boolean {
  if (blockType === '') {
    return false
  }
  return (
    !HASONLO_KIHAGYOTT_TIPUSOK.has(blockType) ||
    blockType in TELEFON_MEZOK ||
    blockType in EMAIL_MEZOK ||
    blockType in KEP_MEZOK
  )
}

/* ------------------------------------------------------------------------ */
/* Adatbetöltés, dokumentumonként egyszer                                    */
/* ------------------------------------------------------------------------ */

export interface MasolatAdatok {
  masOldalak: MasolatOldal[] | null
  munkatarsak: MasolatMunkatars[] | null
}

/** `<apiAlap>|<dokumentum-azonosító>` → a betöltés Promise-a. */
const betoltesek = new Map<string, Promise<MasolatAdatok>>()
/** Kulcsonként a csatolt jelzések száma (hivatkozásszámlálás). */
const hasznalok = new Map<string, number>()
/** Kulcsonként a függő törlés időzítője (az utolsó jelzés lecsatolása után). */
const torlesek = new Map<string, ReturnType<typeof setTimeout>>()

/**
 * Egy jelzés csatolása a kulcshoz: nő a számláló, és a függő törlés elmarad.
 * Így a React StrictMode dupla effektje (csatol, lecsatol, csatol ugyanabban a
 * körben) és a sorok átrendezése sem kér újra.
 */
function csatol(kulcs: string): void {
  hasznalok.set(kulcs, (hasznalok.get(kulcs) ?? 0) + 1)
  const idozito = torlesek.get(kulcs)
  if (idozito !== undefined) {
    clearTimeout(idozito)
    torlesek.delete(kulcs)
  }
}

/**
 * Egy jelzés lecsatolása. Az utolsó után a betöltés a következő makrotaszkban
 * kikerül a gyorsítótárból, ha addig senki nem csatolt újra: a dokumentum
 * bezárása (vagy A → B → A váltás) után a következő megnyitás friss adatot kér,
 * nem a munkamenet elején betöltött, azóta elavult listát mutatja.
 */
function lecsatol(kulcs: string): void {
  const maradt = (hasznalok.get(kulcs) ?? 1) - 1
  if (maradt > 0) {
    hasznalok.set(kulcs, maradt)
    return
  }
  hasznalok.delete(kulcs)
  const regi = torlesek.get(kulcs)
  if (regi !== undefined) {
    clearTimeout(regi)
  }
  torlesek.set(
    kulcs,
    setTimeout(() => {
      torlesek.delete(kulcs)
      if (!hasznalok.has(kulcs)) {
        betoltesek.delete(kulcs)
      }
    }, 0),
  )
}

function dokumentumKulcs(apiAlap: string, docId: number | string | null): string {
  return `${apiAlap}|${docId === null ? 'uj' : String(docId)}`
}

/** Az Oldalak listája: a legújabb (piszkozat) változat, csak a három szükséges mező. */
export function oldalakUrl(apiAlap: string): string {
  const params = new URLSearchParams({
    depth: '0',
    draft: 'true',
    pagination: 'false',
    'select[slug]': 'true',
    'select[title]': 'true',
    'select[layout]': 'true',
  })
  return `${apiAlap}/pages?${params.toString()}`
}

/** A Felhasználók közül akinek van arcképe: név és arckép. */
export function munkatarsakUrl(apiAlap: string): string {
  const params = new URLSearchParams({
    depth: '0',
    pagination: 'false',
    'where[portrait][exists]': 'true',
    'select[name]': 'true',
    'select[portrait]': 'true',
  })
  return `${apiAlap}/users?${params.toString()}`
}

function ervenyesId(value: unknown): value is number | string {
  return (typeof value === 'number' && Number.isFinite(value)) || typeof value === 'string'
}

/** A lista `docs` tömbje, vagy null (hiba, nem-ok válasz, váratlan alak). */
async function lista(url: string): Promise<Record<string, unknown>[] | null> {
  try {
    const valasz = await fetch(url, { credentials: 'include' })
    if (!valasz.ok) {
      return null
    }
    const torzs: unknown = await valasz.json()
    if (!isRecord(torzs) || !Array.isArray(torzs.docs)) {
      return null
    }
    return torzs.docs.filter(isRecord)
  } catch {
    // Hálózati vagy JSON-hiba: a jelzés a modul hibamondatát mutatja.
    return null
  }
}

function oldalakBol(docs: Record<string, unknown>[]): MasolatOldal[] {
  return docs.flatMap((doc): MasolatOldal[] => {
    const { id, layout } = doc
    return ervenyesId(id)
      ? [{ id, slug: doc.slug, title: doc.title, layout: Array.isArray(layout) ? layout : [] }]
      : []
  })
}

function munkatarsakBol(docs: Record<string, unknown>[]): MasolatMunkatars[] {
  return docs.flatMap((doc): MasolatMunkatars[] => {
    const { id, name } = doc
    return ervenyesId(id)
      ? [{ id, nev: typeof name === 'string' ? name : '', arckep: doc.portrait }]
      : []
  })
}

/**
 * A többi oldal és a munkatársak, dokumentumonként egy betöltéssel (két
 * kérés). Ha valamelyik lista nem jött meg, a bejegyzés a gyorsítótárból
 * kikerül: a már kirajzolt jelzések a hibamondatot mutatják, a következő
 * megnyitás újrapróbálja.
 */
export function masolatAdatok(
  apiAlap: string,
  docId: number | string | null,
): Promise<MasolatAdatok> {
  const kulcs = dokumentumKulcs(apiAlap, docId)
  const meglevo = betoltesek.get(kulcs)
  if (meglevo) {
    return meglevo
  }
  const betoltes = Promise.all([lista(oldalakUrl(apiAlap)), lista(munkatarsakUrl(apiAlap))]).then(
    ([oldalak, munkatarsak]): MasolatAdatok => {
      // Csak a saját bejegyzését törli: ha közben lecsatolás után már egy
      // újabb betöltés áll a kulcson, azt nem veszi el.
      if ((oldalak === null || munkatarsak === null) && betoltesek.get(kulcs) === betoltes) {
        betoltesek.delete(kulcs)
      }
      return {
        masOldalak: oldalak === null ? null : oldalakBol(oldalak),
        munkatarsak: munkatarsak === null ? null : munkatarsakBol(munkatarsak),
      }
    },
  )
  betoltesek.set(kulcs, betoltes)
  return betoltes
}

/** Csak teszthez: a dokumentumonkénti gyorsítótár és a számlálók ürítése. */
export function masolatAdatokUritese(): void {
  for (const idozito of torlesek.values()) {
    clearTimeout(idozito)
  }
  torlesek.clear()
  hasznalok.clear()
  betoltesek.clear()
}

/* ------------------------------------------------------------------------ */
/* Megjelenítés                                                              */
/* ------------------------------------------------------------------------ */

function Hely({ hely }: { hely: MasolatHely }): JSX.Element {
  if (hely.href === null) {
    return <span>{hely.felirat}</span>
  }
  if (hely.ugyanitt) {
    return (
      <a href={hely.href} onClick={helybenUgras}>
        {hely.felirat}
      </a>
    )
  }
  return <a href={hely.href}>{hely.felirat}</a>
}

/** A jelzés megjelenítése (a render-teszt ezt hívja közvetlenül). */
export function SectionCopiesView({ model }: { model: SzekcioMasolatModell }): JSX.Element | null {
  const hibak = [
    model.oldalHiba ? OLDAL_HIBA : null,
    model.munkatarsHiba ? MUNKATARS_HIBA : null,
  ].filter((hiba): hiba is string => hiba !== null)
  if (model.csoportok.length === 0 && hibak.length === 0) {
    return null
  }
  const osztaly = [
    'kc-admin-notice',
    'kc-section-copies',
    hibak.length > 0 ? 'kc-admin-notice--figyelem' : null,
  ]
    .filter((resz): resz is string => resz !== null)
    .join(' ')
  return (
    <div className={osztaly}>
      {model.csoportok.map((csoport, index) => (
        <div className="kc-section-copies__csoport" key={`${csoport.fajta}:${String(index)}`}>
          <p className="kc-admin-notice__szoveg">{csoportBevezeto(csoport)}</p>
          <ul className="kc-admin-notice__linkek kc-section-copies__helyek">
            {csoport.helyek.map((hely) => (
              <li key={hely.kulcs}>
                <Hely hely={hely} />
              </li>
            ))}
            {csoport.tobbi > 0 ? (
              <li className="kc-section-copies__tobbi">{esMeg(csoport.tobbi)}</li>
            ) : null}
          </ul>
          <p className="kc-admin-notice__szoveg">{csoportTeendo(csoport.fajta)}</p>
        </div>
      ))}
      {hibak.map((hiba) => (
        <p className="kc-admin-notice__szoveg" key={hiba}>
          {hiba}
        </p>
      ))}
    </div>
  )
}

/** Hiányzó clientProps esetén (állandó objektum, hogy a sorcímke-gyorsítótár találjon). */
const NINCS_CIMKE: Readonly<Record<string, BlokkCimkeForras>> = {}

export function SectionCopies({
  path = '',
  cimkek = NINCS_CIMKE,
}: SectionCopiesProps): JSX.Element | null {
  const { config } = useConfig()
  const { collectionSlug, id } = useDocumentInfo()
  const slug = useFormFields(([fields]) => fields?.slug?.value)
  const title = useFormFields(([fields]) => fields?.title?.value)
  const { blockPath, rowIndex } = blockPathOf(path)
  const siblings = useSiblingRows(blockPath)
  const szekcio = siblings[rowIndex]
  const blockType =
    isRecord(szekcio) && typeof szekcio.blockType === 'string' ? szekcio.blockType : ''
  const kell = collectionSlug === 'pages' && blockPath.length > 0 && kellLekeres(blockType)
  const apiAlap = `${config.serverURL ?? ''}${config.routes.api}`
  const docId = ervenyesId(id) ? id : null
  const kulcs = dokumentumKulcs(apiAlap, docId)
  const [adat, setAdat] = useState<{ kulcs: string; ertek: MasolatAdatok } | null>(null)

  useEffect(() => {
    if (!kell) {
      return
    }
    let aktiv = true
    csatol(kulcs)
    void masolatAdatok(apiAlap, docId).then((ertek) => {
      if (aktiv) {
        setAdat({ kulcs, ertek })
      }
    })
    return () => {
      aktiv = false
      lecsatol(kulcs)
    }
  }, [kell, apiAlap, docId, kulcs])

  if (!kell || adat === null || adat.kulcs !== kulcs) {
    return null
  }
  const model = szekcioMasolatok({
    oldal: { id: docId, slug, title, layout: siblings },
    sorIndex: rowIndex,
    masOldalak: adat.ertek.masOldalak,
    munkatarsak: adat.ertek.munkatarsak,
    cimkek,
    adminRoute: config.routes.admin,
  })
  return <SectionCopiesView model={model} />
}
