'use client'

import {
  CheckboxField,
  CheckboxInput,
  FieldDescription,
  FieldError,
  FieldLabel,
  useField,
  useFormFields,
} from '@payloadcms/ui'
import type { CheckboxFieldClientProps, NumberFieldClientProps } from 'payload'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
} from 'react'

import {
  FREE_COURSE_CONFIRM_LABEL,
  FREE_COURSE_WARNING,
  confirmationPath,
  formatHufInput,
  hufPreviewText,
  isFreeCourseGuardMessage,
  isPriceDrop,
  isPriceDropMessage,
  parseHufInput,
  positivePriceOrNull,
  priceDropConfirmLabel,
  priceDropWarning,
  unusualGroupingNote,
  type PriceFieldKind,
} from './huf-price'

/**
 * A kurzus forintos ár-mezői az adminban (r2-termekor, a-cms-2 és a-cms-1).
 *
 * HufPriceField: az „Ár (Ft)” és az „Akciós ár (Ft)” beviteli mezője. A plugin
 * gyári PriceInput-ja a pontot tizedesjelnek vette, így a magyarul beírt
 * „79.500” 80 Ft lett. Itt a pont és a szóköz ezres tagoló, a tizedesvessző
 * hiba, és a mező alatt mindig ott áll, mennyi lesz az ár („Így jelenik meg:
 * 79 500 Ft”), a vásárlói felület formázójával.
 * - Szöveges mező `inputmode="numeric"`-kel, nem `type="number"`: GOV.UK
 *   Design System, Text input: „If you're asking the user to enter a whole
 *   number, set the inputmode attribute to numeric” és „Do not use
 *   <input type="number"> unless your user research shows that there's a need
 *   for it” (https://design-system.service.gov.uk/components/text-input/).
 * - A „Ft” utótag a mező mellett áll, a felolvasó elől rejtve (a címke már
 *   kimondja): ugyanott, „Use prefixes and suffixes to help users enter things
 *   like currencies”.
 * - Ha az új ár kisebb az eddigi felénél, a mező alatt figyelmeztetés és egy
 *   erre az összegre szóló megerősítő jelölőnégyzet jelenik meg; a mentés
 *   (src/plugins/ecommerce.ts validatePriceInHUF, validatePromoPriceHuf)
 *   enélkül hibát ad. WCAG 2.2 SC 3.3.4 (Error Prevention: Legal, Financial,
 *   Data): „checked … or confirmed”; NN/g, Confirmation Dialogs Can Prevent
 *   User Errors: „Do not use confirmation dialogs for routine actions”
 *   (https://www.nngroup.com/articles/confirmation-dialog/), ezért csak a
 *   szokatlan csökkenésnél kérdez.
 *
 * PaidCourseField: a „Fizetős kurzus” pipa a gyári megjelenéssel, alatta a
 * kivétel következményével és a megerősítéssel. A mező a sor teljes szélességét
 * kapja, az ár alá kerül: NN/g, Website Forms Usability: „sticking to a single
 * column with a separate row for each field”
 * (https://www.nngroup.com/articles/web-form-design/); a hosszabb súgó így nem
 * nyomja szét a sort.
 *
 * A megerősítés az űrlap-állapot `kcMegerositesek.*` útján megy a mentéssel
 * (nem séma-mező, nem tárolódik; src/components/admin/huf-price.ts). A stílus a
 * Payload saját mezőosztályaira és a B1 stílusszerződés .kc-admin-notice
 * dobozára épül (custom.scss, mindkét témán mért AA), saját szín nélkül.
 */

type HufPriceFieldProps = NumberFieldClientProps & { kind?: PriceFieldKind }

/** A megerősítés kulcsa a két ár-mezőhöz. */
const CONFIRMATION_FOR: Record<PriceFieldKind, 'priceInHUF' | 'promoPriceHuf'> = {
  rendes: 'priceInHUF',
  akcios: 'promoPriceHuf',
}

export interface PriceDropPrompt {
  /** Kell-e a megerősítő jelölőnégyzet. */
  show: boolean
  /** A mező alatti figyelmeztetés, vagy null (ha a mentés hibaüzenete már kimondja). */
  warning: string | null
}

/**
 * A megerősítés megjelenítése (tiszta függvény). A kliens a betöltéskori
 * értékhez méri a csökkenést; a szerver a közzétett árhoz. Ha a kettő eltér
 * (a piszkozatban már az új ár állt), a mentés hibaüzenete dönt.
 */
