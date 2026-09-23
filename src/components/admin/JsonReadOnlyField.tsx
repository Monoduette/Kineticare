'use client'

import { getTranslation } from '@payloadcms/translations'
import { FieldDescription, FieldLabel, useField, useTranslation } from '@payloadcms/ui'
import type { CSSProperties, JSX } from 'react'
import type { JSONFieldClientProps, StaticDescription, StaticLabel } from 'payload'

/**
 * Csak olvasható JSON-nézet a rendszer által írt json-mezőkhöz (K01).
 *
 * MIÉRT KELL: a Payload a json-mezőt Monaco-szerkesztővel rajzolja, a
 * Monaco-betöltőt pedig CDN-ről húzza (cdn.jsdelivr.net). Az admin CSP-je ezt
 * helyesen tiltja, ezért a szerkesztő 0 px magas maradt, és a tartalom
 * olvashatatlan volt (mérve: orders/1, orders/9, audit-logs/79,
 * webhook-events/1, mind az 5 mezőn 0 px és 0 karakter, a konzolban CSP-hiba).
 * Az 5 mező mindegyike rendszer-írta adat (a rendelés vásárlói adatai és
 * visszatérítési naplója, a Műveletnapló előtte/utána állapota, a
 * webhook-esemény tárolt adatai), tehát szerkeszteni sosem kell őket: elég egy
 * formázott, sortörő szövegdoboz. A CSP nem változik, és a mezők readOnly-ja,
 * access-e is változatlan (a komponens csak megjelenít).
 *
 * AKADÁLYMENTESSÉG (mérve, a jelentésben számokkal):
 * - A doboz görgethető (max-height), ezért billentyűvel is elérhető kell
 *   legyen: tabIndex=0, role='region' és a látható címkére mutató
 *   aria-labelledby. Deque, scrollable-region-focusable: „ensure that a
 *   keyboard-only user can focus the scrollable region itself”
 *   (https://dequeuniversity.com/rules/axe/4.10/scrollable-region-focusable);
 *   WCAG 2.2 SC 2.1.1 Keyboard és SC 4.1.2 Name, Role, Value.
 * - 320 px-en sincs vízszintes görgetés: a sorok törnek (pre-wrap +
 *   overflow-wrap: anywhere). WCAG 2.2 SC 1.4.10 Reflow
 *   (https://www.w3.org/WAI/WCAG22/Understanding/reflow.html).
 * - A fókuszgyűrűt a Payload globális :focus-visible szabálya adja
 *   (--accessibility-outline, 2 px, --theme-text), SC 2.4.7.
 * - Üres értéknél nem üres keret áll, hanem kimondott magyar mondat (NN/g,
 *   Visibility of System Status). Az üres szöveg nem fókuszálható, mert nincs
 *   mit görgetni.
 *
 * A stílus a Payload admin saját témaváltozóira épül (világos és sötét témán
 * is), a csak olvasható mezők mintájára keret nélkül, halvány háttérrel.
 */

/** Az üres érték kimondott szövege (null, üres szöveg, üres lista vagy objektum). */
export const JSON_EMPTY_TEXT = 'Nincs mentett adat.'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * A megjelenítendő szöveg: két szóközzel behúzott JSON, vagy `null`, ha az
 * érték üres. Szöveges értéket változatlanul ad vissza (a json-mező primitív
 * szöveget is tárolhat). Soha nem dob: egy hibás érték nem omlaszthatja el a
 * szerkesztőlapot.
 */
export function formatJsonForDisplay(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value.trim() === '' ? null : value
  if (Array.isArray(value) && value.length === 0) return null
  if (isPlainObject(value) && Object.keys(value).length === 0) return null
  try {
    const text = JSON.stringify(value, null, 2)
    return typeof text === 'string' ? text : String(value)
  } catch {
    return String(value)
  }
}

/** A címke szövege a hozzáférhető névhez: a mező címkéje, annak híján a neve. */
export function jsonFieldLabelText(
  label: StaticLabel | undefined,
  name: string,
  translate: (label: StaticLabel) => string,
): string {
  if (label === undefined) return name
  const text = translate(label).trim()
  return text === '' ? name : text
}

/** A DOM-azonosító alapja a mező útvonalából (a pont nem szerepelhet benne). */
export function jsonFieldDomId(path: string): string {
  return `kc-json-${path.replace(/[^A-Za-z0-9_-]/g, '-')}`
}

const preStyle: CSSProperties = {
  margin: 0,
  padding: '12px 14px',
  maxHeight: '24rem',
  overflow: 'auto',
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
  fontFamily: 'var(--font-mono)',
  fontSize: '14px',
  lineHeight: 1.5,
  color: 'var(--theme-elevation-800)',
  background: 'var(--theme-elevation-100)',
  borderRadius: 'var(--style-radius-s)',
}

const emptyStyle: CSSProperties = {
  margin: 0,
  fontSize: '14px',
  lineHeight: 1.5,
  color: 'var(--theme-elevation-800)',
}

export interface JsonReadOnlyViewProps {
  /** A mező útvonala (a FieldLabel és a FieldDescription is ebből dolgozik). */
  path: string
  label: StaticLabel | undefined
  /** A hozzáférhető név szövege (a látható címkével azonos). */
  labelText: string
  description: StaticDescription | undefined
  /** A formázott JSON, vagy `null` üres értéknél. */
  text: string | null
}

/** A tiszta nézet: a hookok nélküli rész, DOM nélkül is tesztelhető. */
export function JsonReadOnlyView({
  path,
  label,
  labelText,
  description,
  text,
}: JsonReadOnlyViewProps): JSX.Element {
  const baseId = jsonFieldDomId(path)
  const labelId = `${baseId}-cimke`
  const descriptionId = `${baseId}-leiras`
  return (
    <div className="field-type kc-json-readonly" id={baseId}>
      <span id={labelId}>
        <FieldLabel as="span" label={label ?? labelText} path={path} />
      </span>
      {text === null ? (
        <p className="kc-json-readonly__empty" style={emptyStyle}>
          {JSON_EMPTY_TEXT}
        </p>
      ) : (
        <pre
          aria-describedby={description ? descriptionId : undefined}
          aria-labelledby={labelId}
          className="kc-json-readonly__pre"
          role="region"
          style={preStyle}
          tabIndex={0}
        >
          {text}
        </pre>
      )}
      {description ? (
        <div id={descriptionId}>
          <FieldDescription description={description} marginPlacement="top" path={path} />
        </div>
      ) : null}
    </div>
  )
}

/** Az `admin.components.Field` belépési pontja a json-mezőkön. */
export function JsonReadOnlyField(props: JSONFieldClientProps): JSX.Element {
  const { field, path: stalePath } = props
  const { path, value } = useField<unknown>({ potentiallyStalePath: stalePath })
  const { i18n } = useTranslation()
  const labelText = jsonFieldLabelText(field.label, field.name, (l) => getTranslation(l, i18n))
  return (
    <JsonReadOnlyView
      description={field.admin?.description}
      label={field.label}
      labelText={labelText}
      path={path}
      text={formatJsonForDisplay(value)}
    />
  )
}

export default JsonReadOnlyField
