'use client'

import {
  CheckboxField,
  CheckboxInput,
  FieldDescription,
  FieldLabel,
  useField,
  useFormFields,
} from '@payloadcms/ui'
import { mergeFieldStyles } from '@payloadcms/ui/shared'
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
  isPriceDropMessageFor,
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
 * dobozára épül (custom.scss, mindkét témán mért AA), saját szín nélkül; a
 * szélesség a Payload mezőstílusa (mergeFieldStyles: `--field-width` vagy
 * rugalmas kitöltés a sorban), mint a gyári mezőknél.
 *
 * A beviteli mező `aria-describedby`-ja a hibaüzenetre, az előnézetre és a
 * súgóra mutat, hibánál `aria-invalid` is áll: a felolvasó a mezőre lépve
 * hallja, mi a baj és mi a teendő (WCAG 2.2 SC 3.3.1 Error Identification,
 * Technique ARIA21: „Displays an error message which is programmatically
 * connected to the relevant form field using the aria-describedby attribute”,
 * https://www.w3.org/WAI/WCAG22/Techniques/aria/ARIA21; a GOV.UK Design System
 * Error message példáiban a mező `aria-describedby`-ja a súgóra és a hibára is
 * mutat, https://design-system.service.gov.uk/components/error-message/). A
 * Payload FieldDescription nem ad azonosítót, ezért egy azonosítós doboz veszi
 * körül.
 *
 * A hibaüzenet a mező fölött, a folyamban áll, nem a Payload lebegő
 * hibabuborékában (r2-termekor, H7). Mért hiba: a Payload 1024 px-en és
 * keskenyebben minden hibabuborékot elrejt (@payloadcms/ui Tooltip:
 * `@include mid-break { display: none }`), így tableten és kis laptopon a
 * tulajdonos nem látta, miért utasította el a mentés a 80 Ft-ot; 1025 px
 * fölött pedig a többsoros buborék felfelé nőve a fölötte álló mezőre lógott.
 * A hiba szövegének láthatónak kell lennie (WCAG 2.2 SC 3.3.1), a mező
 * közelében és takarás nélkül: GOV.UK Design System, Error message („put the
 * message in red after the question text and hint text”,
 * https://design-system.service.gov.uk/components/error-message/); NN/g,
 * 10 Design Guidelines for Reporting Errors in Forms, 3. „Keep Error Messages
 * Next to Fields” és 9. „Don't Use Tooltips to Report Errors”
 * (https://www.nngroup.com/articles/errors-forms-design-guidelines/). A színe
 * a Payload saját mezőhibájáé (error-300 alapon error-950), így ugyanúgy
 * hibának olvasható, mint a többi mezőé.
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
  /** A doboz szövege: miért kér megerősítést (a mentés üzenete vagy a kliens figyelmeztetése). */
  warning: string | null
  /** A szöveg a mentés hibaüzenete (a mező fölött ilyenkor nem ismétlődik). */
  fromServer: boolean
}

const NO_PROMPT: PriceDropPrompt = { show: false, warning: null, fromServer: false }

/**
 * A megerősítés megjelenítése (tiszta függvény). A kliens a betöltéskori
 * értékhez méri a csökkenést; a szerver a legutóbb közzétett árhoz. Ha a
 * kettő eltér (a piszkozatban már az új ár állt), a mentés hibaüzenete dönt.
 *
 * r2-termekor (H7, H9, mérve Chromiumban):
 * - A doboz a mentés üzenetét is kimondja (a közzétett ár és a „fele”): a
 *   doboz addig csak a jelölőnégyzetet mutatta („Igen, az új ár valóban
 *   80 Ft.”), az indoklás pedig 1024 px-en és keskenyebben sehol nem látszott.
 * - Csak a MOST beírt összegre szóló üzenet számít (isPriceDropMessageFor): a
 *   Payload a szerver üzenetét a javított érték mellett is az űrlap-állapotban
 *   hagyja, így a kijavított 79 500 Ft alatt ott maradt egy „Igen, az új ár
 *   valóban 79 500 Ft.” doboz. Az üzenet akkor él, ha a mező hibás
 *   (`showError`), vagy ha a tulajdonos épp erre az összegre bólintott rá (a
 *   pipa után a Payload újravalidál, a mező érvényes lesz, és a doboz nem
 *   tűnhet el a pipa alól).
 * - Élő szerver-üzenetnél a kliens „eddigi ár” figyelmeztetése nem jelenik
 *   meg: egy mezőben két különböző „régi ár” állt (piszkozat és közzétett).
 * - Hibás beírásnál (tizedesvessző) nincs doboz: az űrlap értéke ilyenkor a
 *   legutóbbi érvényes szám, és a doboz a beírttól eltérő összeget nevezett meg.
 */
export function derivePriceDropPrompt(input: {
  kind: PriceFieldKind
  value: unknown
  reference: PriceReference | null
  errorMessage: unknown
  showError: boolean
  confirmed: boolean
  parseError: string | null
}): PriceDropPrompt {
  const { kind, value, reference, errorMessage } = input
  if (input.parseError !== null) return NO_PROMPT
  if (typeof value !== 'number' || !Number.isFinite(value)) return NO_PROMPT
  if (isPriceDropMessageFor(kind, value, errorMessage) && (input.showError || input.confirmed)) {
    return { show: true, warning: errorMessage, fromServer: true }
  }
  if (reference !== null && isPriceDrop(value, reference.price)) {
    return {
      show: true,
      warning: priceDropWarning(kind, value, reference.price, reference.kind),
      fromServer: false,
    }
  }
  return NO_PROMPT
}

/**
 * A mező fölött álló hibaszöveg: a beírás hibája, különben a mentés üzenete,
 * ha a mező hibás; null, ha nincs mit mutatni. Az árcsökkenés üzenetét a
 * megerősítő doboz mondja ki, a mező fölött nem ismétlődik.
 */
export function fieldErrorText(input: {
  parseError: string | null
  showError: boolean
  errorMessage: unknown
  prompt: PriceDropPrompt
}): string | null {
  if (input.parseError !== null) return input.parseError
  const { errorMessage, prompt } = input
  if (!input.showError || typeof errorMessage !== 'string' || errorMessage.length === 0) {
    return null
  }
  return prompt.fromServer && prompt.warning === errorMessage ? null : errorMessage
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

/**
 * A Payload mezőhibájának színei (@payloadcms/ui FieldError), a folyamban. A
 * szélesség a szöveghez igazodik, legfeljebb a tájékoztató dobozokéval
 * egyező 38em (kb. 75 karakteres sor, a termektervezes skill 45–85 karakteres
 * sorhossza).
 */
const fieldErrorStyle: CSSProperties = {
  background: 'var(--theme-error-300)',
  borderRadius: 'var(--style-radius-s)',
  boxSizing: 'border-box',
  color: 'var(--theme-error-950)',
  lineHeight: 1.5,
  margin: '0 0 calc(var(--base) * 0.4)',
  maxWidth: '38em',
  overflowWrap: 'anywhere',
  padding: 'calc(var(--base) * 0.2) calc(var(--base) * 0.4)',
  width: 'fit-content',
}

/**
 * A beviteli mező `aria-describedby` értéke: hiba (a mező fölötti hibaszöveg
 * vagy a doboz indoklása), előnézet, súgó; ha egyik sincs, nincs attribútum.
 */
export function describedByIds(ids: {
  errorId: string | null
  previewId: string | null
  descriptionId: string | null
}): string | undefined {
  const list = [ids.errorId, ids.previewId, ids.descriptionId].filter(
    (id): id is string => id !== null,
  )
  return list.length === 0 ? undefined : list.join(' ')
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

  // H5: a megerősítés értékhez kötött. Ha a mező értéke már nem az, amire a
  // tulajdonos rábólintott, a megerősítés törlődik. A Payload a mentés után az
  // űrlap-állapot sémán kívüli útjait megtartja (mergeServerFormState:
  // `{...currentState}`), így egy korábbi megerősítés bent ragadt, és ugyanaz
  // az összeg később új jóváhagyás nélkül ment át. A törlés nem jelöli
  // módosítottnak az űrlapot (a setValue második paramétere).
  const { setValue: setConfirmation, value: confirmedPrice } = confirmation
  useEffect(() => {
    if (confirmedPrice !== null && confirmedPrice !== undefined && confirmedPrice !== value) {
      setConfirmation(null, true)
    }
  }, [confirmedPrice, setConfirmation, value])

  const reference = clientPriceReference({ kind, initialValue, regularPrice, regularEnabled })
  const confirmed = typeof value === 'number' && confirmedPrice === value
  const prompt = derivePriceDropPrompt({
    kind,
    value,
    reference,
    errorMessage,
    showError,
    confirmed,
    parseError,
  })
  const errorText = fieldErrorText({ parseError, showError, errorMessage, prompt })

  const inputId = `field-${path.replace(/\./g, '__')}`
  const previewId = `${inputId}-elonezet`
  const errorId = `${inputId}-hiba`
  const warningId = `${inputId}-figyelmeztetes`
  const descriptionId = `${inputId}-sugo`
  const showAnyError = parseError !== null || showError
  const locked = Boolean(readOnly) || disabled
  const describedBy = describedByIds({
    errorId: errorText !== null ? errorId : showAnyError && prompt.fromServer ? warningId : null,
    previewId: parsed.kind === 'ertek' ? previewId : null,
    descriptionId: field.admin?.description ? descriptionId : null,
  })

  return (
    <div
      className={[
        'field-type',
        'number',
        showAnyError ? 'error' : null,
        locked ? 'read-only' : null,
      ]
        .filter(Boolean)
        .join(' ')}
      style={mergeFieldStyles(field)}
    >
      <FieldLabel htmlFor={inputId} label={field.label} path={path} required={field.required} />
      <div className="field-type__wrap">
        {errorText !== null ? (
          <p id={errorId} style={fieldErrorStyle}>
            {errorText}
          </p>
        ) : null}
        <div style={inputRowStyle}>
          <input
            aria-describedby={describedBy}
            aria-invalid={showAnyError ? true : undefined}
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
              <p className="kc-admin-notice__szoveg" id={warningId}>
                {prompt.warning}
              </p>
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
        <div id={descriptionId}>
          <FieldDescription description={field.admin?.description} path={path} />
        </div>
      </div>
    </div>
  )
}

const paidCourseStyle: CSSProperties = {
  flex: '1 1 100%',
  maxWidth: '100%',
}

/** A Payload „mid-break” töréspontja (@payloadcms/ui scss: $breakpoint-m-width 1024px). */
const PAYLOAD_MID_BREAK_QUERY = '(max-width: 1024px)'

/**
 * Keskeny nézet-e, ahol a Payload a mezők hibabuborékát elrejti
 * (Tooltip: `@include mid-break { display: none }`). Szerveren és az első
 * kliens-renderben hamis; utána a böngésző média-lekérdezése dönt, és a
 * méretváltozást is követi.
 */
function usePayloadMidBreak(): boolean {
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const query = window.matchMedia(PAYLOAD_MID_BREAK_QUERY)
    const update = (): void => setNarrow(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return narrow
}

export function PaidCourseField(props: CheckboxFieldClientProps): JSX.Element {
  const { path: stalePath, readOnly } = props
  const { errorMessage, initialValue, path, showError, value } = useField<boolean>({
    potentiallyStalePath: stalePath,
  })
  // A pipa a Payload saját CheckboxField-je, a hibáját a Payload buboréka
  // mutatja; 1024 px-en és keskenyebben azt a Payload elrejti, így a
  // munkatárs (akinek a közzétételét az őr a tulajdonos piszkozata miatt
  // elutasította) csak egy piros pipát látott, magyarázat nélkül (mérve,
  // Chromium). Ott a hibaszöveg a pipa fölött, a folyamban áll, a HufPriceField
  // hibaszövegével azonos formában; szélesebb nézetben a buborék mondja ki.
  const narrow = usePayloadMidBreak()
  const narrowError =
    narrow && showError && typeof errorMessage === 'string' && errorMessage.length > 0
      ? errorMessage
      : null
  const confirmation = useField<boolean | null>({ path: confirmationPath('freeCourse') })
  const show = showFreeCoursePrompt({ value, initialValue, errorMessage })
  const confirmId = `field-${path.replace(/\./g, '__')}-megerosites`

  // H5: az „ingyenes legyen” megerősítés csak a kivett pipára szól. Ha a pipa
  // visszakerül, a megerősítés törlődik; különben (a Payload a mentés után a
  // sémán kívüli űrlap-utat megtartja) egy későbbi, véletlen kivétel már
  // bepipált megerősítéssel, új jóváhagyás nélkül ment át. Nem a betöltéskori
  // érték változására törlünk: az autosave azt is mozgatja, és a frissen
  // megadott megerősítést a közzététel előtt eltüntetné.
  const { setValue: setConfirmation, value: confirmedFree } = confirmation
  useEffect(() => {
    if (value !== false && confirmedFree !== null && confirmedFree !== undefined) {
      setConfirmation(null, true)
    }
  }, [confirmedFree, setConfirmation, value])

  return (
    <div style={paidCourseStyle}>
      {narrowError !== null ? (
        <p id={`field-${path.replace(/\./g, '__')}-hiba`} style={fieldErrorStyle}>
          {narrowError}
        </p>
      ) : null}
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
