'use client'

import { useConfig, useRowLabel, useWatchForm } from '@payloadcms/ui'
import { unflatten } from 'payload/shared'
import { useEffect, useState, type JSX } from 'react'

import {
  arrayRowLabel,
  describeSection,
  ELVALASZTO,
  REJTVE_JEL,
  sectionRepeatOrdinals,
  repeatMarker,
  type SectionDescription,
} from '../../lib/section-row-label'

import './section-row-label.css'

/**
 * Az Oldalak „Szekciók” sorainak és a blokkokon belüli tömbsoroknak a
 * felirata (Payload blokk-`Label`, illetve tömb-`RowLabel`).
 *
 * A logika a tiszta, tesztelt src/lib/section-row-label.ts-ben él; itt csak a
 * Payload űrlapállapotát olvassuk ki. A `useRowLabel` a `useWatchForm`-ra épül,
 * ezért a felirat gépelés közben, mentés nélkül frissül.
 *
 * Akadálymentesség: a sorcímke `h3` címsor, így képernyőolvasóval a szekciók
 * címsorról címsorra bejárhatók (WCAG 2.2 SC 1.3.1, 2.4.6: „Headings and
 * labels describe topic or purpose.”). IBM Carbon, Accordion: „Each title
 * should be wrapped in a role heading (h1-h6) that is appropriate for the
 * information architecture of the page.”
 * (https://carbondesignsystem.com/components/accordion/usage/). A címsor
 * egyben a blokk belsejében álló „Megnézem az oldalon” link kontextusa is
 * (W3C H80, link + megelőző címsor, SC 2.4.4).
 *
 * Miért éppen `h3`: a Payload a beágyazott tömb- és blokkmezők címét (a
 * „Szekciók”, és a blokkon belül pl. „Bekezdések”, „Logók”) beégetett `h3`-ként
 * írja ki (@payloadcms/ui/dist/fields/Blocks/index.js:318,
 * Array/index.js:307). A Lexical-szerkesztő tartalma (`h2`, `h3`) is a lap
 * címsorrendjébe számít. Ezért csak a `h3` ad fordítatlan vázlatot és
 * heading-order-hiba nélküli sort: `h4`-gyel a blokk belső `h3`-a a
 * vázlatban a szekciócím fölé kerülne, és kilógna a szekcióból. Mért
 * bizonyíték (kinyitott sorok, axe heading-order): a /rolunk oldalon a szabad
 * szöveg szerkesztőjének `h2`-je után álló `h4` sorcímke heading-order hibát
 * adott; `h3`-mal a sorcímkére eső találat 0, és a sorfejléc magassága és
 * betűje változatlan (a section-row-label.css a címsor-stílust visszaállítja).
 *
 * Interaktív elem a fejlécben nincs: a Payload összecsukó gombja a fejléc
 * fölött fekszik, a fejléc `pointer-events: none` (Collapsible/index.scss),
 * beágyazott vezérlő tehát nested-interactive hibát adna. A rejtettséget
 * szöveg mondja ki, nem csak szín (SC 1.4.1).
 */

interface SectionRowLabelProps {
  /** A blokktípus emberi neve (a blokk `labels.singular`-ja), a blocks/index.ts adja. */
  blockLabel?: string
  /** A blokk text/textarea mezőinek neve, a cím tartaléka. */
  textFields?: readonly string[]
}

