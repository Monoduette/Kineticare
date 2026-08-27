import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CourseBuybox } from '../components/courses/CourseBuybox'
import {
  FreeCourseRequestForm,
  FreeCourseSuccessView,
} from '../components/courses/FreeCourseRequestForm'
import { CTA_PROGRESS_LABELS, CTA_VOCABULARY, ctaLabel } from '../lib/cta-vocabulary'
import { myCoursePlayerHref } from '../lib/courses'
import {
  CONTACT_PATH,
  FREE_COURSE_BLOCKED_TITLE,
  FREE_COURSE_INTRO,
  FREE_COURSE_LIBRARY_TITLE,
  FREE_COURSE_NO_EMAIL_TITLE,
  FREE_COURSE_SUBMIT_LABEL,
  FREE_COURSE_SUCCESS_TITLE,
  PRIVACY_POLICY_PATH,
  resolveFreeCourseSuccessKind,
} from '../lib/free-course/ui-text'
import type { Product } from '../payload-types'

/**
 * Az INGYENES kurzus igénylő űrlapjának FELÜLETI szerződése
 * (renderToStaticMarkup, jsdom nélkül — a newsletter-ui.test.tsx mintája).
 *
 * Amit ez a réteg őriz:
 *  - a gomb felirata a CTA-SZÓTÁRBÓL jön (§3.2 #3), nem kézzel írt szöveg;
 *  - minden mezőnek van labelje, és a label az inputra mutat (WCAG 3.3.2);
 *  - a hozzájárulás NINCS előpipálva, és az /adatvedelem oldalra linkel;
 *  - egészségi állapotra vonatkozó mezőt NEM kérünk;
 *  - a honeypot rejtett ÉS kiesik a billentyű-sorrendből;
 *  - a vevői szövegben nincs töltelék gondolatjel (tulajdonosi kikötés);
 *  - a vásárlódoboz az INGYENES ágon az űrlapot mutatja a link-CTA helyett,
 *    a FIZETŐS ágon viszont bitre a korábbi „Megveszem" gombot.
 *
 * HÁLÓZAT: a globális fetch hangosan dobó mock (CLAUDE.md 15. tanulság).
 */

