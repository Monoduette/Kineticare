import { describe, expect, it } from 'vitest'

import { buildNavTree, resolveMenuHref, type NavItem } from '../lib/menu-tree'
import type { Menu, Page, Post, Product } from '../payload-types'

/** Minimális Menu-fixture factory (a payload-types Menu alakját követi). */
function menu(overrides: Partial<Menu> & { id: number; label: string }): Menu {
  return {
    type: 'url',
    url: null,
    ref: null,
    parent: null,
    order: null,
    visible: true,
    unlisted: false,
    openInNewTab: false,
    updatedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as Menu
}

function urlMenu(id: number, label: string, url: string, overrides: Partial<Menu> = {}): Menu {
  return menu({ id, label, type: 'url', url, ...overrides })
}

function publishedPage(id: number, slug: string): Page {
  return {
    id,
    title: slug,
    slug,
    status: 'published',
    content: {
      root: { type: 'root', children: [], direction: null, format: '', indent: 0, version: 1 },
    },
    updatedAt: '',
    createdAt: '',
  } as unknown as Page
}

function pageRefMenu(id: number, label: string, page: Page, overrides: Partial<Menu> = {}): Menu {
  return menu({
    id,
    label,
    type: 'page',
    url: null,
    ref: { relationTo: 'pages', value: page },
    ...overrides,
  })
}

const labels = (items: NavItem[]): string[] => items.map((item) => item.label)

describe('resolveMenuHref', () => {
  it('url típus: a megadott URL-t adja vissza (relatív és külső is)', () => {
    expect(resolveMenuHref(urlMenu(1, 'Kezdőlap', '/'))).toBe('/')
    expect(resolveMenuHref(urlMenu(2, 'Külső', 'https://pelda.hu/x'))).toBe('https://pelda.hu/x')
  })

  it('url típus: üres URL esetén null', () => {
    expect(resolveMenuHref(urlMenu(1, 'Üres', '   '))).toBeNull()
    expect(resolveMenuHref(menu({ id: 1, label: 'Nincs url', type: 'url', url: null }))).toBeNull()
  })

  it('page típus: published cél /{slug} útvonalat kap', () => {
    const item = pageRefMenu(1, 'Bemutatkozás', publishedPage(10, 'bemutatkozas'))
    expect(resolveMenuHref(item)).toBe('/bemutatkozas')
  })

  it('page típus: draft cél esetén null (nem published cél nem kerül a menübe)', () => {
    const draft = { ...publishedPage(10, 'vazlat'), status: 'draft' } as Page
    expect(resolveMenuHref(pageRefMenu(1, 'Vázlat', draft))).toBeNull()
  })

  it('post típus: /blog/{slug} konvenció', () => {
    const post = { id: 5, slug: 'alapok', status: 'published' } as Post
    const item = menu({
      id: 2,
      label: 'Blog',
      type: 'post',
      ref: { relationTo: 'posts', value: post },
    })
    expect(resolveMenuHref(item)).toBe('/blog/alapok')
  })

  it('product típus: slug nélküli (régi) termék /kurzusok/{id} útvonal', () => {
    const product = { id: 7, status: 'published' } as Product
    const item = menu({
      id: 3,
      label: 'Kurzus',
      type: 'product',
      ref: { relationTo: 'products', value: product },
    })
    expect(resolveMenuHref(item)).toBe('/kurzusok/7')
  })

  it('product típus: sluggal a kanonikus /kurzusok/{slug} útvonal (C3)', () => {
    const product = { id: 7, slug: 'kez-torna', status: 'published' } as Product
    const item = menu({
      id: 3,
      label: 'Kurzus',
      type: 'product',
      ref: { relationTo: 'products', value: product },
    })
    expect(resolveMenuHref(item)).toBe('/kurzusok/kez-torna')
  })

  it('nem populate-olt ref esetén null (státusz nem ellenőrizhető)', () => {
    const item = menu({
      id: 1,
      label: 'Nyers',
      type: 'page',
      ref: { relationTo: 'pages', value: 10 },
    })
    expect(resolveMenuHref(item)).toBeNull()
  })
})

describe('buildNavTree', () => {
  it('üres bemenetre üres fa', () => {
    expect(buildNavTree([])).toEqual([])
  })

  it('order szerint rendez; azonos order esetén címke szerint', () => {
    const tree = buildNavTree([
      urlMenu(1, 'Zulu', '/z', { order: 1 }),
      urlMenu(2, 'Alfa', '/a', { order: 1 }),
      urlMenu(3, 'Első', '/elso', { order: 0 }),
    ])
    expect(labels(tree)).toEqual(['Első', 'Alfa', 'Zulu'])
  })

  it('visible:false sorok kiesnek', () => {
    const tree = buildNavTree([
      urlMenu(1, 'Látható', '/lat'),
      urlMenu(2, 'Rejtett', '/rejtett', { visible: false }),
    ])
    expect(labels(tree)).toEqual(['Látható'])
  })

  it('unlisted:true („rejtett link") sorok kiesnek a navigációból', () => {
    const tree = buildNavTree([
      urlMenu(1, 'Látható', '/lat'),
      urlMenu(2, 'Rejtett link', '/rejtett-link', { unlisted: true }),
    ])
    expect(labels(tree)).toEqual(['Látható'])
  })

  it('unlisted szülő gyermeke gyökér-szintre emelkedik (a kiesett szülő szabálya)', () => {
    const tree = buildNavTree([
      urlMenu(1, 'Rejtett szülő', '/szulo', { unlisted: true }),
      urlMenu(2, 'Látható gyermek', '/gyermek', { parent: 1 }),
    ])
    expect(labels(tree)).toEqual(['Látható gyermek'])
    expect(tree[0].children).toEqual([])
  })

  it('unlisted nem befolyásolja a resolveMenuHref-et: a cél linkje ugyanaz marad', () => {
    const page = publishedPage(10, 'rejtett-oldal')
    expect(resolveMenuHref(pageRefMenu(1, 'Rejtett', page, { unlisted: true }))).toBe(
      '/rejtett-oldal',
    )
    expect(resolveMenuHref(urlMenu(2, 'Rejtett url', '/x', { unlisted: true }))).toBe('/x')
  })

  it('két szint: a gyermek a szülő children-listájába kerül, order szerint', () => {
    const tree = buildNavTree([
      urlMenu(1, 'Szülő', '/szulo', { order: 0 }),
      urlMenu(2, 'Második gyermek', '/b', { parent: 1, order: 2 }),
      urlMenu(3, 'Első gyermek', '/a', { parent: 1, order: 1 }),
    ])
    expect(tree).toHaveLength(1)
    expect(labels(tree[0].children)).toEqual(['Első gyermek', 'Második gyermek'])
  })

  it('kiesett szülő esetén a gyermek gyökér-szintre emelkedik', () => {
    const tree = buildNavTree([
      urlMenu(1, 'Rejtett szülő', '/szulo', { visible: false }),
      urlMenu(2, 'Árva gyermek', '/gyermek', { parent: 1 }),
    ])
    expect(labels(tree)).toEqual(['Árva gyermek'])
    expect(tree[0].children).toEqual([])
  })

  it('nem published célú szülő esetén is gyökér-szintre emelkedik a gyermek', () => {
    const draft = { ...publishedPage(10, 'vazlat'), status: 'draft' } as Page
    const tree = buildNavTree([
      pageRefMenu(1, 'Vázlat szülő', draft),
      urlMenu(2, 'Árva gyermek', '/gyermek', { parent: 1 }),
    ])
    expect(labels(tree)).toEqual(['Árva gyermek'])
  })

  it('2 szintnél mélyebb lánc nem töri el: az elem a gyökér-ős alá kerül', () => {
    const tree = buildNavTree([
      urlMenu(1, 'Gyökér', '/gyoker'),
      urlMenu(2, 'Köztes', '/koztes', { parent: 1 }),
      urlMenu(3, 'Mély', '/mely', { parent: 2 }),
    ])
    expect(tree).toHaveLength(1)
    expect(labels(tree[0].children)).toContain('Köztes')
    expect(labels(tree[0].children)).toContain('Mély')
    expect(tree[0].children.every((child) => child.children.length === 0)).toBe(true)
  })

  it('openInNewTab és külső-jelölés átöröklődik', () => {
    const tree = buildNavTree([
      urlMenu(1, 'Külső', 'https://pelda.hu', { openInNewTab: true }),
      urlMenu(2, 'Belső', '/belso'),
    ])
    const external = tree.find((item) => item.label === 'Külső')
    const internal = tree.find((item) => item.label === 'Belső')
    expect(external?.openInNewTab).toBe(true)
    expect(external?.isExternal).toBe(true)
    expect(internal?.isExternal).toBe(false)
  })

  it('ciklikus parent-lánc nem okoz végtelen ciklust', () => {
    const tree = buildNavTree([
      urlMenu(1, 'A', '/a', { parent: 2 }),
      urlMenu(2, 'B', '/b', { parent: 1 }),
    ])
    // A ciklikus elemek eldobódnak — a fontos: nem fagy ki a render.
    expect(Array.isArray(tree)).toBe(true)
  })

  it('populate-olt (objektum) parent-hivatkozást is felold', () => {
    const parentDoc = urlMenu(1, 'Szülő', '/szulo')
    const tree = buildNavTree([
      parentDoc,
      menu({
        id: 2,
        label: 'Gyermek',
        type: 'url',
        url: '/gyermek',
        parent: parentDoc,
      }),
    ])
    expect(tree).toHaveLength(1)
    expect(labels(tree[0].children)).toEqual(['Gyermek'])
  })
})
