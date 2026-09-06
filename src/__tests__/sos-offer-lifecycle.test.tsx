import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('payload', () => ({
  getPayload: vi.fn(() => {
    throw new Error('No Payload in lifecycle tests')
  }),
}))
vi.mock('../payload.config', () => ({ default: {} }))
vi.mock('../lib/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }))

import { FaqBlock } from '../components/blocks/FaqBlock'
import { RenderBlocks } from '../components/blocks/RenderBlocks'
import { buildHomeLayout } from '../lib/home-seed'
import { buildNavTree } from '../lib/menu-tree'
import { planOwnerReviewV1 } from '../lib/owner-review-v1'
import { isAvailableSosProduct, isStorefrontFreeSos } from '../lib/sos-offer'
import { SOS_FREE_MENU_LABEL, SOS_MENU_LABEL } from '../lib/sos-offer-copy'
import type { BlockFaq, Menu, Product } from '../payload-types'
import { planOwnerReviewMenus } from '../scripts/apply-owner-review-v1'

const question = 'Miben különbözik az ingyenes SOS és a teljes kurzus?'
const product = (overrides: Partial<Product> = {}): Product =>
  ({
    id: 2,
    slug: 'sos-kezrelax-villamkurzus',
    status: 'published',
    _status: 'published',
    priceInHUFEnabled: false,
    ...overrides,
  }) as Product
const oldMenu = {
  id: 6,
  label: 'SOS KézRelax',
  type: 'product',
  order: 0,
  ref: { relationTo: 'products', value: 2 },
} as Menu
const fullCourse = (overrides: Partial<Product> = {}) =>
  product({
    id: 3,
    slug: 'otthoni-kezrehab-program',
    priceInHUFEnabled: true,
    priceInHUF: 20000,
    ...overrides,
  })
const persistedMenu = { ...oldMenu, label: planOwnerReviewMenus([oldMenu], product())[0].label }
const canonical = buildHomeLayout()
const planned = planOwnerReviewV1({
  slug: 'kezdolap',
  layout: canonical,
  canonicalLayout: canonical,
})
const persistedFaq = planned.layout.find((block): block is BlockFaq => block.blockType === 'faq')!
const managedPair = persistedFaq.items!.find((item) => item.question === question)!

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze)
    Object.freeze(value)
  }
  return value
}
freeze(persistedFaq)
freeze(persistedMenu)

function menuWith(target: Product | number | null | undefined, label = persistedMenu.label): Menu {
  return freeze({ ...persistedMenu, label, ref: { relationTo: 'products', value: target } } as Menu)
}
function faqHtml(products: Product[], block = persistedFaq) {
  return renderToStaticMarkup(
    createElement(RenderBlocks, {
      layout: [block],
      products,
      posts: [],
      testimonials: [],
    }),
  )
}
function jsonQuestions(html: string): string[] {
  const json = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1]
  if (!json) return []
  return JSON.parse(json).mainEntity.map((entry: { name: string }) => entry.name)
}
function expectFaq(html: string, comparison: boolean, expectedCount: number) {
  const questions = jsonQuestions(html)
  expect(questions.includes(question)).toBe(comparison)
  expect(html.includes(`<summary class="kc-faq__question">${question}</summary>`)).toBe(comparison)
  expect(html.includes(managedPair.answer)).toBe(comparison)
  expect(questions).toHaveLength(expectedCount)
  expect(html.match(/<summary /g) ?? []).toHaveLength(expectedCount)
}

beforeEach(() =>
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('Network forbidden')
    }),
  ),
)
afterEach(() => vi.unstubAllGlobals())

