import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import type { Field } from 'payload'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * H05 és H48 őr: a Tudástár-hub ikerdokumentumának tájékoztatója
 * (HubPageNotice), az Oldalak „Mi ez” oszlopa (PageKindCell) és a kötött
 * webcím figyelmeztetése (KotottWebcimNotice).
 *
 * A szövegek a [slug]/page.tsx és a blog/[slug]/page.tsx kódjához kötve
 * (readFileSync): ha a route másképp osztja szét a mezőket, a teszt bukik.
 * DOM nélkül fut (renderToStaticMarkup), a Payload-hookokat mockoljuk; a
 * `fetch` hangosan dob (CLAUDE.md, 15. üzemeltetési tanulság), a REST-kérés
 * a useEffect-ben van, az statikus rendereléskor nem fut.
 */

interface MockState {
  fields: Record<string, { value: unknown; initialValue?: unknown }>
  doc: { id?: number | string; collectionSlug?: string; hasPublishedDoc: boolean }
}

let allapot: MockState = {
  fields: {},
  doc: { id: 9, collectionSlug: 'pages', hasPublishedDoc: false },
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
  allapot = { fields: {}, doc: { id: 9, collectionSlug: 'pages', hasPublishedDoc: false } }
})

const hub = await import('../components/admin/HubPageNotice')
const cell = await import('../components/admin/PageKindCell')
const kotott = await import('../components/admin/KotottWebcimNotice')
const { Pages } = await import('../collections/Pages')
const { Posts } = await import('../collections/Posts')
const { HUB_OLDALAK } = await import('../lib/tudastar/hub-oldalak')
const { OLDAL_FAJTA_FELIRAT } = await import('../lib/admin/kotott-cimek')

const forras = (ut: string): string =>
  readFileSync(fileURLToPath(new URL(ut, import.meta.url)), 'utf8')

type Rec = Record<string, unknown>
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null

function flat(fields: Field[], acc: Field[] = []): Field[] {
  for (const field of fields) {
    if (field.type === 'row' || field.type === 'collapsible') flat(field.fields, acc)
    else if (field.type === 'tabs') {
      for (const tab of field.tabs) if (!('name' in tab)) flat(tab.fields, acc)
    } else acc.push(field)
  }
  return acc
}

function feltetel(fields: Field[], name: string): (data: unknown) => boolean {
  const field = flat(fields).find((f) => 'name' in f && f.name === name)
  const admin = field && 'admin' in field && isRec(field.admin) ? field.admin : {}
  if (typeof admin.condition !== 'function') throw new Error(`nincs feltétel: ${name}`)
  return admin.condition as (data: unknown) => boolean
}

