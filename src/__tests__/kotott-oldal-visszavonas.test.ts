import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { hu } from '@payloadcms/translations/languages/hu'
import { deepMergeSimple } from 'payload/shared'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * H48/6: a kódhoz kötött oldalak figyelmeztetése a közzététel visszavonásának
 * hatásáról (src/lib/admin/kotott-cimek.ts `visszavonas`, megjelenítés:
 * src/components/admin/KotottWebcimNotice.tsx).
 *
 * - minden kötött webcímnek van egy nem üres, ponttal záruló, gondolatjel
 *   (U+2013, U+2014) nélküli visszavonás-mondata;
 * - a mondat a menüpont nevét betűre idézi, a TÉNYLEGESEN érvényes magyar
 *   fordításból (a Payload hu nyelvfájlja, rá fésülve a hu-forditas.ts);
 * - minden állítás a forrássorhoz kötve: ha a gazda (route, seed, cms.ts)
 *   változik, a teszt bukik, és a mondatot újra kell mérni;
 * - a figyelmeztetés nyugalmi állapotban külön bekezdésként, átíráskor a
 *   meglévő figyelmeztetés alatt mutatja, és csak közzétett dokumentumnál.
 *
 * DOM és hálózat nélkül fut (a fetch hangosan dobó csonk).
 */

interface MockState {
  fields: Record<string, { value: unknown; initialValue?: unknown }>
  doc: { id?: number | string; collectionSlug?: string; hasPublishedDoc: boolean }
}

let allapot: MockState = {
  fields: {},
  doc: { id: 9, collectionSlug: 'pages', hasPublishedDoc: true },
}

vi.mock('@payloadcms/ui', () => ({
  useFormFields: (selector: (state: [Record<string, { value: unknown }>, () => void]) => unknown) =>
    selector([allapot.fields, () => undefined]),
  useDocumentInfo: () => ({
    ...allapot.doc,
    unpublishedVersionCount: 0,
    versionCount: 1,
    lastUpdateTime: 0,
  }),
  useConfig: () => ({ config: { routes: { admin: '/admin', api: '/api' } } }),
  useForm: () => ({ setModified: () => undefined }),
  useTranslation: () => ({
    t: (key: string) => ({ 'version:publishChanges': 'Módosítások közzététele' })[key] ?? key,
  }),
  Button: (props: { children?: ReactNode; className?: string; type?: string }) =>
    createElement('button', { className: props.className, type: props.type }, props.children),
}))

beforeEach(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('A tesztből SOSEM mehet ki valódi hálózati hívás.')
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  allapot = { fields: {}, doc: { id: 9, collectionSlug: 'pages', hasPublishedDoc: true } }
})

const { HU_ADMIN_FORDITAS } = await import('../lib/admin/hu-forditas')
const { HUB_OLDALAK } = await import('../lib/tudastar/hub-oldalak')
const { JOGI_WEBCIMEK, VISSZAVONAS_GOMB, kotottWebcim, kotottWebcimek } =
  await import('../lib/admin/kotott-cimek')
const notice = await import('../components/admin/KotottWebcimNotice')

const forras = (ut: string): string =>
  readFileSync(fileURLToPath(new URL(ut, import.meta.url)), 'utf8')

const core = (ut: string): string =>
  readFileSync(fileURLToPath(new URL(`../../node_modules/${ut}`, import.meta.url)), 'utf8')

/** A felületen ténylegesen érvényes magyar fordítás (a huAdminForditasPlugin fésülése szerint). */
function ervenyesForditas(): Record<string, Record<string, unknown>> {
  return deepMergeSimple<Record<string, Record<string, unknown>>>(
    structuredClone(hu.translations) as Record<string, Record<string, unknown>>,
    structuredClone(HU_ADMIN_FORDITAS) as Record<string, Record<string, unknown>>,
  )
}

function visszavonas(gyujtemeny: 'pages' | 'posts', slug: string): string {
  const k = kotottWebcim(gyujtemeny, slug)
  if (k === null) throw new Error(`nem kötött: ${gyujtemeny}/${slug}`)
  return k.visszavonas
}

const OSSZES: readonly (readonly ['pages' | 'posts', string])[] = [
  ...kotottWebcimek('pages').map((slug) => ['pages', slug] as const),
  ...kotottWebcimek('posts').map((slug) => ['posts', slug] as const),
]

