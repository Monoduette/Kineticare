import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it, vi } from 'vitest'

/**
 * ŐR — A JOGI LINKEK FELIRATA = A JOGI OLDAL CÍME (modul-térkép H18/A10).
 *
 * A három jogi oldal (ÁSZF, adatkezelés, impresszum) címe egy helyen él:
 * src/lib/legal-content.ts `JOGI_OLDALAK[].cim` (ez lesz a lap H1-e és a
 * böngészőfül címe). A rájuk mutató link-feliratok kódban állnak, mert
 * webcímhez kötött, állandó elemek. Ez az őr köti őket a címhez, hogy a
 * link ugyanazzal a névvel vigyen oda, amit a lap H1-e mond (WCAG 2.2
 * SC 2.4.4 Link Purpose és SC 3.2.4 Consistent Identification:
 * https://www.w3.org/WAI/WCAG22/Understanding/link-purpose-in-context.html,
 * https://www.w3.org/WAI/WCAG22/Understanding/consistent-identification.html;
 * GOV.UK Design System, Links: a link szövege mondja meg, hova visz,
 * https://design-system.service.gov.uk/styles/links/).
 *
 * A kódpéldányok: a lábléc (FOOTER_LEGAL_LINKS), a global-not-found
 * LEGAL_LINKS listája (forrás-olvasással: a lap szándékosan nem importálja a
 * láblécet), a pénztár elfogadó mondatának két linkje (forrás-olvasással a
 * CheckoutForm.tsx-ből, az érték a form-submission.ts szövegéből), a
 * CheckoutForm.tsx minden literál jogi linkje (`href="/aszf"` stb., például
 * az Elállási jog bevezetője; forrás-olvasással, betűre) és az ingyenes
 * kurzus hozzájárulási mondatának adatkezelési linkje.
 *
 * A pénztár mondata („Elfogadom az Általános szerződési feltételeket”)
 * tárgyesetben ragozza a címet; ott a felirat = a cím + tárgyrag (-t, -at,
 * -et, -ot, -öt), minden más betűre egyezik.
 */

vi.mock('../components/layout/NewsletterSignup', () => ({ NewsletterSignup: () => null }))

const { JOGI_OLDALAK } = await import('../lib/legal-content')
const { FOOTER_LEGAL_LINKS } = await import('../components/layout/Footer')
const { CHECKOUT_TERMS_LABEL, TERMS_ASZF_PATH, TERMS_PRIVACY_PATH } =
  await import('../lib/checkout/form-submission')
const { FREE_COURSE_CONSENT_TEXT, PRIVACY_POLICY_PATH } = await import('../lib/free-course/ui-text')

const olvas = (ut: string): string =>
  readFileSync(fileURLToPath(new URL(ut, import.meta.url)), 'utf8')

/** A jogi oldal címe webcím (`/aszf`) szerint. */
function cimWebcimre(href: string): string {
  const oldal = JOGI_OLDALAK.find((jelolt) => `/${jelolt.slug}` === href)
  if (!oldal) throw new Error(`Nincs jogi oldal ezzel a webcímmel: ${href}`)
  return oldal.cim
}

/** Eltérésnél magyar üzenet: a fájl és a két szöveg. */
function uzenet(fajl: string, href: string, felirat: string): string {
  return `${fajl}: a(z) ${href} link felirata „${felirat}”, a jogi oldal címe (src/lib/legal-content.ts) „${cimWebcimre(href)}”. A kettőnek egyeznie kell.`
}

/** A tárgyeset ragjai, amelyekkel a felirat a címből képződhet. */
const TARGYRAGOK = ['t', 'at', 'et', 'ot', 'öt'] as const

function targyesetu(felirat: string, cim: string): boolean {
  return (
    felirat.startsWith(cim) && (TARGYRAGOK as readonly string[]).includes(felirat.slice(cim.length))
  )
}