export function derivePriceDropPrompt(input: {
  kind: PriceFieldKind
  value: unknown
  reference: PriceReference | null
  errorMessage: unknown
}): PriceDropPrompt {
  const { kind, value, reference, errorMessage } = input
  if (typeof value !== 'number' || !Number.isFinite(value)) return { show: false, warning: null }
  if (reference !== null && isPriceDrop(value, reference.price)) {
    return { show: true, warning: priceDropWarning(kind, value, reference.price, reference.kind) }
  }
  return { show: isPriceDropMessage(errorMessage), warning: null }
}

export interface PriceReference {
  price: number
  kind: PriceFieldKind
}

/**
 * A kliens-oldali hivatkozási ár: a mező betöltésekori értéke; új akciós árnál
 * (még nem volt) a bekapcsolt rendes ár.
 */
export function clientPriceReference(input: {
  kind: PriceFieldKind
  initialValue: unknown
  regularPrice: unknown
  regularEnabled: unknown
}): PriceReference | null {
  const initial = positivePriceOrNull(input.initialValue)
  if (initial !== null) return { price: initial, kind: input.kind }
  if (input.kind !== 'akcios' || input.regularEnabled !== true) return null
  const regular = positivePriceOrNull(input.regularPrice)
  return regular === null ? null : { price: regular, kind: 'rendes' }
}

/**
 * A „Fizetős kurzus” pipa alatti megerősítés: ha a betöltött kurzus fizetős
 * volt, és a pipa most ki van véve, vagy a mentés hibaüzenete kéri.
 */
export function showFreeCoursePrompt(input: {
  value: unknown
  initialValue: unknown
  errorMessage: unknown
}): boolean {
  return (
    input.value === false &&
    (input.initialValue === true || isFreeCourseGuardMessage(input.errorMessage))
  )
}

const inputRowStyle: CSSProperties = {
  alignItems: 'center',
  display: 'flex',
  gap: 'calc(var(--base) * 0.5)',
}

const inputStyle: CSSProperties = {
  maxWidth: '14rem',
}

const noteStyle: CSSProperties = {
  color: 'var(--theme-elevation-800)',
  lineHeight: 1.5,
  margin: 'calc(var(--base) * 0.4) 0 0',
}

const noticeStyle: CSSProperties = {
  margin: 'calc(var(--base) * 0.5) 0',
}

/** A beírt szöveg hibaüzenete, vagy null (a tárolt érték mutatásakor nincs hiba). */
function typedParseError(typed: string | null): string | null {
  if (typed === null) return null
  const result = parseHufInput(typed)
  return result.kind === 'hiba' ? result.message : null
}

function textFromValue(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? formatHufInput(value) : ''
}