function tipografiaiHibak(text: string): string[] {
  const hibak: string[] = []
  if (/\s–\s|—/.test(text)) hibak.push(`gondolatjel: ${text}`)
  if (/["“]/.test(text)) hibak.push(`hibás idézőjel: ${text}`)
  if ([...text.matchAll(/„/g)].length !== [...text.matchAll(/”/g)].length) {
    hibak.push(`páratlan idézőjel: ${text}`)
  }
  for (const match of text.matchAll(/\p{Lu}{3,}/gu)) {
    if (!['SEO', 'GYIK'].includes(match[0])) hibak.push(`verzál szó (${match[0]}): ${text}`)
  }
  return hibak
}

const KEZ = HUB_OLDALAK.find((h) => h.slug === 'kez-zsibbadas')
if (!KEZ) throw new Error('hiányzik a kez-zsibbadas hub')
const KEZ_HUB = KEZ

describe('H05: a hub-tájékoztató csak a 8 hub-Oldalon és a 8 párjukon jelenik meg', () => {
  it('Pages: a feltétel a HUB_OLDALAK webcímeire igaz, máshol hamis', () => {
    const cond = feltetel(Pages.fields, 'hubTajekoztato')
    for (const h of HUB_OLDALAK) expect(cond({ slug: h.slug }), h.slug).toBe(true)
    for (const slug of ['kezdolap', 'kapcsolat', 'rolunk', 'aszf', 'miert-zsibbad-a-kezem', '']) {
      expect(cond({ slug }), slug).toBe(false)
    }
    expect(cond(undefined)).toBe(false)
  })

  it('Posts: a feltétel a HUB_OLDALAK cikkSlug-jaira igaz, máshol hamis', () => {
    const cond = feltetel(Posts.fields, 'hubTajekoztato')
    for (const h of HUB_OLDALAK) expect(cond({ slug: h.cikkSlug }), h.cikkSlug).toBe(true)
    for (const slug of [
      'kez-zsibbadas',
      'peace-and-love-friss-serules',
      'kezrehabilitacio-alapok',
    ]) {
      expect(cond({ slug }), slug).toBe(false)
    }
  })

  it('a doboz mindkét gyűjteményben a közzétételi állapot után, a Posts-ban a fülek fölött áll', () => {
    const pages = flat(Pages.fields).map((f) => ('name' in f ? f.name : f.type))
    expect(pages.slice(0, 2)).toEqual(['kozzetetelAllapot', 'hubTajekoztato'])
    const posts = Posts.fields.map((f) => ('name' in f ? f.name : f.type))
    expect(posts.slice(0, 3)).toEqual(['kozzetetelAllapot', 'hubTajekoztato', 'tabs'])
  })
})

describe('H05: a hub-Oldal doboza mezőnként mondja, mi honnan jön (a route kódja szerint)', () => {
  const par = { id: 2, cim: 'Miért zsibbad a kezem?', kozzeteve: true }

  it('közzétett párnál: a lapon a blogbejegyzés, a metaadat az Oldalé', () => {
    const sz = hub.hubOldalSzoveg(KEZ_HUB, par, true)
    expect(sz.cim).toBe(`${OLDAL_FAJTA_FELIRAT.hub}: a /kez-zsibbadas lap két dokumentumból áll.`)
    expect(sz.bekezdesek).toEqual([
      'A „Miért zsibbad a kezem?” blogbejegyzésből jön a lapon látható szöveg, a GYIK és a Google strukturált adata.',
      'Ebből az oldalból jön a közzététel, a böngészőfül címe, a Google-leírás, a kulcsszavak és a megosztási kép.',
    ])
  })

  it('nem közzétett pár, hiányzó pár, töltés közben, és nem közzétett Oldal', () => {
    expect(hub.hubOldalSzoveg(KEZ_HUB, { ...par, kozzeteve: false }, true).bekezdesek[2]).toBe(
      'A blogbejegyzés most nincs közzétéve, ezért a lapon ennek az oldalnak a saját mezői jelennek meg.',
    )
    expect(hub.hubOldalSzoveg(KEZ_HUB, null, true).bekezdesek[2]).toContain(
      'A /blog/miert-zsibbad-a-kezem blogbejegyzés nincs meg a Blogbejegyzések között',
    )
    expect(hub.hubOldalSzoveg(KEZ_HUB, undefined, true).bekezdesek[2]).toBe(
      'Ha a blogbejegyzés nincs közzétéve, a lapon ennek az oldalnak a saját mezői jelennek meg.',
    )
    expect(hub.hubOldalSzoveg(KEZ_HUB, par, false).bekezdesek[2]).toBe(
      'Amíg ez az oldal nincs közzétéve, a /kez-zsibbadas cím „az oldal nem található” hibát ad, és a blogbejegyzés a /blog/miert-zsibbad-a-kezem címen látszik.',
    )
  })

  it('a route kódja: közzétett pár → PostArticle a blogbejegyzésből, metaadat az Oldalból', () => {
    const route = forras('../app/(frontend)/[slug]/page.tsx')
    // Metaadat: buildPageMetadata(page, …): <title>, meta leírás, keywords, og:image az Oldalé.
    expect(route).toMatch(
      /const post = hub !== undefined \? await hubPostOf\(hub\.cikkSlug\) : null\s*if \(post\) \{[\s\S]*?const hubMetadata = buildPageMetadata\(page, `\/\$\{slug\}`/,
    )
    // A lap: PostArticle a blogbejegyzéssel. A WebPage JSON-LD leírása a közös
    // hub-láncból jön (src/lib/hub-seo.ts, H05/A20: page.seoDescription →
    // post.seoDescription → post.excerpt → page.excerpt), ugyanaz, mint a meta
    // leírásé; a képe a blogbejegyzésé.
    expect(route).toMatch(
      /description: seoForras\.description,\s*imageUrl: resolveOgImageUrl\(post\),/,
    )
    expect(route).toMatch(/<PostArticle[\s\S]*?post=\{post\}/)
    // A blogbejegyzés csak közzétéve számít (published-szűrt), különben az Oldal saját render-ága.
    expect(route).toContain(
      'const hubPostOf = cache((cikkSlug: string) => getPostBySlug(cikkSlug))',
    )
    expect(route).toMatch(
      /if \(hub !== undefined\) \{\s*const post = await hubPostOf\(hub\.cikkSlug\)\s*if \(post\) \{/,
    )
    // A GYIK és a kulcsszavak a cikk-sémában a blogbejegyzésből.
    const cikk = forras('../components/content/PostArticle.tsx')
    expect(cikk).toContain('const faqItems = postFaqItems(post)')
    expect(cikk).toContain('const keywords = resolveSeoKeywords(post.seoKeywords)')
  })
})

describe('H05: a blogbejegyzés doboza (a pár Oldal állapota szerint)', () => {
  const par = { id: 13, cim: 'Miért zsibbad a kezem?', kozzeteve: true }

  it('közzétett Oldal: a /blog cím átirányít, az itteni SEO-cím ott nem hat', () => {
    const sz = hub.hubBlogbejegyzesSzoveg(KEZ_HUB, par)
    expect(sz.cim).toBe('Ez a blogbejegyzés a /kez-zsibbadas címen jelenik meg.')
    expect(sz.bekezdesek[0]).toBe(
      'A /blog/miert-zsibbad-a-kezem cím oda irányít át. Ott a böngészőfül címét és a Google-leírást a „Miért zsibbad a kezem?” oldal (Oldalak) adja, az itteni SEO-cím ott nem hat.',
    )
    expect(sz.bekezdesek[1]).toBe(
      'Az itteni SEO-leírás, SEO-kulcsszavak és Megosztási kép ott csak a Google strukturált adatába kerül.',
    )
  })

  it('nem közzétett vagy hiányzó Oldal: a blogbejegyzés a /blog címen látszik', () => {
    const nem = hub.hubBlogbejegyzesSzoveg(KEZ_HUB, { ...par, kozzeteve: false })
    expect(nem.cim).toBe('Ez a blogbejegyzés a /kez-zsibbadas Tudástár-oldal forrása.')
    expect(nem.bekezdesek[0]).toBe(
      'Most a /blog/miert-zsibbad-a-kezem címen látszik, mert a „Miért zsibbad a kezem?” oldal (Oldalak) nincs közzétéve.',
    )
    expect(nem.bekezdesek[1]).toContain('az itteni SEO-cím ott nem hat.')
    expect(hub.hubBlogbejegyzesSzoveg(KEZ_HUB, null).bekezdesek[0]).toBe(
      'Az Oldalak között nincs /kez-zsibbadas webcímű oldal, ezért a blogbejegyzés a /blog/miert-zsibbad-a-kezem címen látszik.',
    )
    expect(hub.hubBlogbejegyzesSzoveg(KEZ_HUB, undefined).bekezdesek[0]).toContain(
      'Amíg a /kez-zsibbadas webcímű oldal (Oldalak) nincs közzétéve',
    )
  })

  it('a route kódja: a /blog/<cikk> csak közzétett hub-Oldalnál irányít át (308)', () => {
    const blog = forras('../app/(frontend)/blog/[slug]/page.tsx')
    expect(blog).toMatch(
      /const hub = await getPageBySlug\(hubSlug\)\s*if \(hub\) permanentRedirect/,
    )
    expect(blog).toContain('if (!isDraft) await hubraIranyit(slug)')
  })

  it('a link a párra visz, új lapon; a REST-válaszból az első találat', () => {
    expect(hub.parLinkFelirat('pages', par)).toBe(
      'Megnyitom a blogbejegyzést: Miért zsibbad a kezem? (új lapon)',
    )
    expect(hub.parLinkFelirat('posts', par)).toBe(
      'Megnyitom az oldalt: Miért zsibbad a kezem? (új lapon)',
    )
    expect(hub.parHref('/admin', 'posts', 2)).toBe('/admin/collections/posts/2')
    expect(hub.parAdatbol({ docs: [{ id: 2, title: ' Cím ', _status: 'draft' }] })).toEqual({
      id: 2,
      cim: 'Cím',
      kozzeteve: false,
    })
    expect(hub.parAdatbol({ docs: [] })).toBeNull()
    expect(hub.parAdatbol(null)).toBeNull()
    const html = renderToStaticMarkup(
      createElement(hub.HubPageNoticeView, {
        szoveg: hub.hubOldalSzoveg(KEZ_HUB, par, true),
        link: { felirat: hub.parLinkFelirat('pages', par), href: '/admin/collections/posts/2' },
      }),
    )
    expect(html).toContain('href="/admin/collections/posts/2"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
    expect(html).not.toMatch(/role="(alert|status)"/)
  })

  it('renderelés: a hub-Oldalon és a párján megjelenik, máshol semmi; töltés közben link nélkül', () => {
    allapot = {
      fields: { slug: { value: 'kez-zsibbadas' } },
      doc: { id: 13, collectionSlug: 'pages', hasPublishedDoc: false },
    }
    const oldal = renderToStaticMarkup(createElement(hub.HubPageNotice))
    expect(oldal).toContain('Tudástár-cikk tükre: a /kez-zsibbadas lap két dokumentumból áll.')
    expect(oldal).not.toContain('<a ')
    allapot = {
      fields: { slug: { value: 'miert-zsibbad-a-kezem' } },
      doc: { id: 2, collectionSlug: 'posts', hasPublishedDoc: true },
    }
    expect(renderToStaticMarkup(createElement(hub.HubPageNotice))).toContain(
      'Ez a blogbejegyzés a /kez-zsibbadas Tudástár-oldal forrása.',
    )
    allapot = {
      fields: { slug: { value: 'rolunk' } },
      doc: { id: 3, collectionSlug: 'pages', hasPublishedDoc: true },
    }
    expect(renderToStaticMarkup(createElement(hub.HubPageNotice))).toBe('')
  })

  it('minden változat tipográfiailag tiszta, és a Posts-szótár szerint beszél', () => {
    const par2 = { id: 1, cim: 'X', kozzeteve: false }
    const szovegek = [
      hub.hubOldalSzoveg(KEZ_HUB, par, true),
      hub.hubOldalSzoveg(KEZ_HUB, par2, false),
      hub.hubOldalSzoveg(KEZ_HUB, null, false),
      hub.hubOldalSzoveg(KEZ_HUB, undefined, false),
      hub.hubBlogbejegyzesSzoveg(KEZ_HUB, par),
      hub.hubBlogbejegyzesSzoveg(KEZ_HUB, par2),
      hub.hubBlogbejegyzesSzoveg(KEZ_HUB, null),
      hub.hubBlogbejegyzesSzoveg(KEZ_HUB, undefined),
    ].flatMap((sz) => [sz.cim, ...sz.bekezdesek])
    for (const sz of szovegek) {
      expect(tipografiaiHibak(sz), sz).toEqual([])
      // docs/ui-sztenderdek.md §8.1: „blogbejegyzés”, nem „cikk” vagy „bejegyzés”.
      expect(sz, sz).not.toMatch(/(?<![\p{L}-])(cikk|bejegyzés)(?!\p{L})/u)
      expect(sz, sz).not.toMatch(/404|slug/i)
    }
  })
})

describe('H05: „Mi ez” oszlop (PageKindCell)', () => {
  it.each([
    ['kezdolap', 'Kezdőlap (/)'],
    ['kapcsolat', 'Kapcsolat oldal'],
    ['impresszum', 'Jogi oldal'],
    ['pattano-ujj', 'Tudástár-cikk tükre'],
    ['bemutatkozas', 'Aloldal'],
  ] as const)('%s → %s', (slug, felirat) => {
    const html = renderToStaticMarkup(createElement(cell.PageKindCell, { rowData: { slug } }))
    expect(html).toBe(`<span class="kc-oldal-fajta">${felirat}</span>`)
  })

  it('hiányzó sor-adatnál „Aloldal”', () => {
    expect(cell.oldalWebcime(undefined)).toBeUndefined()
    expect(renderToStaticMarkup(createElement(cell.PageKindCell, {}))).toContain('Aloldal')
  })
})

describe('H48: a kötött webcím figyelmeztetése (KotottWebcimNotice)', () => {
  it('állapot: nincs kötés, mentett kötött webcím, átírt kötött webcím', () => {
    expect(kotott.webcimAllapot('pages', 'rolunk', 'rolunk-uj')).toBe('nincs')
    expect(kotott.webcimAllapot('pages', 'kapcsolat', 'kapcsolat')).toBe('kotott')
    expect(kotott.webcimAllapot('pages', 'kapcsolat', 'kapcsolatok')).toBe('atirva')
    expect(kotott.webcimAllapot('pages', 'kapcsolat', '')).toBe('atirva')
    expect(kotott.webcimAllapot('posts', 'kapcsolat', 'x')).toBe('nincs')
  })

  it('mentett állapot: egy nyugodt mondat, figyelem-jel és gomb nélkül', () => {
    const html = renderToStaticMarkup(
      createElement(kotott.KotottWebcimNoticeView, {
        gyujtemeny: 'pages',
        mentett: 'aszf',
        urlapban: 'aszf',
        kozzeteszGomb: 'Módosítások közzététele',
        bejelentes: '',
        onVisszaallit: () => undefined,
      }),
    )
    expect(html).toContain(kotott.NE_IRD_AT)
    expect(html).toContain('A lábléc, a hibaoldal és a pénztár linkje erre a webcímre mutat.')
    expect(html).not.toContain('kc-admin-notice--figyelem')
    expect(html).not.toContain('<button')
    expect(html).not.toMatch(/role="alert"/)
    expect(html).toMatch(/<p aria-live="polite"[^>]*><\/p>/)
  })

  it('átírt állapot: figyelmeztetés a következménnyel és igés „Visszaállítom” gombbal', () => {
    const html = renderToStaticMarkup(
      createElement(kotott.KotottWebcimNoticeView, {
        gyujtemeny: 'pages',
        mentett: 'kapcsolat',
        urlapban: 'kapcsolat-uj',
        kozzeteszGomb: 'Módosítások közzététele',
        bejelentes: 'Átírtad a webcímet, pedig a weboldal kódja a „kapcsolat” webcímre épít.',
        onVisszaallit: () => undefined,
      }),
    )
    expect(html).toContain('kc-admin-notice kc-admin-notice--figyelem')
    expect(html).toContain(
      'Átírtad a webcímet, pedig a weboldal kódja a „kapcsolat” webcímre épít.',
    )
    expect(html).toContain('csak a „Kapcsolat” cím marad, szekciók nélkül')
    expect(html).toContain(
      'Az automatikus mentés csak piszkozatot ír: a weboldal a „Módosítások közzététele” gombig a régi webcímet használja.',
    )
    // A gomb látható felirata igés, a neve azzal kezdődik (SC 2.5.3), type="button".
    expect(html).toMatch(
      /<button class="kc-kotott-webcim__gomb" type="button">Visszaállítom a „kapcsolat” webcímet<\/button>/,
    )
    expect(kotott.visszaallitoGombFelirat('kapcsolat').startsWith('Visszaállítom')).toBe(true)
    expect(html).not.toMatch(/role="alert"/)
    expect(html).toContain('aria-live="polite"')
  })

  it('az élő régió csak állapotváltáskor szól: átíráskor és visszaállításkor, mountkor nem', () => {
    const b = (volt: 'nincs' | 'kotott' | 'atirva' | null, lett: 'nincs' | 'kotott' | 'atirva') =>
      kotott.bejelentesValtozaskor(volt, lett, 'pages', 'kapcsolat', 'Módosítások közzététele')
    expect(b(null, 'kotott')).toBeNull()
    expect(b(null, 'atirva')).toBeNull()
    expect(b('kotott', 'kotott')).toBeNull()
    expect(b('nincs', 'kotott')).toBeNull()
    expect(b('kotott', 'atirva')).toBe(
      'Átírtad a webcímet, pedig a weboldal kódja a „kapcsolat” webcímre épít.',
    )
    expect(b('atirva', 'kotott')).toBe('A webcím újra „kapcsolat”.')
    expect(
      kotott.bejelentesValtozaskor('kotott', 'atirva', 'pages', null, 'Módosítások közzététele'),
    ).toBeNull()
  })

  it('nem kötött webcímnél csak az üres élő régió marad a DOM-ban', () => {
    const html = renderToStaticMarkup(
      createElement(kotott.KotottWebcimNoticeView, {
        gyujtemeny: 'pages',
        mentett: 'rolunk',
        urlapban: 'masik',
        kozzeteszGomb: 'Módosítások közzététele',
        bejelentes: '',
        onVisszaallit: () => undefined,
      }),
    )
    expect(html).not.toContain('kc-admin-notice')
    expect(html).toMatch(/<div class="kc-kotott-webcim"><p aria-live="polite"[^>]*><\/p><\/div>/)
  })

  it('renderelés: az űrlap kezdőértéke a viszonyítás, amíg a fő dokumentum le nem töltődik', () => {
    allapot = {
      fields: { slug: { value: 'kapcsolat-2', initialValue: 'kapcsolat' } },
      doc: { id: 5, collectionSlug: 'pages', hasPublishedDoc: true },
    }
    const html = renderToStaticMarkup(createElement(kotott.KotottWebcimNotice))
    expect(html).toContain('kc-admin-notice--figyelem')
    expect(html).toContain('Visszaállítom a „kapcsolat” webcímet')
    allapot = {
      fields: { slug: { value: 'x' } },
      doc: { collectionSlug: 'pages', hasPublishedDoc: false },
    }
    expect(renderToStaticMarkup(createElement(kotott.KotottWebcimNotice))).toBe('')
  })

  it('a Pages és a Posts oldalsávjában közvetlenül a Webcím alatt áll', () => {
    for (const c of [Pages, Posts]) {
      const nevek = flat(c.fields).map((f) => ('name' in f ? f.name : f.type))
      expect(nevek[nevek.indexOf('slug') + 1]).toBe('kotottWebcim')
      const f = flat(c.fields).find((m) => 'name' in m && m.name === 'kotottWebcim')
      const admin = f && 'admin' in f && isRec(f.admin) ? f.admin : {}
      expect(admin.position).toBe('sidebar')
      expect(isRec(admin.components) ? admin.components.Field : undefined).toBe(
        '/components/admin/KotottWebcimNotice#KotottWebcimNotice',
      )
    }
  })

  it('a névelő a webcím első hangjához igazodik („az „aszf””, „a „kapcsolat””)', () => {
    const k = { mire: ['A.'], kovetkezmeny: ['B.'] }
    expect(kotott.atirtSzoveg(k, 'aszf', 'X').cim).toBe(
      'Átírtad a webcímet, pedig a weboldal kódja az „aszf” webcímre épít.',
    )
    expect(kotott.visszaallitoGombFelirat('impresszum')).toBe(
      'Visszaállítom az „impresszum” webcímet',
    )
    expect(kotott.visszaallitoGombFelirat('kapcsolat')).toBe('Visszaállítom a „kapcsolat” webcímet')
    const inh = HUB_OLDALAK.find((h) => h.slug === 'inhuvelygyulladas')
    if (!inh) throw new Error('hiányzik az inhuvelygyulladas hub')
    expect(
      hub.hubOldalSzoveg(inh, { id: 1, cim: 'Ínhüvelygyulladás', kozzeteve: true }, true),
    ).toEqual({
      cim: 'Tudástár-cikk tükre: az /inhuvelygyulladas lap két dokumentumból áll.',
      bekezdesek: [
        'Az „Ínhüvelygyulladás” blogbejegyzésből jön a lapon látható szöveg, a GYIK és a Google strukturált adata.',
        'Ebből az oldalból jön a közzététel, a böngészőfül címe, a Google-leírás, a kulcsszavak és a megosztási kép.',
      ],
    })
    expect(
      hub.hubBlogbejegyzesSzoveg(inh, { id: 1, cim: 'Ínhüvelygyulladás', kozzeteve: true }).cim,
    ).toBe('Ez a blogbejegyzés az /inhuvelygyulladas címen jelenik meg.')
  })

  it('a szövegek tipográfiailag tiszták', () => {
    const k = { mire: ['A.'], kovetkezmeny: ['B.'] }
    const sz = kotott.atirtSzoveg(k, 'kapcsolat', 'Módosítások közzététele')
    for (const t of [
      sz.cim,
      ...sz.bekezdesek,
      kotott.NE_IRD_AT,
      kotott.visszaallitoGombFelirat('aszf'),
      kotott.visszaallitvaBejelentes('aszf'),
    ]) {
      expect(tipografiaiHibak(t), t).toEqual([])
    }
  })
})