vi.stubGlobal('fetch', () => {
  throw new Error('A tesztből SOSEM mehet ki valódi hálózati hívás.')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function renderForm(overrides: Record<string, unknown> = {}): string {
  return renderToStaticMarkup(
    createElement(FreeCourseRequestForm, {
      courseTitle: 'SOS KézRelax villámkurzus',
      id: 'kurzus-vasarlas-gomb',
      productId: 2,
      turnstileSiteKey: null,
      ...overrides,
    }),
  )
}

const html = renderForm()

describe('FreeCourseRequestForm — az igénylő űrlap kezdő állapota', () => {
  it('a gomb felirata a régi oldal mért, bevált szava: E/1, ige + tárgy', () => {
    // A régi www.kineticare.hu ingyenes útján a beküldő gomb `KÉREM`, az oda
    // vezető gombok `KÉREM A VILLÁMKURZUST` / `KÉREM A HOZZÁFÉRÉST` voltak
    // (docs/regi-oldal-osszehasonlitas.md §3.1), és a tulajdonos szó szerint
    // ezt kérte. A felirat E/1, három szó, gondolatjel nélkül.
    expect(FREE_COURSE_SUBMIT_LABEL).toBe('Kérem a kurzust')
    expect(html).toContain(FREE_COURSE_SUBMIT_LABEL)
    // A gomb BEKÜLDŐ gomb, nem link: a cselekvés nem navigáció.
    expect(html).toContain('type="submit"')
    // A lap egyetlen elsődleges cselekvése (nincs mellette vásárlás).
    expect(html).toContain('kc-button--primary')
  })

  it('a felirat a NORMATÍV CTA-szótárból jön, pontosan egy sorból', () => {
    // Vezetői döntés (2026-08-17): a felirat felkerült a §3.2 #26 sorába, és a
    // `FREE_COURSE_SUBMIT_LABEL` onnan olvassa. Ez a teszt azt őrzi, hogy a
    // felirat NE csússzon vissza saját literálba: egyetlen szótári sor adja,
    // pontosan a `free-course-request` cselekvésé (C-1, WCAG 2.2 3.2.4).
    const egyezok = CTA_VOCABULARY.filter((entry) => entry.label === FREE_COURSE_SUBMIT_LABEL)
    expect(egyezok).toHaveLength(1)
    expect(egyezok[0].action).toBe('free-course-request')
    expect(egyezok[0].person).toBe('e1')
    expect(egyezok[0].weight).toBe('primary')

    // Ugyanazok a mechanikus ellenőrzések, amiket a G-UI1 őr a szótárra futtat.
    expect(FREE_COURSE_SUBMIT_LABEL).not.toMatch(/[–—]/u)
    expect(FREE_COURSE_SUBMIT_LABEL.split(/\s+/u).length).toBeLessThanOrEqual(4)
    expect(FREE_COURSE_SUBMIT_LABEL.toLocaleLowerCase('hu').startsWith('tovább')).toBe(false)
    expect(FREE_COURSE_SUBMIT_LABEL.charAt(0)).toBe(
      FREE_COURSE_SUBMIT_LABEL.charAt(0).toLocaleUpperCase('hu'),
    )
    expect(FREE_COURSE_SUBMIT_LABEL).not.toBe(FREE_COURSE_SUBMIT_LABEL.toLocaleUpperCase('hu'))
    // Az E/1-es „Kérem" ige, NEM a §2.7-ben tiltott udvariaskodó „Kérjük".
    expect(FREE_COURSE_SUBMIT_LABEL).not.toContain('Kérjük')
  })

  it('a folyamatban-felirat a ZÁRT L-1 készletből jön', () => {
    expect(CTA_PROGRESS_LABELS.send).toBe('Küldés…')
  })

  it('mindkét mezőnek van labelje, és a label az inputra mutat', () => {
    expect(html).toContain('for="kc-field-freeCourseName"')
    expect(html).toContain('id="kc-field-freeCourseName"')
    expect(html).toContain('for="kc-field-freeCourseEmail"')
    expect(html).toContain('id="kc-field-freeCourseEmail"')
    expect(html).toContain('autoComplete="name"')
    expect(html).toContain('autoComplete="email"')
    expect(html).toContain('type="email"')
  })

  it('a hozzájárulás NINCS előpipálva, kötelező, és az /adatvedelem oldalra linkel', () => {
    expect(html).toContain('id="kc-free-course-consent"')
    expect(html).toContain('type="checkbox"')
    expect(html).not.toContain('checked=""')
    expect(html).toContain(`href="${PRIVACY_POLICY_PATH}"`)
    expect(html).toContain('Adatkezelési és adatvédelmi szabályzat')
  })

  it('EGÉSZSÉGI ÁLLAPOTRA vonatkozó adatot nem kér, és ezt ki is mondja', () => {
    expect(html).toContain('Egészségi állapotra vonatkozó adatot nem kérünk.')
    // A panasz/diagnózis-jellegű mezőnevek egyike sem szerepelhet.
    expect(html).not.toMatch(/name="(panasz|reason|diagnozis|egeszseg)"/iu)
    expect(html).not.toContain('<textarea')
  })

  it('a honeypot rejtett és kiesik a billentyű-sorrendből', () => {
    expect(html).toContain('kc-free-course__hp')
    expect(html).toContain('name="website"')
    expect(html).toContain('tabindex="-1"')
    expect(html).toContain('aria-hidden="true"')
  })

  it('a bevezető megmondja ELŐRE, mi történik a beküldés után', () => {
    expect(html).toContain('A kurzus ingyenes, fizetned nem kell érte.')
    expect(html).toContain(FREE_COURSE_INTRO)
    expect(html).not.toContain('a belépő linket pedig e-mailben küldjük')
  })

  it('a látható szövegben nincs töltelék gondolatjel', () => {
    const lathato = html.replace(/<[^>]*>/gu, ' ')
    expect(lathato).not.toMatch(/[–—]/u)
  })

  it('Turnstile-kulcs nélkül NINCS widget (nincs hamis biztonságérzet)', () => {
    expect(html).not.toContain('kc-free-course__turnstile')
    const kulccsal = renderForm({ turnstileSiteKey: '0x-teszt-site-key' })
    expect(kulccsal).toContain('kc-free-course__turnstile')
  })

  it('bejelentkezett látogatónál előtölti a nevet és a címet (nem kell újra begépelni)', () => {
    const elotoltve = renderForm({ defaultName: 'Kis Piroska', defaultEmail: 'piroska@pelda.hu' })
    expect(elotoltve).toContain('value="Kis Piroska"')
    expect(elotoltve).toContain('value="piroska@pelda.hu"')
  })

  it('a beküldés előtt NINCS élő hibaüzenet a lapon (nem szidjuk le előre)', () => {
    expect(html).not.toContain('kc-free-course__summary')
    expect(html).not.toContain('role="alert"')
  })
})

// ---------------------------------------------------------------------------
// A vásárlódoboz bekötése
// ---------------------------------------------------------------------------

const paidProduct = {
  id: 5,
  status: 'published',
  priceInHUF: 79500,
  priceInHUFEnabled: true,
} as Pick<Product, 'id' | 'status' | 'priceInHUF' | 'priceInHUFEnabled'>

const freeProduct = {
  id: 2,
  status: 'published',
  priceInHUF: null,
  priceInHUFEnabled: false,
} as Pick<Product, 'id' | 'status' | 'priceInHUF' | 'priceInHUFEnabled'>

function renderBuybox(overrides: Record<string, unknown> = {}): string {
  return renderToStaticMarkup(
    createElement(CourseBuybox, {
      audienceLabel: 'Otthoni gyakorlóknak',
      categoryLabel: 'Kézrehabilitáció',
      ctaId: 'kurzus-vasarlas-gomb',
      guaranteeLabel: null,
      hasPurchased: false,
      highlights: ['Rövid, otthon végezhető gyakorlatok'],
      id: 'kurzus-vasarlas',
      lead: 'Öt perc, ami oldja a kézfeszülést.',
      priceBadge: 'price',
      priceHuf: 79500,
      product: paidProduct,
      secondaryHref: '#kinek-valo',
      secondaryLabel: 'Kinek való?',
      title: 'Otthoni KézRehab Program',
      ...overrides,
    }),
  )
}

describe('CourseBuybox — a CTA-terület az ingyenes és a fizetős ágon', () => {
  it('FIZETŐS kurzuson a doboz VÁLTOZATLAN: a vásárló gomb áll a CTA helyén', () => {
    const paid = renderBuybox()
    expect(paid).toContain('Megveszem')
    expect(paid).toContain('kc-course-cta')
    expect(paid).not.toContain('kc-free-course')
  })

  it('INGYENES kurzuson a CTA helyén az igénylő űrlap áll, link-CTA nélkül', () => {
    const free = renderBuybox({
      priceBadge: 'free',
      priceHuf: null,
      product: freeProduct,
      title: 'SOS KézRelax villámkurzus',
      ctaSlot: createElement(FreeCourseRequestForm, {
        courseTitle: 'SOS KézRelax villámkurzus',
        id: 'kurzus-vasarlas-gomb',
        productId: 2,
        turnstileSiteKey: null,
      }),
    })

    // Az „Ingyenes" ár-címke MEGMARAD a gomb fölött (B6.2).
    expect(free).toContain('Ingyenes')
    expect(free).toContain('kc-free-course')
    expect(free).toContain(FREE_COURSE_SUBMIT_LABEL)
    // A régi, zsákutcás link-CTA eltűnt: nincs több „azonnal eléred" ígéret,
    // és nincs /kurzusaim link a be nem jelentkezett látogatónak.
    expect(free).not.toContain('azonnal eléred')
    expect(free).not.toContain('href="/kurzusaim"')
  })

  it('az INGYENES úton SEHOL nincs ár és nincs pénztár', () => {
    const free = renderBuybox({
      priceBadge: 'free',
      priceHuf: null,
      product: freeProduct,
      title: 'SOS KézRelax villámkurzus',
      ctaSlot: createElement(FreeCourseRequestForm, {
        courseTitle: 'SOS KézRelax villámkurzus',
        id: 'kurzus-vasarlas-gomb',
        productId: 2,
        turnstileSiteKey: null,
      }),
    })
    // Sem forintösszeg, sem pénztár-hivatkozás, sem vásárló felirat.
    expect(free).not.toMatch(/\d\s*Ft/u)
    expect(free).not.toContain('/penztar')
    expect(free).not.toContain('Megveszem')
    expect(free).not.toContain('egyszeri díj')
  })

  it('a doboz elemei megmaradnak az űrlap mellett (cím, lead, előnyök)', () => {
    const free = renderBuybox({
      priceBadge: 'free',
      priceHuf: null,
      product: freeProduct,
      ctaSlot: createElement(FreeCourseRequestForm, {
        courseTitle: 'SOS KézRelax villámkurzus',
        productId: 2,
        turnstileSiteKey: null,
      }),
    })
    expect(free).toContain('Öt perc, ami oldja a kézfeszülést.')
    expect(free).toContain('Rövid, otthon végezhető gyakorlatok')
  })
})

describe('a sikeres beküldés után megjelenő szöveg', () => {
  it('a kapcsolati út a levél nélküli ágon él (a látogató nem marad zsákutcában)', () => {
    expect(CONTACT_PATH).toBe('/kapcsolat')
  })

  it('resolveFreeCourseSuccessKind: a next felülírja az emailSent-et', () => {
    expect(resolveFreeCourseSuccessKind({ next: 'library', emailSent: false })).toBe('library')
    expect(resolveFreeCourseSuccessKind({ next: 'blocked', emailSent: true })).toBe('blocked')
    expect(resolveFreeCourseSuccessKind({ emailSent: true })).toBe('email')
    expect(resolveFreeCourseSuccessKind({ emailSent: false })).toBe('no-email')
  })

  it('library: a kurzus lejátszójára visz, nem hazudik belépő linket', () => {
    const html = renderToStaticMarkup(
      createElement(FreeCourseSuccessView, { emailSent: false, next: 'library', productId: 2 }),
    )
    expect(html).toContain(FREE_COURSE_LIBRARY_TITLE)
    expect(html).toContain(myCoursePlayerHref(2))
    expect(html).toContain(ctaLabel('course-start'))
    expect(html).not.toContain(FREE_COURSE_SUCCESS_TITLE)
  })

  it('blocked: figyelmeztet, és a kapcsolatra visz', () => {
    const html = renderToStaticMarkup(
      createElement(FreeCourseSuccessView, { emailSent: false, next: 'blocked', productId: 2 }),
    )
    expect(html).toContain(FREE_COURSE_BLOCKED_TITLE)
    expect(html).toContain(CONTACT_PATH)
    expect(html).toContain('kc-free-course__success--figyelem')
  })

  it('email: postaláda, vendégnél szándékosan fedi az új és a meglévő címet', () => {
    const html = renderToStaticMarkup(
      createElement(FreeCourseSuccessView, { emailSent: true, productId: 2 }),
    )
    expect(html).toContain(FREE_COURSE_SUCCESS_TITLE)
    expect(html).toContain('Ha ez a cím új')
    expect(html).not.toContain(CONTACT_PATH)
  })

  it('no-email: nem állítja, hogy a hozzáférés megvan', () => {
    const html = renderToStaticMarkup(
      createElement(FreeCourseSuccessView, { emailSent: false, productId: 2 }),
    )
    expect(html).toContain(FREE_COURSE_NO_EMAIL_TITLE)
    expect(html).not.toContain(FREE_COURSE_LIBRARY_TITLE)
    expect(html).toContain(CONTACT_PATH)
  })
})