export function HufPriceField(props: HufPriceFieldProps): JSX.Element {
  const { field, kind = 'rendes', path: stalePath, readOnly } = props
  // null: a mező a tárolt értéket mutatja (formázva); szöveg: a szerkesztő
  // éppen ezt írta be.
  const [typed, setTyped] = useState<string | null>(null)
  const parseError = useMemo(() => typedParseError(typed), [typed])
  // Érvénytelen szövegnél az űrlap értéke a legutóbbi jó összeg marad; a
  // kliens-oldali validátor ilyenkor megakasztja a mentést, hogy ne a régi
  // szám menjen el észrevétlenül.
  const validate = useCallback(() => (parseError === null ? true : parseError), [parseError])
  const { disabled, errorMessage, initialValue, path, setValue, showError, value } = useField<
    number | null
  >({ potentiallyStalePath: stalePath, validate })
  const confirmation = useField<number | null>({ path: confirmationPath(CONFIRMATION_FOR[kind]) })
  const regularPrice = useFormFields(([fields]) => fields?.priceInHUF?.value)
  const regularEnabled = useFormFields(([fields]) => fields?.priceInHUFEnabled?.value)

  // A tárolt érték kívülről is változhat (betöltés, mentés utáni visszaállítás):
  // ilyenkor a mező újra a tárolt értéket mutatja. A saját beírás nem íródik felül.
  const committed = useRef<unknown>(value)
  useEffect(() => {
    if (value !== committed.current) {
      committed.current = value
      setTyped(null)
    }
  }, [value])

  const text = typed ?? textFromValue(value)
  const parsed = parseHufInput(text)

  const onChange = (next: string): void => {
    setTyped(next)
    const result = parseHufInput(next)
    const nextValue =
      result.kind === 'ertek' ? result.value : result.kind === 'ures' ? null : undefined
    if (nextValue !== undefined && nextValue !== value) {
      committed.current = nextValue
      setValue(nextValue)
    }
  }

  // Kilépéskor a szabályos beírás a tárolt érték formázott alakjára vált
  // („79500” → „79 500”); a szokatlan tagolás látható marad a jelzésével.
  const onBlur = (): void => {
    if (parsed.kind === 'ertek' && !parsed.unusualGrouping) setTyped(null)
  }

  const reference = clientPriceReference({ kind, initialValue, regularPrice, regularEnabled })
  const prompt = derivePriceDropPrompt({ kind, value, reference, errorMessage })
  const confirmed = typeof value === 'number' && confirmation.value === value

  const inputId = `field-${path.replace(/\./g, '__')}`
  const previewId = `${inputId}-elonezet`
  const showAnyError = parseError !== null || showError
  const locked = Boolean(readOnly) || disabled

  return (
    <div
      className={['field-type', 'number', showAnyError ? 'error' : null].filter(Boolean).join(' ')}
      style={field.admin?.style}
    >
      <FieldLabel htmlFor={inputId} label={field.label} path={path} required={field.required} />
      <div className="field-type__wrap">
        <FieldError
          path={path}
          showError={showAnyError}
          {...(parseError === null ? {} : { message: parseError })}
        />
        <div style={inputRowStyle}>
          <input
            aria-describedby={parsed.kind === 'ertek' ? previewId : undefined}
            autoComplete="off"
            disabled={locked}
            id={inputId}
            inputMode="numeric"
            name={path}
            onBlur={onBlur}
            onChange={(event) => onChange(event.target.value)}
            style={inputStyle}
            type="text"
            value={text}
          />
          <span aria-hidden="true">Ft</span>
        </div>
        {parsed.kind === 'ertek' ? (
          <p id={previewId} style={noteStyle}>
            {hufPreviewText(parsed.value)}
          </p>
        ) : null}
        {parsed.kind === 'ertek' && parsed.unusualGrouping ? (
          <p style={noteStyle}>{unusualGroupingNote(parsed.value)}</p>
        ) : null}
        {prompt.show && typeof value === 'number' ? (
          <div
            className="kc-admin-notice kc-admin-notice--figyelem"
            role="status"
            style={noticeStyle}
          >
            <p className="kc-admin-notice__cim">Figyelem</p>
            {prompt.warning !== null ? (
              <p className="kc-admin-notice__szoveg">{prompt.warning}</p>
            ) : null}
            <CheckboxInput
              checked={confirmed}
              id={`${inputId}-megerosites`}
              label={priceDropConfirmLabel(kind, value)}
              name={`${inputId}-megerosites`}
              onToggle={() => confirmation.setValue(confirmed ? null : value)}
              readOnly={locked}
            />
          </div>
        ) : null}
        <FieldDescription description={field.admin?.description} path={path} />
      </div>
    </div>
  )
}

const paidCourseStyle: CSSProperties = {
  flex: '1 1 100%',
  maxWidth: '100%',
}

export function PaidCourseField(props: CheckboxFieldClientProps): JSX.Element {
  const { path: stalePath, readOnly } = props
  const { errorMessage, initialValue, path, value } = useField<boolean>({
    potentiallyStalePath: stalePath,
  })
  const confirmation = useField<boolean | null>({ path: confirmationPath('freeCourse') })
  const show = showFreeCoursePrompt({ value, initialValue, errorMessage })
  const confirmId = `field-${path.replace(/\./g, '__')}-megerosites`

  return (
    <div style={paidCourseStyle}>
      <CheckboxField {...props} />
      {show ? (
        <div
          className="kc-admin-notice kc-admin-notice--figyelem"
          role="status"
          style={noticeStyle}
        >
          <p className="kc-admin-notice__cim">Figyelem</p>
          <p className="kc-admin-notice__szoveg">{FREE_COURSE_WARNING}</p>
          <CheckboxInput
            checked={confirmation.value === true}
            id={confirmId}
            label={FREE_COURSE_CONFIRM_LABEL}
            name={confirmId}
            onToggle={() => confirmation.setValue(confirmation.value === true ? null : true)}
            readOnly={Boolean(readOnly)}
          />
        </div>
      ) : null}
    </div>
  )
}