describe('jogi linkfeliratok = a jogi oldalak címe', () => {
  it('a három jogi oldal webcíme a lábléc linkjeivel azonos', () => {
    expect(JOGI_OLDALAK.map((oldal) => `/${oldal.slug}`).sort()).toEqual(
      FOOTER_LEGAL_LINKS.map((link) => link.href).sort(),
    )
  })

  it.each(FOOTER_LEGAL_LINKS.map((link) => [link.href, link.label] as const))(
    'lábléc: %s',
    (href, label) => {
      expect(label, uzenet('src/components/layout/Footer.tsx', href, label)).toBe(cimWebcimre(href))
    },
  )

  it('global-not-found: a LEGAL_LINKS minden felirata a jogi oldal címe', () => {
    const forras = olvas('../app/global-not-found.tsx')
    const lista = /const LEGAL_LINKS = \[([\s\S]*?)\] as const/.exec(forras)?.[1]
    expect(lista, 'src/app/global-not-found.tsx: nem található a LEGAL_LINKS lista').toBeDefined()
    const parok = [...(lista ?? '').matchAll(/\{\s*href:\s*'([^']+)',\s*label:\s*'([^']+)'\s*\}/g)]
    expect(parok.map((par) => par[1]).sort()).toEqual(JOGI_OLDALAK.map((o) => `/${o.slug}`).sort())
    for (const [, href, label] of parok) {
      expect(label, uzenet('src/app/global-not-found.tsx', href!, label!)).toBe(cimWebcimre(href!))
    }
  })

  it('pénztár: az ÁSZF és az adatkezelési link felirata a cím tárgyesetben', () => {
    const forras = olvas('../components/checkout/CheckoutForm.tsx')
    const linkek: [string, string][] = [
      ['TERMS_ASZF_PATH', TERMS_ASZF_PATH],
      ['TERMS_PRIVACY_PATH', TERMS_PRIVACY_PATH],
    ]
    for (const [konstans, href] of linkek) {
      const kulcs = new RegExp(
        `<a href=\\{${konstans}\\}[^>]*>\\s*\\{CHECKOUT_TERMS_LABEL\\.(\\w+)\\}`,
      ).exec(forras)?.[1]
      expect(
        kulcs,
        `src/components/checkout/CheckoutForm.tsx: a(z) ${href} link felirata nem a CHECKOUT_TERMS_LABEL-ből jön`,
      ).toBeDefined()
      const felirat = String(CHECKOUT_TERMS_LABEL[kulcs as keyof typeof CHECKOUT_TERMS_LABEL])
      expect(
        targyesetu(felirat, cimWebcimre(href)),
        uzenet(
          'src/components/checkout/CheckoutForm.tsx (src/lib/checkout/form-submission.ts)',
          href,
          felirat,
        ),
      ).toBe(true)
    }
  })

  it('pénztár: minden literál jogi link felirata betűre a jogi oldal címe', () => {
    const forras = olvas('../components/checkout/CheckoutForm.tsx')
    // A literál `href="/aszf"` stb. linkek (pl. az Elállási jog bevezetője).
    // A JSX a sortörést és a behúzást egy szóközzé vonja össze, ezért a
    // felirat szóköz-normalizálva, egyébként betűre vetendő össze a címmel.
    // Ha a linkszövegben kifejezés (`{…}`) vagy elem áll, az is eltérésként
    // bukik, így egy literál link sem csúszhat át ellenőrzés nélkül.
    const literalok = [
      ...forras.matchAll(
        /<a\b[^>]*\bhref="(\/(?:aszf|adatvedelem|impresszum))"[^>]*>([\s\S]*?)<\/a>/g,
      ),
    ]
    expect(
      literalok.map((talalat) => talalat[1]),
      'src/components/checkout/CheckoutForm.tsx: nem található az Elállási jog bevezetőjének /aszf linkje',
    ).toContain('/aszf')
    for (const [, href, nyers] of literalok) {
      const felirat = (nyers ?? '').replace(/\s+/g, ' ').trim()
      expect(felirat, uzenet('src/components/checkout/CheckoutForm.tsx', href!, felirat)).toBe(
        cimWebcimre(href!),
      )
    }
  })

  it('ingyenes kurzus: a hozzájárulás adatkezelési linkje a cím', () => {
    expect(PRIVACY_POLICY_PATH).toBe('/adatvedelem')
    expect(
      FREE_COURSE_CONSENT_TEXT.linkLabel,
      uzenet(
        'src/lib/free-course/ui-text.ts',
        PRIVACY_POLICY_PATH,
        FREE_COURSE_CONSENT_TEXT.linkLabel,
      ),
    ).toBe(cimWebcimre(PRIVACY_POLICY_PATH))
  })

  it('az őr maga is bukik eltérésnél (a tárgyrag-szabály nem enged mást)', () => {
    expect(targyesetu('Általános szerződési feltételeket', 'Általános szerződési feltételek')).toBe(
      true,
    )
    expect(targyesetu('ÁSZF-et', 'Általános szerződési feltételek')).toBe(false)
    expect(
      targyesetu('Általános szerződési feltételek listáját', 'Általános szerződési feltételek'),
    ).toBe(false)
  })
})