describe('a menüpont neve betűre a magyar fordításból', () => {
  it('a UnpublishButton a version:unpublish kulcsot mutatja, ennek érvényes értéke a VISSZAVONAS_GOMB', () => {
    const gomb = core('@payloadcms/ui/dist/elements/UnpublishButton/index.js')
    expect(gomb).toContain("children: labelProp || t('version:unpublish')")
    const ervenyes = ervenyesForditas().version?.unpublish
    expect(ervenyes).toBe(VISSZAVONAS_GOMB)
    expect(VISSZAVONAS_GOMB).toBe('Közzététel visszavonása')
  })

  it('a projekt nem ad saját feliratot a menüpontnak (a labelProp üres)', () => {
    for (const ut of [
      '../collections/Pages.ts',
      '../collections/Posts.ts',
      '../payload.config.ts',
    ]) {
      expect(forras(ut), ut).not.toContain('UnpublishButton')
    }
  })
})

describe('minden kötött webcímnek van visszavonás-mondata', () => {
  it('14 oldal és 10 blogbejegyzés', () => {
    expect(OSSZES).toHaveLength(24)
  })

  it.each(OSSZES)(
    '%s / %s: nem üres, ponttal zárul, gondolatjel nélkül, a menüpont nevével',
    (gy, slug) => {
      const mondat = visszavonas(gy, slug)
      const gombnev = ervenyesForditas().version?.unpublish
      expect(typeof gombnev).toBe('string')
      expect(mondat.trim().length).toBeGreaterThan(0)
      expect(mondat.endsWith('.')).toBe(true)
      expect(mondat).not.toMatch(/[–—]/)
      expect(mondat).toContain(`„${String(gombnev)}”`)
      // Egy mondat: a záró ponton kívül nincs mondatvég.
      expect(mondat.slice(0, -1)).not.toMatch(/[.!?](\s|$)/)
      expect(mondat).not.toMatch(/404|horgony|\bslug/i)
    },
  )
})

