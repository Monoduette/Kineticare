// @vitest-environment happy-dom

import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  FREE_COURSE_CONFIRM_LABEL,
  FREE_COURSE_NOTICE_TITLE,
  FREE_COURSE_WARNING,
  HUF_INPUT_DECIMAL_MESSAGE,
  PROMO_END_MISSING_NOTE,
  formatHufInput,
  freeCourseGuardMessage,
  priceDropConfirmLabel,
  priceDropMessage,
  priceDropWarning,
} from '../components/admin/huf-price'
import { formatPriceHuf } from '../lib/format-price'

/**
 * r2-termekor: a forintos beviteli mező és a „Fizetős kurzus” pipa az adminban
 * (src/components/admin/HufPriceField.tsx), valamint a lap tetejének ingyenes-
 * jelzése (CourseVisibilityNotice) és az akció hiányzó végének jegyzete
 * (CoursePromoStatus). A Payload űrlap-hookjait egy memóriabeli állapot adja;
 * a gépelést happy-dom alatt valódi React-renderrel játsszuk le. Hálózat nincs.
 */

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

interface FieldState {
  value?: unknown
  initialValue?: unknown
  errorMessage?: string
}

const form = vi.hoisted(() => ({
  fields: {} as Record<string, FieldState>,
  setValue: vi.fn<(path: string, value: unknown) => void>(),
  validators: {} as Record<string, () => unknown>,
  user: { id: 1, role: 'owner' } as { id: number; role: string } | null,
}))

vi.mock('@payloadcms/ui', async () => {
  const { createElement: h } = await import('react')
  return {
    useField: (options: {
      path?: string
      potentiallyStalePath?: string
      validate?: () => unknown
    }) => {
      const path = options.path ?? options.potentiallyStalePath ?? ''
      if (options.validate) form.validators[path] = options.validate
      const field = form.fields[path] ?? {}
      return {
        path,
        value: field.value,
        initialValue: field.initialValue,
        errorMessage: field.errorMessage,
        showError: field.errorMessage !== undefined,
        disabled: false,
        setValue: (value: unknown) => form.setValue(path, value),
      }
    },
    useFormFields: (selector: (state: [Record<string, FieldState>]) => unknown) =>
      selector([form.fields]),
    useAuth: () => ({ user: form.user }),
    FieldLabel: ({ label, htmlFor }: { label?: ReactNode; htmlFor?: string }) =>
      h('label', { htmlFor }, label),
    FieldError: ({ message, showError }: { message?: string; showError?: boolean }) =>
      showError ? h('span', { className: 'mezo-hiba' }, message ?? 'szerver-hiba') : null,
    FieldDescription: ({ description }: { description?: ReactNode }) =>
      h('div', { className: 'mezo-leiras' }, description),
    CheckboxInput: ({
      checked,
      id,
      label,
      onToggle,
    }: {
      checked?: boolean
      id: string
      label?: ReactNode
      onToggle: () => void
    }) =>
      h(
        'label',
        { htmlFor: id },
        h('input', { checked: Boolean(checked), id, onChange: onToggle, type: 'checkbox' }),
        label,
      ),
    CheckboxField: ({ field }: { field: { label?: ReactNode } }) =>
      h('div', { className: 'gyari-pipa' }, field.label),
  }
})

const {
  HufPriceField,
  PaidCourseField,
  clientPriceReference,
  derivePriceDropPrompt,
  describedByIds,
} = await import('../components/admin/HufPriceField')
const { CourseVisibilityNotice } = await import('../components/admin/CourseVisibilityNotice')
const { CoursePromoStatus, CoursePromoStatusView, promoEndNote } =
  await import('../components/admin/CoursePromoStatus')

const priceProps = {
  field: { name: 'priceInHUF', label: 'Ár (Ft)', admin: { description: 'Rendes ár.' } },
  path: 'priceInHUF',
  kind: 'rendes' as const,
} as unknown as Parameters<typeof HufPriceField>[0]

const promoProps = {
  field: { name: 'promoPriceHuf', label: 'Akciós ár (Ft)', admin: {} },
  path: 'promoPriceHuf',
  kind: 'akcios' as const,
} as unknown as Parameters<typeof HufPriceField>[0]