describe('Persisted owner copy follows current SOS availability without CMS rewrites', () => {
  it('uses the real planner output and renders both free claims while verified', () => {
    expect(planned.changes.some((change) => change.requestId === 'H13')).toBe(true)
    expect(persistedMenu.label).toBe(SOS_FREE_MENU_LABEL)
    expect(buildNavTree([menuWith(product())])[0].label).toBe(persistedMenu.label)
    expectFaq(faqHtml([product(), fullCourse()]), true, persistedFaq.items!.length)
  })

  it('storefront-published free SOS is Ingyenes in nav even if Payload _status is draft', () => {
    const liveShaped = product({ _status: 'draft' })
    expect(isStorefrontFreeSos(liveShaped)).toBe(true)
    expect(isAvailableSosProduct(liveShaped)).toBe(false)
    expect(buildNavTree([menuWith(liveShaped, SOS_MENU_LABEL)])[0]).toMatchObject({
      label: SOS_FREE_MENU_LABEL,
      href: '/kurzusok/sos-kezrelax-villamkurzus',
    })
  })

  it.each([
    ['free', fullCourse({ priceInHUFEnabled: false })],
    ['zero price', fullCourse({ priceInHUF: 0 })],
    ['missing price', fullCourse({ priceInHUF: undefined })],
    ['missing price toggle', fullCourse({ priceInHUFEnabled: undefined })],
    ['draft', fullCourse({ status: 'draft' })],
    ['Payload draft', fullCourse({ _status: 'draft' })],
    ['missing publication proof', fullCourse({ _status: undefined })],
    ['unrelated paid', fullCourse({ slug: 'masik-fizetos' })],
    ['null', null],
    ['missing', undefined],
  ] as const)('hides the paid-full-course claim when full course is %s', (_, full) => {
    expectFaq(faqHtml([product(), ...(full ? [full] : [])]), false, persistedFaq.items!.length - 1)
  })

  it.each([
    ['paid', product({ priceInHUFEnabled: true, priceInHUF: 9000 })],
    ['zero but paid', product({ priceInHUFEnabled: true, priceInHUF: 0 })],
    ['unknown pricing', product({ priceInHUFEnabled: undefined })],
    ['null pricing', product({ priceInHUFEnabled: null })],
  ] as const)('%s keeps the link but removes managed free claims', (_, target) => {
    const menu = menuWith(target)
    const before = structuredClone(menu)
    const nav = buildNavTree([menu])
    expect(nav[0].label).toBe(SOS_MENU_LABEL)
    expect(nav[0].href).toBe('/kurzusok/sos-kezrelax-villamkurzus')
    expectFaq(faqHtml([target, fullCourse()]), false, persistedFaq.items!.length - 1)
    expect(menu).toEqual(before)
    expect(persistedMenu.label).toBe(SOS_FREE_MENU_LABEL)
    expect(persistedFaq.items).toContain(managedPair)
  })

  it.each([
    ['Payload draft', product({ _status: 'draft' })],
    ['missing publication proof', product({ _status: undefined })],
  ] as const)('%s keeps storefront-visible Ingyenes on the nav, FAQ stay HOLD', (_, target) => {
    const menu = menuWith(target)
    const nav = buildNavTree([menu])
    expect(nav[0].label).toBe(SOS_FREE_MENU_LABEL)
    expect(nav[0].href).toBe('/kurzusok/sos-kezrelax-villamkurzus')
    expectFaq(faqHtml([target, fullCourse()]), false, persistedFaq.items!.length - 1)
  })

  it.each([
    ['draft', product({ status: 'draft' })],
    ['archived', product({ status: 'archived' })],
    ['null', null],
    ['missing', undefined],
    ['unpopulated', 2],
  ] as const)('%s hides unresolved menu targets and both FAQ representations', (_, target) => {
    expect(buildNavTree([menuWith(target)])).toEqual([])
    const products = target && typeof target === 'object' ? [target] : []
    expectFaq(faqHtml(products), false, persistedFaq.items!.length - 1)
  })

  it('an unrelated free course cannot restore canonical free claims', () => {
    const paid = product({ priceInHUFEnabled: true })
    const unrelated = product({ id: 9, slug: 'masik-ingyenes' })
    expectFaq(faqHtml([paid, unrelated]), false, persistedFaq.items!.length - 1)
    expectFaq(faqHtml([unrelated]), false, persistedFaq.items!.length - 1)
    expect(buildNavTree([menuWith(unrelated)])[0].label).toBe(persistedMenu.label)
  })

  it('derives either exact managed label and preserves original ordering, nesting and links', () => {
    const sibling = { id: 8, label: 'Kezelések', type: 'url', url: '/kezelesek', order: 0 } as Menu
    for (const label of [SOS_MENU_LABEL, SOS_FREE_MENU_LABEL]) {
      const free = menuWith(product(), label)
      const paid = menuWith(product({ priceInHUFEnabled: true }), label)
      const before = buildNavTree([sibling, paid])
      const after = buildNavTree([sibling, free])
      expect(after.map((item) => item.id)).toEqual(before.map((item) => item.id))
      expect(after.find((item) => item.id === free.id)?.label).toBe(SOS_FREE_MENU_LABEL)
      const parent = { ...sibling, id: 10, order: -1 }
      const children = [sibling, paid].map((item) => ({ ...item, parent: 10 }))
      const tree = buildNavTree(freeze([parent, ...children]))
      expect(tree[0].children.map((item) => item.id)).toEqual(before.map((item) => item.id))
      expect(tree[0].children.find((item) => item.id === paid.id)?.href).toBe(
        '/kurzusok/sos-kezrelax-villamkurzus',
      )
    }
  })

  it('preserves custom labels and URL menu entries verbatim', () => {
    for (const label of ['Saját ingyenes ajánlat', 'Ingyenes SOS KézRelax ', 'SOS Kézrelax']) {
      expect(buildNavTree([menuWith(product({ priceInHUFEnabled: true }), label)])[0].label).toBe(
        label,
      )
    }
    const url = { ...persistedMenu, type: 'url', url: '/kurzusok', openInNewTab: true } as Menu
    expect(buildNavTree([url])[0]).toMatchObject({
      label: persistedMenu.label,
      href: '/kurzusok',
      openInNewTab: true,
    })
  })

  it('only suppresses the exact managed question AND answer, preserving custom copy and safety', () => {
    const customItems = [
      { ...managedPair, id: 'custom-answer', answer: 'Egyedi válasz az ingyenes kurzusról.' },
      { ...managedPair, id: 'custom-question', question: 'Saját kérdés' },
      { ...managedPair, id: 'custom-whitespace', question: ` ${question}` },
    ]
    const block = freeze({ ...persistedFaq, items: [...persistedFaq.items!, ...customItems] })
    const before = structuredClone(block)
    const html = faqHtml([], block)
    expect(jsonQuestions(html)).toHaveLength(block.items.length - 1)
    expect(html.match(/<summary /g)).toHaveLength(block.items.length - 1)
    for (const item of [
      ...persistedFaq.items!.filter((item) => item !== managedPair),
      ...customItems,
    ]) {
      expect(jsonQuestions(html)).toContain(item.question.trim())
      expect(html).toContain(item.answer)
    }
    expect(block).toEqual(before)
  })

  it('direct FAQ rendering defaults to unavailable and emits no empty JSON-LD', () => {
    const block = { ...persistedFaq, items: [managedPair] }
    expect(renderToStaticMarkup(createElement(FaqBlock, { block }))).toBe('')
  })
})