describe('az állítások a forrássorhoz kötve', () => {
  it('a visszavonás a fő dokumentum állapotát írja, a weboldal csak közzétettet olvas', () => {
    const gomb = core('@payloadcms/ui/dist/elements/UnpublishButton/index.js')
    // A PATCH `draft` kapcsoló nélkül megy, a törzs `_status: 'draft'`.
    expect(gomb).toMatch(/method = 'patch';/)
    expect(gomb).toMatch(/body: JSON\.stringify\(\{\s*_status: 'draft'\s*\}\)/)
    expect(gomb).not.toMatch(/draft: true/)
    expect(forras('../lib/publish-status.ts')).toContain(
      'data.status = resolveDraftStatus(data, originalDoc)',
    )
    const cms = forras('../lib/cms.ts')
    expect(cms).toContain(
      "export const PUBLISHED_WHERE = { status: { equals: 'published' } } as const",
    )
    expect(cms).toMatch(
      /export async function getHomePage[\s\S]*?where: \{ slug: \{ equals: HOME_PAGE_SLUG \}, \.\.\.publishedWhere\(draft\) \}/,
    )
    expect(cms).toMatch(
      /export async function getPageBySlug[\s\S]*?where: \{ slug: \{ equals: slug \}, \.\.\.publishedWhere\(draft\) \}/,
    )
    expect(cms).toMatch(
      /export async function getPostBySlug[\s\S]*?where: \{ slug: \{ equals: slug \}, \.\.\.publishedWhere\(draft\) \}/,
    )
  })

  it('kezdőlap: tartalék-kezdőlap, és az induláskori ellenőrzés NEM hoz létre újat', () => {
    expect(forras('../components/content/HomeView.tsx')).toContain(
      'const layout = presentHomeLayout(home?.layout ?? [])',
    )
    // Az ensureHomeLayout állapotszűrő nélkül keres: a visszavont oldalt is megtalálja.
    const seed = forras('../lib/home-seed.ts')
    const ensure = seed.slice(seed.indexOf('export const ensureHomeLayout'))
    expect(ensure).toMatch(
      /^export const ensureHomeLayout[^\n]*\n\s*const existing = await payload\.find\(\{\s*collection: 'pages',\s*where: \{ slug: \{ equals: HOME_PAGE_SLUG \} \},\s*limit: 1,\s*overrideAccess: true,\s*\}\)/,
    )
    expect(ensure.slice(0, ensure.indexOf('if (existing.docs.length === 0)'))).not.toMatch(
      /status|draft:/,
    )
    const mondat = visszavonas('pages', 'kezdolap')
    expect(mondat).toContain('beépített tartalék-kezdőlapja jelenik meg')
    expect(mondat).toContain('új kezdőlap nem jön létre')
    // Webcímváltás után sem jön létre új kezdőlap (A8: az induláskori seed
    // csak teljesen üres Oldalak-gyűjteménynél ír), a tartalék marad.
    expect(kotottWebcim('pages', 'kezdolap')?.kovetkezmeny.join(' ')).toContain(
      'amíg a webcímet vissza nem írod',
    )
  })

  it('Kapcsolat: a /kapcsolat nem ad hibát, csak a címet rajzolja; az időpontkérő gomb ide visz', () => {
    const route = forras('../app/(frontend)/kapcsolat/page.tsx')
    expect(route).not.toContain('notFound')
    expect(route).toContain('return page?.title?.trim() || CONTACT_TITLE')
    expect(route).toMatch(/\{layout\.length > 0 \? \(\s*<RenderBlocks/)
    expect(forras('../components/content/PostCourseCta.tsx')).toContain(
      "export const APPOINTMENT_HREF = '/kapcsolat#idopontkeres'",
    )
    const mondat = visszavonas('pages', 'kapcsolat')
    expect(mondat).toContain('a /kapcsolat címen csak a „Kapcsolat” cím marad, szekciók nélkül')
    expect(mondat).toContain('időpontkérő gomb')
  })

  it('jogi oldalak és hubok: a [slug] route közzétett oldal nélkül „nem található”', () => {
    const route = forras('../app/(frontend)/[slug]/page.tsx')
    expect(route).toMatch(/const page = await pageOf\(slug, isDraft\)\s*if \(!page\) notFound\(\)/)
    for (const slug of JOGI_WEBCIMEK) {
      expect(forras('../components/layout/Footer.tsx')).toContain(`href: '/${slug}'`)
      const mondat = visszavonas('pages', slug)
      expect(mondat).toContain(`/${slug} cím „az oldal nem található” hibát ad`)
    }
    expect(forras('../components/checkout/CheckoutForm.tsx')).toContain('<a href={TERMS_ASZF_PATH}')
  })

  it('hub-oldal: a /blog/<cikk> csak közzétett hubnál irányít át, így a bejegyzés visszakerül', () => {
    const blog = forras('../app/(frontend)/blog/[slug]/page.tsx')
    expect(blog).toMatch(
      /const hub = await getPageBySlug\(hubSlug\)\s*if \(hub\) permanentRedirect\(`\/\$\{hubSlug\}`\)/,
    )
    for (const hub of HUB_OLDALAK) {
      const mondat = visszavonas('pages', hub.slug)
      expect(mondat).toContain(`/${hub.slug} cím „az oldal nem található” hibát ad`)
      expect(mondat).toContain(`újra a /blog/${hub.cikkSlug} címen jelenik meg`)
    }
  })

  it('hub-blogbejegyzés: a hub-oldal közzétett bejegyzés nélkül a saját mezőit rajzolja', () => {
    const route = forras('../app/(frontend)/[slug]/page.tsx')
    expect(route).toMatch(/const post = await hubPostOf\(hub\.cikkSlug\)\s*if \(post\) \{/)
    expect(route).toContain(
      'const hubPostOf = cache((cikkSlug: string) => getPostBySlug(cikkSlug))',
    )
    const blog = forras('../app/(frontend)/blog/[slug]/page.tsx')
    expect(blog).toMatch(
      /if \(!isDraft\) await hubraIranyit\(slug\)\s*const post = await postOf\(slug, isDraft\)\s*if \(!post\) notFound\(\)/,
    )
    for (const hub of HUB_OLDALAK) {
      const mondat = visszavonas('posts', hub.cikkSlug)
      expect(mondat).toContain(`a /blog/${hub.cikkSlug} cím nem mutatja többé a blogbejegyzést`)
      expect(mondat).toContain('az oldal saját mezői jelennek meg')
    }
  })

  it('időpontkérős (nem hub) blogbejegyzés: a /blog/<webcím> „nem található”', () => {
    for (const slug of ['peace-and-love-friss-serules', 'gipszben-a-kezed']) {
      expect(visszavonas('posts', slug)).toBe(
        `A „${VISSZAVONAS_GOMB}” után a /blog/${slug} cím „az oldal nem található” hibát ad.`,
      )
    }
    // A befagyott-vall hub-pár is: a hub mondata az igaz és bővebb.
    expect(visszavonas('posts', 'befagyott-vall')).toContain('/befagyott-vall oldalon')
  })
})

describe('megjelenítés a Webcím alatt (KotottWebcimNotice)', () => {
  const alap = {
    gyujtemeny: 'pages',
    kozzeteszGomb: 'Módosítások közzététele',
    bejelentes: '',
    onVisszaallit: () => undefined,
  }

  /** A figyelmeztetés bekezdései sorrendben. */
  function bekezdesek(html: string): string[] {
    return [...html.matchAll(/<p class="kc-admin-notice__szoveg">([^<]*)<\/p>/g)].map(
      (m) => m[1] ?? '',
    )
  }

  it('nyugalmi állapot: a mondat külön bekezdés a „mi épít rá” után', () => {
    const html = renderToStaticMarkup(
      createElement(notice.KotottWebcimNoticeView, { ...alap, mentett: 'aszf', urlapban: 'aszf' }),
    )
    const k = kotottWebcim('pages', 'aszf')
    expect(bekezdesek(html)).toEqual([...(k?.mire ?? []), k?.visszavonas])
    expect(html).not.toContain('kc-admin-notice--figyelem')
  })

  it('átírt állapot: a mondat a meglévő figyelmeztetés alatt, utolsó bekezdésként', () => {
    const html = renderToStaticMarkup(
      createElement(notice.KotottWebcimNoticeView, {
        ...alap,
        mentett: 'kapcsolat',
        urlapban: 'kapcsolat-uj',
      }),
    )
    const b = bekezdesek(html)
    expect(html).toContain('kc-admin-notice--figyelem')
    expect(b.at(-2)).toBe(
      'Az automatikus mentés csak piszkozatot ír: a weboldal a „Módosítások közzététele” gombig a régi webcímet használja.',
    )
    expect(b.at(-1)).toBe(visszavonas('pages', 'kapcsolat'))
    // A mondat a bekezdések után, a „Visszaállítom” gomb előtt áll.
    expect(html.indexOf(visszavonas('pages', 'kapcsolat'))).toBeLessThan(html.indexOf('<button'))
  })

  it('nem közzétett dokumentumnál a mondat nem látszik (a menüpont sincs ott)', () => {
    for (const urlapban of ['kezdolap', 'kezdolap-uj']) {
      const html = renderToStaticMarkup(
        createElement(notice.KotottWebcimNoticeView, {
          ...alap,
          mentett: 'kezdolap',
          urlapban,
          kozzeteve: false,
        }),
      )
      expect(html).toContain('kc-admin-notice')
      expect(html).not.toContain(VISSZAVONAS_GOMB)
    }
  })

  it('a komponens a Payload hasPublishedDoc jelzéséből dönt', () => {
    allapot = {
      fields: { slug: { value: 'kapcsolat', initialValue: 'kapcsolat' } },
      doc: { id: 5, collectionSlug: 'pages', hasPublishedDoc: true },
    }
    expect(renderToStaticMarkup(createElement(notice.KotottWebcimNotice))).toContain(
      visszavonas('pages', 'kapcsolat'),
    )
    allapot = { ...allapot, doc: { ...allapot.doc, hasPublishedDoc: false } }
    const html = renderToStaticMarkup(createElement(notice.KotottWebcimNotice))
    expect(html).toContain(notice.NE_IRD_AT)
    expect(html).not.toContain(VISSZAVONAS_GOMB)
  })

  it('a régi hívók (visszavonás-mondat nélküli kötés) változatlan szöveget kapnak', () => {
    const k = { mire: ['A.'], kovetkezmeny: ['B.'] }
    expect(notice.kotottSzoveg(k).bekezdesek).toEqual(['A.'])
    expect(notice.atirtSzoveg(k, 'aszf', 'X').bekezdesek).toHaveLength(3)
  })
})