const paidProps = {
  field: { name: 'priceInHUFEnabled', label: 'Fizetős kurzus', admin: {} },
  path: 'priceInHUFEnabled',
} as unknown as Parameters<typeof PaidCourseField>[0]

beforeEach(() => {
  form.fields = {}
  form.validators = {}
  form.setValue.mockReset()
  vi.stubGlobal('fetch', () => {
    throw new Error('A tesztből SOSEM mehet ki valódi hálózati hívás.')
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('HufPriceField (SSR): a tárolt ár formázva, előnézettel', () => {
  it('79 500 Ft: szöveges mező numerikus billentyűzettel, „Ft” utótag, előnézet, figyelmeztetés nélkül', () => {
    form.fields.priceInHUF = { value: 79_500, initialValue: 79_500 }
    const html = renderToStaticMarkup(createElement(HufPriceField, priceProps))
    expect(html).toContain(`value="${formatHufInput(79_500)}"`)
    expect(html).toContain('type="text"')
    expect(html).toContain('inputMode="numeric"')
    expect(html).not.toContain('type="number"')
    expect(html).toContain('<span aria-hidden="true">Ft</span>')
    expect(html).toContain(`Így jelenik meg: ${formatPriceHuf(79_500)}`)
    expect(html).toContain('id="field-priceInHUF"')
    expect(html).not.toContain('role="status"')
  })

  it('a betöltött ár felénél kisebb új ár: figyelmeztetés és erre az összegre szóló megerősítés', () => {
    form.fields.priceInHUF = { value: 7_950, initialValue: 79_500 }
    const html = renderToStaticMarkup(createElement(HufPriceField, priceProps))
    expect(html).toContain('role="status"')
    expect(html).toContain(priceDropWarning('rendes', 7_950, 79_500))
    expect(html).toContain(priceDropConfirmLabel('rendes', 7_950))
    expect(html).not.toContain('checked=""')
    form.fields['kcMegerositesek.priceInHUF'] = { value: 7_950 }
    expect(renderToStaticMarkup(createElement(HufPriceField, priceProps))).toContain('checked=""')
  })

  it('ha a mentés hibaüzenete kér megerősítést (a piszkozatban már az új ár állt), a jelölőnégyzet megjelenik', () => {
    form.fields.priceInHUF = {
      value: 7_950,
      initialValue: 7_950,
      errorMessage: priceDropMessage('rendes', 7_950, 79_500),
    }
    const html = renderToStaticMarkup(createElement(HufPriceField, priceProps))
    expect(html).toContain(priceDropConfirmLabel('rendes', 7_950))
    // A hibaüzenetet a Payload FieldError-ja mutatja (az űrlap-állapotból);
    // a doboz nem ismétli meg.
    expect(html).toContain('mezo-hiba')
    expect(html).not.toContain(priceDropWarning('rendes', 7_950, 7_950))
  })

  it('a felolvasó a mezőn hallja az előnézetet és a súgót; hibánál a hibát is, aria-invalid mellett', () => {
    form.fields.priceInHUF = { value: 79_500, initialValue: 79_500 }
    const clean = renderToStaticMarkup(createElement(HufPriceField, priceProps))
    expect(clean).toContain('aria-describedby="field-priceInHUF-elonezet field-priceInHUF-sugo"')
    expect(clean).not.toContain('aria-invalid')
    expect(clean).toMatch(/<div id="field-priceInHUF-sugo"><div class="mezo-leiras">Rendes ár\.</)
    expect(clean).toMatch(/<p id="field-priceInHUF-elonezet"[^>]*>Így jelenik meg/)

    form.fields.priceInHUF = {
      value: 7_950,
      initialValue: 7_950,
      errorMessage: priceDropMessage('rendes', 7_950, 79_500),
    }
    const withError = renderToStaticMarkup(createElement(HufPriceField, priceProps))
    expect(withError).toContain(
      'aria-describedby="field-priceInHUF-hiba field-priceInHUF-elonezet field-priceInHUF-sugo"',
    )
    expect(withError).toContain('aria-invalid="true"')
    expect(withError).toMatch(/<div id="field-priceInHUF-hiba"><span class="mezo-hiba">/)
  })

  it('súgó és érték nélkül nincs aria-describedby; a hivatkozott azonosítók mind léteznek', () => {
    form.fields.promoPriceHuf = { value: null, initialValue: null }
    const html = renderToStaticMarkup(createElement(HufPriceField, promoProps))
    expect(html).not.toContain('aria-describedby')
    expect(describedByIds({ errorId: null, previewId: null, descriptionId: null })).toBeUndefined()
    expect(describedByIds({ errorId: 'h', previewId: null, descriptionId: 's' })).toBe('h s')
  })

  it('a Payload mezőstílusa: sorban rugalmas kitöltés, megadott szélességnél --field-width; zárt mezőn read-only osztály', () => {
    form.fields.priceInHUF = { value: 79_500, initialValue: 79_500 }
    expect(renderToStaticMarkup(createElement(HufPriceField, priceProps))).toContain(
      'style="flex:1 1 auto"',
    )
    const withWidth = {
      ...priceProps,
      field: { ...priceProps.field, admin: { width: '50%' } },
    } as unknown as Parameters<typeof HufPriceField>[0]
    expect(renderToStaticMarkup(createElement(HufPriceField, withWidth))).toContain(
      'style="--field-width:50%"',
    )
    const locked = renderToStaticMarkup(
      createElement(HufPriceField, { ...priceProps, readOnly: true }),
    )
    expect(locked).toContain('class="field-type number read-only"')
    expect(locked).toContain('disabled=""')
  })

  it('új akciós ár: a bekapcsolt rendes árhoz mér, és azt nevezi meg', () => {
    form.fields.priceInHUF = { value: 79_500, initialValue: 79_500 }
    form.fields.priceInHUFEnabled = { value: true }
    form.fields.promoPriceHuf = { value: 19_900, initialValue: null }
    const html = renderToStaticMarkup(createElement(HufPriceField, promoProps))
    expect(html).toContain(priceDropWarning('akcios', 19_900, 79_500, 'rendes'))
    expect(html).toContain('mint az eddigi ár (')
    expect(html).toContain(priceDropConfirmLabel('akcios', 19_900))
  })
})

describe('derivePriceDropPrompt és clientPriceReference (tiszta logika)', () => {
  it('a hivatkozás a betöltött érték, akciós árnál ennek híján a bekapcsolt rendes ár', () => {
    expect(
      clientPriceReference({
        kind: 'rendes',
        initialValue: 79_500,
        regularPrice: 1,
        regularEnabled: true,
      }),
    ).toEqual({ price: 79_500, kind: 'rendes' })
    expect(
      clientPriceReference({
        kind: 'akcios',
        initialValue: null,
        regularPrice: 79_500,
        regularEnabled: true,
      }),
    ).toEqual({ price: 79_500, kind: 'rendes' })
    expect(
      clientPriceReference({
        kind: 'akcios',
        initialValue: null,
        regularPrice: 79_500,
        regularEnabled: false,
      }),
    ).toBeNull()
    expect(
      clientPriceReference({
        kind: 'rendes',
        initialValue: null,
        regularPrice: 79_500,
        regularEnabled: true,
      }),
    ).toBeNull()
  })

  it('üres érték vagy a határon belüli ár: nincs megerősítés', () => {
    const reference = { price: 79_500, kind: 'rendes' as const }
    expect(
      derivePriceDropPrompt({ kind: 'rendes', value: null, reference, errorMessage: undefined }),
    ).toEqual({
      show: false,
      warning: null,
    })
    expect(
      derivePriceDropPrompt({ kind: 'rendes', value: 39_750, reference, errorMessage: undefined }),
    ).toEqual({ show: false, warning: null })
  })
})

describe('HufPriceField gépelés közben (happy-dom)', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  function type(value: string) {
    const input = container.querySelector('input[type="text"]') as HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    act(() => {
      setter?.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    return input
  }

  it('„79.500” gépelve 79 500 Ft kerül az űrlapba (a gyári mező 80 Ft-ot mentett)', () => {
    form.fields.priceInHUF = { value: null, initialValue: null }
    act(() => root.render(createElement(HufPriceField, priceProps)))
    type('79.500')
    expect(form.setValue).toHaveBeenLastCalledWith('priceInHUF', 79_500)
    expect(container.textContent).toContain(`Így jelenik meg: ${formatPriceHuf(79_500)}`)
    expect(form.validators.priceInHUF?.()).toBe(true)
  })

  it('tizedesvessző: az űrlap értéke nem változik, a hiba látszik, és a kliens-validátor megakasztja a mentést', () => {
    form.fields.priceInHUF = { value: 79_500, initialValue: 79_500 }
    act(() => root.render(createElement(HufPriceField, priceProps)))
    type('79,5')
    expect(form.setValue).not.toHaveBeenCalled()
    expect(container.textContent).toContain(HUF_INPUT_DECIMAL_MESSAGE)
    expect(form.validators.priceInHUF?.()).toBe(HUF_INPUT_DECIMAL_MESSAGE)
  })

  it('kiürítve az ár null lesz (nem 0)', () => {
    form.fields.priceInHUF = { value: 79_500, initialValue: 79_500 }
    act(() => root.render(createElement(HufPriceField, priceProps)))
    type('')
    expect(form.setValue).toHaveBeenLastCalledWith('priceInHUF', null)
  })

  it('a megerősítés bepipálása az adott összeget írja a megerősítés útjára', () => {
    form.fields.priceInHUF = { value: 7_950, initialValue: 79_500 }
    act(() => root.render(createElement(HufPriceField, priceProps)))
    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement
    act(() => checkbox.click())
    expect(form.setValue).toHaveBeenLastCalledWith('kcMegerositesek.priceInHUF', 7_950)
  })
})

describe('PaidCourseField: a pipa kivétele figyelmeztet és megerősítést kér', () => {
  it('fizetősként betöltött kurzus, kivett pipa: figyelmeztetés és megerősítő jelölőnégyzet', () => {
    form.fields.priceInHUFEnabled = { value: false, initialValue: true }
    const html = renderToStaticMarkup(createElement(PaidCourseField, paidProps))
    expect(html).toContain('gyari-pipa')
    expect(html).toContain(FREE_COURSE_WARNING)
    expect(html).toContain(FREE_COURSE_CONFIRM_LABEL)
    expect(html).toContain('role="status"')
    expect(html).toContain('flex:1 1 100%')
  })

  it('bent lévő pipa és eleve ingyenes kurzus: nincs figyelmeztetés', () => {
    form.fields.priceInHUFEnabled = { value: true, initialValue: true }
    expect(renderToStaticMarkup(createElement(PaidCourseField, paidProps))).not.toContain(
      FREE_COURSE_WARNING,
    )
    form.fields.priceInHUFEnabled = { value: false, initialValue: false }
    expect(renderToStaticMarkup(createElement(PaidCourseField, paidProps))).not.toContain(
      FREE_COURSE_WARNING,
    )
  })

  it('a mentés hibaüzenete (beállítatlan kezdőérték mellett) is előhozza a megerősítést', () => {
    form.fields.priceInHUFEnabled = {
      value: false,
      initialValue: null,
      errorMessage: freeCourseGuardMessage(true),
    }
    expect(renderToStaticMarkup(createElement(PaidCourseField, paidProps))).toContain(
      FREE_COURSE_CONFIRM_LABEL,
    )
  })

  it('a megerősítés bepipálása a freeCourse jelzőt írja, újabb kattintás törli', () => {
    form.fields.priceInHUFEnabled = { value: false, initialValue: true }
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    act(() => root.render(createElement(PaidCourseField, paidProps)))
    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement
    act(() => checkbox.click())
    expect(form.setValue).toHaveBeenLastCalledWith('kcMegerositesek.freeCourse', true)
    form.fields['kcMegerositesek.freeCourse'] = { value: true }
    act(() => root.render(createElement(PaidCourseField, { ...paidProps })))
    act(() => (container.querySelector('input[type="checkbox"]') as HTMLInputElement).click())
    expect(form.setValue).toHaveBeenLastCalledWith('kcMegerositesek.freeCourse', null)
    act(() => root.unmount())
    container.remove()
  })
})

describe('A lap teteje (CourseVisibilityNotice): az ingyenes kurzus ki van mondva', () => {
  it('kivett pipánál semleges sáv jelzi, hogy a kurzus ingyenes', () => {
    form.fields.status = { value: 'published' }
    form.fields.priceInHUFEnabled = { value: false }
    const html = renderToStaticMarkup(createElement(CourseVisibilityNotice))
    expect(html).toContain(FREE_COURSE_NOTICE_TITLE)
    expect(html).toContain('Bárki megkapja')
    expect(html.match(/role="status"/g)).toHaveLength(2)
  })

  it('fizetős vagy beállítatlan pipánál nincs ingyenes-sáv', () => {
    form.fields.status = { value: 'published' }
    for (const value of [true, null, undefined]) {
      form.fields.priceInHUFEnabled = { value }
      expect(renderToStaticMarkup(createElement(CourseVisibilityNotice))).not.toContain(
        FREE_COURSE_NOTICE_TITLE,
      )
    }
  })
})

describe('Az akció állapota: a hiányzó utolsó nap jegyzete (a-cms-9)', () => {
  it('bekapcsolt akció vég nélkül: jegyzet; véggel vagy kikapcsolva: nincs', () => {
    expect(promoEndNote({ promoEnabled: true, promoEnd: null })).toBe(PROMO_END_MISSING_NOTE)
    expect(promoEndNote({ promoEnabled: true })).toBe(PROMO_END_MISSING_NOTE)
    expect(promoEndNote({ promoEnabled: true, promoEnd: '2026-10-31T12:00:00.000Z' })).toBeNull()
    expect(promoEndNote({ promoEnabled: false, promoEnd: null })).toBeNull()
  })

  it('a nézet a jegyzetet a figyelmeztető dobozban mutatja; jegyzet nélkül nincs doboz', () => {
    const status = {
      message: 'Az akció most él, és nincs megadva a vége.',
      warning: null,
      reason: null,
    }
    const withNote = renderToStaticMarkup(
      createElement(CoursePromoStatusView, { status, endNote: PROMO_END_MISSING_NOTE }),
    )
    expect(withNote).toContain('Hiányzik az akció utolsó napja')
    expect(withNote).toContain(PROMO_END_MISSING_NOTE)
    expect(withNote.match(/role="status"/g)).toHaveLength(1)
    expect(renderToStaticMarkup(createElement(CoursePromoStatusView, { status }))).not.toContain(
      'kc-admin-notice',
    )
  })

  it('a konténer az űrlapból számol: az élő 4. kurzus vég nélküli akciójánál megjelenik', () => {
    form.fields.promoEnabled = { value: true }
    form.fields.promoEnd = { value: null }
    form.fields.promoPriceHuf = { value: 39_500 }
    form.fields.priceInHUF = { value: 79_500 }
    form.fields.priceInHUFEnabled = { value: true }
    form.fields.status = { value: 'published' }
    expect(renderToStaticMarkup(createElement(CoursePromoStatus))).toContain(PROMO_END_MISSING_NOTE)
  })

  it('a felületi szövegekben nincs gondolatjel, ASCII idézőjel, verzál szó vagy „vevő”', () => {
    for (const text of [
      FREE_COURSE_WARNING,
      FREE_COURSE_CONFIRM_LABEL,
      PROMO_END_MISSING_NOTE,
      priceDropWarning('akcios', 19_900, 79_500, 'rendes'),
      priceDropConfirmLabel('rendes', 7_950),
    ]) {
      expect(text).not.toMatch(/[–—"]/)
      expect(text).not.toMatch(/(?<![\p{L}])[A-ZÁÉÍÓÖŐÚÜŰ]{2,}(?![\p{L}])/u)
      expect(text).not.toContain('vevő')
    }
  })
})