/** A sor útvonalából („layout.3”) a Szekciók-mező útvonala („layout”). */
function parentPathOf(path: string): string {
  const index = path.lastIndexOf('.')
  return index > 0 ? path.slice(0, index) : path
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * A Szekciók-mező összes sorának adata az űrlapállapotból, EGYETLEN
 * bejárással, a Payload `getDataByPath` szabályai szerint (a
 * `disableFormData` mező kimarad, az üres tömb `[]`).
 *
 * Miért nem soronkénti `getDataByPath`: az minden hívásnál a TELJES
 * űrlapállapotot bejárja, és minden sorcímke minden testvért lekér, így 15
 * szekciónál leütésenként 225 teljes bejárás lenne. Mérve Node-ban, egy
 * 1166 mezős, 15 szekciós űrlapállapoton (szekciónként 20 szövegmező és egy
 * ötsoros tömb, mellette 400 más mező), 50 ismétlés átlagával: soronkénti
 * `getDataByPath`-tal 50,7 ms, egy bejárással és a lenti közös
 * gyorsítótárral 2,5 ms leütésenként.
 */
export function siblingRowsFromState(
  fields: Readonly<Record<string, unknown>>,
  parentPath: string,
): unknown[] {
  const prefix = `${parentPath}.`
  const flat: Record<string, unknown> = {}
  for (const [key, field] of Object.entries(fields)) {
    if (!key.startsWith(prefix) || !isRecord(field) || field.disableFormData === true) {
      continue
    }
    flat[key.slice(prefix.length)] =
      Array.isArray(field.rows) && field.rows.length === 0 ? [] : field.value
  }
  const parent = fields[parentPath]
  const count = !isRecord(parent)
    ? 0
    : Array.isArray(parent.rows)
      ? parent.rows.length
      : typeof parent.value === 'number'
        ? parent.value
        : 0
  const tree: unknown = unflatten(flat)
  return Array.from({ length: count }, (_, index) =>
    isRecord(tree) ? tree[String(index)] : undefined,
  )
}

/**
 * Egy űrlapállapotra (a Payload minden változáskor új objektumot ad) és
 * Szekciók-mezőre egyszer számolt sorlista: a 15 sorcímke és a 15 tájékoztató
 * ugyanazt használja, nem mindegyik a sajátját.
 */
const sorokAllapotonkent = new WeakMap<object, Map<string, unknown[]>>()

/** A testvérsorok adatai a Szekciók-mező sorrendjében. */
export function useSiblingRows(rowPath: string): unknown[] {
  const { fields } = useWatchForm()
  const parentPath = parentPathOf(rowPath)
  let utvonalankent = sorokAllapotonkent.get(fields)
  if (!utvonalankent) {
    utvonalankent = new Map()
    sorokAllapotonkent.set(fields, utvonalankent)
  }
  const meglevo = utvonalankent.get(parentPath)
  if (meglevo) {
    return meglevo
  }
  const sorok = siblingRowsFromState(fields, parentPath)
  utvonalankent.set(parentPath, sorok)
  return sorok
}

/** A sorcímke megjelenítése (a render-teszt ezt hívja közvetlenül). */
export function SectionRowLabelView({ leiras }: { leiras: SectionDescription }): JSX.Element {
  const vege = [leiras.blokkNev ? `(${leiras.blokkNev})` : null, repeatMarker(leiras.ismetles)]
    .filter((part): part is string => part !== null)
    .join(' ')
  return (
    <h3 className="kc-section-row-label row-label">
      <span className="kc-section-row-label__sorszam">{leiras.sorszam}</span>
      {ELVALASZTO}
      {leiras.rejtett ? (
        <>
          <span className="kc-section-row-label__rejtve">{REJTVE_JEL}</span>
          {ELVALASZTO}
        </>
      ) : null}
      <span className="kc-section-row-label__tipus">{leiras.tipus}:</span>{' '}
      <span className="kc-section-row-label__cim">{leiras.cimSzoveg}</span>
      {vege ? <span className="kc-section-row-label__jegyzet"> {vege}</span> : null}
    </h3>
  )
}

export function SectionRowLabel({
  blockLabel = '',
  textFields = [],
}: SectionRowLabelProps): JSX.Element {
  const { data, path, rowNumber } = useRowLabel<Record<string, unknown>>()
  const testverek = useSiblingRows(path)
  const index = typeof rowNumber === 'number' ? rowNumber : 0
  const leiras = describeSection(data, index, blockLabel, textFields)
  const ismetles = sectionRepeatOrdinals(testverek)[index] ?? null
  return <SectionRowLabelView leiras={{ ...leiras, ismetles }} />
}

interface ArrayRowLabelProps {
  /** A tömb egyes számú neve (pl. „Kérdés”). */
  singular?: string
  /** A sor cím-mezői, fontossági sorrendben. */
  titleFields?: readonly string[]
  /** Ha adott, minden nem üres cím-mező ezzel összefűzve (pl. a Számok sora). */
  separator?: string
  /** Képes sornál a kép mezőneve: szöveg híján a kép leírása lesz a felirat. */
  imageField?: string
}

/** A kiválasztott kép azonosítója az űrlapállapotból (szám, szöveg vagy { id }). */
function uploadId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }
  if (typeof value === 'string' && /^[\w-]+$/.test(value)) {
    return value
  }
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>
    return uploadId(record.id ?? record.value)
  }
  return null
}

/** A képek leírása munkamenetenként egyszer töltődik le (sok logó, egy kérés képenként). */
const kepFeliratok = new Map<string, Promise<string | null>>()

function loadImageTitle(apiRoute: string, id: string): Promise<string | null> {
  const cached = kepFeliratok.get(id)
  if (cached) {
    return cached
  }
  const params = new URLSearchParams({
    depth: '0',
    'select[alt]': 'true',
    'select[filename]': 'true',
  })
  const promise = fetch(`${apiRoute}/media/${encodeURIComponent(id)}?${params.toString()}`, {
    credentials: 'include',
  })
    .then(async (response) => {
      if (!response.ok) {
        return null
      }
      const body: unknown = await response.json()
      if (typeof body !== 'object' || body === null) {
        return null
      }
      const record = body as Record<string, unknown>
      const alt = typeof record.alt === 'string' ? record.alt.trim() : ''
      const filename = typeof record.filename === 'string' ? record.filename.trim() : ''
      return alt || filename || null
    })
    .catch(() => null)
  kepFeliratok.set(id, promise)
  return promise
}

function useImageTitle(imageValue: unknown): string | null {
  const { config } = useConfig()
  const apiRoute = `${config.serverURL ?? ''}${config.routes.api}`
  const id = uploadId(imageValue)
  const [felirat, setFelirat] = useState<{ id: string; text: string | null } | null>(null)
  useEffect(() => {
    if (id === null) {
      return
    }
    let aktiv = true
    void loadImageTitle(apiRoute, id).then((text) => {
      if (aktiv) {
        setFelirat({ id, text })
      }
    })
    return () => {
      aktiv = false
    }
  }, [apiRoute, id])
  return felirat !== null && felirat.id === id ? felirat.text : null
}

export function ArrayRowLabel({
  singular = '',
  titleFields = [],
  separator,
  imageField,
}: ArrayRowLabelProps): JSX.Element {
  const { data, rowNumber } = useRowLabel<Record<string, unknown>>()
  const imageValue = imageField && data ? data[imageField] : undefined
  const imageTitle = useImageTitle(imageValue)
  const felirat = arrayRowLabel(data, rowNumber, singular, titleFields, {
    ...(separator !== undefined ? { separator } : {}),
    imageTitle,
    hasImage: uploadId(imageValue) !== null,
  })
  return <span className="kc-array-row-label row-label">{felirat}</span>
}
