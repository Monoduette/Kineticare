import { describe, expect, it, vi } from 'vitest'

// The approved builders live in a legacy CLI module. Never evaluate its config or initialize
// Payload while importing fixture builders. The planner itself imports neither module.
vi.mock('../payload.config', () => ({ default: {} }))
vi.mock('payload', () => ({
  getPayload: vi.fn(() => {
    throw new Error('No Payload initialization in owner fixtures')
  }),
}))

import { getPayload } from 'payload'
import { buildHomeLayout } from '../lib/home-seed'
import { ctaLabel } from '../lib/cta-vocabulary'
import {
  buildKapcsolatLayout,
  buildRolunkLayout,
  buildSzolgaltatasokLayout,
  rolunkSzakmaiOrokoltTartalom,
} from '../scripts/restore-legacy-content'
import {
  planOwnerReviewV1,
  type OwnerReviewMediaRole,
  type OwnerReviewSlug,
  type OwnerReviewV1Input,
} from '../lib/owner-review-v1'
import type { Page } from '../payload-types'

type Layout = NonNullable<Page['layout']>
type Block = Layout[number]
type Data = Record<string, unknown>
const data = (value: unknown): Data => value as Data
const find = (layout: Layout, type: string, title?: string): Data =>
  data(layout.find((block) => block.blockType === type && (!title || data(block).title === title))!)
const children = (content: unknown): Data[] => data(data(content).root).children as Data[]
const rows = (block: Data, key = 'rows'): Data[] => block[key] as Data[]
const media: Record<OwnerReviewMediaRole, number> = {
  homeFounders: 101,
  homeSos: 102,
  homeExpectations: 103,
  homeServices: 104,
  servicesJoint: 105,
  servicesBenefits: 106,
  aboutDifference: 107,
  aboutPhoto: 108,
  kocsisPortrait: 109,
  kissPortrait: 110,
}
const oldHomeMedia = {
  'katak-team.jpg': 1,
  'sos-hands-board.jpg': 2,
  'services-hands.png': 3,
  'state-zart.png': 4,
  'state-nyilo.png': 5,
  'state-nyitott.png': 6,
}
const oldPageMedia = { rolunkFoto: 7, szolgaltatasokKep: 8, kocsisPortre: 9, kissPortre: 10 }
const builders: Record<OwnerReviewSlug, () => Layout> = {
  kezdolap: () => buildHomeLayout(oldHomeMedia),
  szolgaltatasok: () => buildSzolgaltatasokLayout(oldPageMedia),
  rolunk: () => buildRolunkLayout(oldPageMedia),
  kapcsolat: () => buildKapcsolatLayout(oldPageMedia),
}

const freeze = <T>(value: T): T => {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(freeze)
    Object.freeze(value)
  }
  return value
}

const fixture = (slug: OwnerReviewSlug): OwnerReviewV1Input => {
  const canonicalLayout = builders[slug]()
  const layout = structuredClone(canonicalLayout).map((block, index) => ({
    ...block,
    id: `${slug}-${index}`,
  }))
  return {
    slug,
    canonicalLayout,
    layout,
    mediaByRole: media,
    completeCourseHref: '/kurzusok/teljes-kezrehab-41',
  }
}

// Exact published differences captured and owner-approved on 2026-09-05.
// Deliberately independent of the planner's private allowlist and of /tmp snapshots.
const publishedHomeFixture = (): OwnerReviewV1Input => {
  const input = fixture('kezdolap')
  const states = find(input.layout!, 'states')
  states.blockName = null
  data(states.sectionSettings).anchorId = null
  rows(states, 'cards').forEach((card, index) => {
    card.image = 17 + index
    rows(find(input.canonicalLayout, 'states'), 'cards')[index].image = 17 + index
    card.number = null
    card.id = `published-state-${index}`
  })
  rows(states, 'cards')[2].text =
    'Újra a saját kezed. Munkázhatsz, sportolhatsz, önfeledten élhetsz.'
  const faq = find(input.layout!, 'faq')
  faq.blockName = null
  data(faq.sectionSettings).anchorId = null
  const items = rows(faq, 'items')
  items[0].answer =
    'A kurzusok általános rehabilitációs programok. Műtét után mindig a kezelőorvosod vagy gyógytornászod jóváhagyásával kezdj bele — ha bizonytalan vagy, írj nekünk a kapcsolat oldalon, és segítünk eligazodni.'
  items[2].answer =
    'Napi 10–15 perc is elég — a rövid, rendszeres gyakorlás hozza a tartós eredményt, nem az egyszeri nagy erőfeszítés.'
  items[3].answer =
    'Nem. A gyakorlatok többsége saját testsúllyal, otthon található eszközökkel végezhető — ahol bármi kell, azt a videóban jelezzük.'
  items.forEach((item, index) => {
    item.id = `published-faq-${index}`
  })
  rows(find(input.layout!, 'howItWorks'), 'steps')[2].text =
    'A gyakorlatok lépésről lépésre vezetnek — naponta néhány perc is elég a haladáshoz.'
  rows(find(input.layout!, 'services'))[2].felirat = 'Tovább a kéz workshopra'
  return input
}

const publishedAboutFixture = (): OwnerReviewV1Input => {
  const input = fixture('rolunk')
  input.layout = input.layout!.filter((block) => block.blockType !== 'teamMembers')
  const partners = data(
    input.layout.find(
      (block) =>
        block.blockType === 'richText' &&
        rows(children(data(block).content)[0], 'children')[0].text === 'Partnereink',
    )!,
  )
  data(data(partners.content).root).children = [
    ...children(rolunkSzakmaiOrokoltTartalom()).slice(0, 4),
    ...children(partners.content),
  ]
  return input
}

const bioBlock = (layout: Layout): Data => data(layout.find((block) => block.id === 'rolunk-5')!)

describe('P03: stored filmHero SOS caption', () => {
  const legacyFixture = () => {
    const input = fixture('kezdolap')
    rows(find(input.layout!, 'filmHero'), 'ctas')[1].felirat = 'Nézd meg az SOS-kurzust'
    return input
  }

  it.each([false, true])(
    'patches only the approved old label, retaining all hero/row data (reordered: %s)',
    (reordered) => {
      const input = legacyFixture()
      const hero = find(input.layout!, 'filmHero')
      hero.editorMetadata = { paperVeil: 0.52, keep: null }
      const ctas = rows(hero, 'ctas')
      ctas[1].id = 'stored-sos-cta'
      ctas[1].editorMetadata = { keep: ['custom'], optional: null }
      if (reordered) ctas.reverse()
      const index = ctas.findIndex((cta) => cta.url === '#ingyenes')
      const before = structuredClone(input)
      const footer = find(input.layout!, 'ctaBanner')
      const result = planOwnerReviewV1(freeze(input))
      const next = find(result.layout, 'filmHero')
      const expected = structuredClone(hero)
      rows(expected, 'ctas')[index].felirat = ctaLabel('free-strip-jump')
      expect(next).toEqual(expected)
      expect(rows(next, 'ctas')[index].id).toBe('stored-sos-cta')
      expect(rows(next, 'ctas')[index].editorMetadata).toBe(ctas[index].editorMetadata)
      expect(rows(next, 'ctas')[1 - index]).toBe(ctas[1 - index])
      expect(next.sectionSettings).toBe(hero.sectionSettings)
      expect(next.editorMetadata).toBe(hero.editorMetadata)
      expect(find(result.layout, 'ctaBanner')).toBe(footer)
      expect(input).toEqual(before)
      expect(result.changes.filter((change) => change.requestId === 'P03')).toEqual([
        expect.objectContaining({
          blockId: hero.id,
          path: `/layout/0/ctas/${index}/felirat`,
          before: 'Nézd meg az SOS-kurzust',
          after: 'Nézd meg ingyenes SOS-kurzusunkat',
        }),
      ])
      expect(planOwnerReviewV1({ ...input, layout: result.layout }).changes).toHaveLength(0)
    },
  )

  it.each([
    'Saját felirat',
    'Nézd meg az SOS-kurzust ',
    'nézd meg az SOS-kurzust',
    ctaLabel('free-strip-jump'),
  ])('preserves staff captions and the already-approved caption: %s', (label) => {
    const input = legacyFixture()
    const hero = find(input.layout!, 'filmHero')
    rows(hero, 'ctas')[1].felirat = label
    const result = planOwnerReviewV1(freeze(input))
    expect(find(result.layout, 'filmHero')).toBe(hero)
    expect(result.changes.some((change) => change.requestId === 'P03')).toBe(false)
  })

  it.each([
    '/kurzusok',
    '/kurzusok/otthoni-kezrehab-program',
    '/#ingyenes',
    '#ingyenes ',
    '#masik',
    undefined,
  ])('does not relabel a different or missing destination: %s', (url) => {
    const input = legacyFixture()
    const hero = find(input.layout!, 'filmHero')
    rows(hero, 'ctas')[1].url = url
    const result = planOwnerReviewV1(freeze(input))
    expect(find(result.layout, 'filmHero')).toBe(hero)
    expect(result.changes.some((change) => change.requestId === 'P03')).toBe(false)
  })

  it.each(['missing-ctas', 'duplicate-row', 'missing-canonical-row', 'duplicate-hero'])(
    'does not guess an ambiguous or missing CTA: %s',
    (variant) => {
      const input = legacyFixture()
      const hero = find(input.layout!, 'filmHero')
      if (variant === 'missing-ctas') delete hero.ctas
      if (variant === 'duplicate-row')
        rows(hero, 'ctas').push({ ...rows(hero, 'ctas')[1], id: 'duplicate' })
      if (variant === 'missing-canonical-row')
        rows(find(input.canonicalLayout, 'filmHero'), 'ctas').pop()
      if (variant === 'duplicate-hero')
        input.layout!.push({ ...hero, id: 'duplicate-hero' } as Block)
      const result = planOwnerReviewV1(freeze(input))
      expect(result.changes.some((change) => change.requestId === 'P03')).toBe(false)
      expect(result.layout.find((block) => block.id === hero.id)).toBe(hero)
    },
  )

  it('reports P03 independently when H13 is already applied, so the CLI can enforce the free-proof HOLD', () => {
    const initial = fixture('kezdolap')
    const input = { ...initial, layout: planOwnerReviewV1(initial).layout }
    rows(find(input.layout, 'filmHero'), 'ctas')[1].felirat = 'Nézd meg az SOS-kurzust'
    const result = planOwnerReviewV1(freeze(input))
    expect(result.changes.map((change) => change.requestId)).toEqual(['P03'])
  })
})

describe('owner-approved 2026-09-05 published variants', () => {
  it('H08 uses canonical media identities remapped into the local database, not captured numeric IDs', () => {
    const input = publishedHomeFixture()
    const states = find(input.layout!, 'states')
    const canonicalCards = rows(find(input.canonicalLayout, 'states'), 'cards')
    rows(states, 'cards').forEach((card, index) => {
      card.image = 117 + index
      canonicalCards[index].image = 117 + index
    })
    const before = structuredClone(input)
    const result = planOwnerReviewV1(freeze(input))
    expect(input).toEqual(before)
    expect(result.layout.some((block) => block.blockType === 'states')).toBe(false)
    expect(planOwnerReviewV1({ ...input, layout: result.layout }).changes).toHaveLength(0)
  })

  it.each([
    'custom-image',
    'captured-image',
    'unknown-null',
    'null-changed',
    'missing-canonical-image',
    'canonical-order',
  ])('H08 preserves a remapped published block on a non-approved difference: %s', (variant) => {
    const input = publishedHomeFixture()
    const states = find(input.layout!, 'states')
    const cards = rows(states, 'cards')
    const canonicalCards = rows(find(input.canonicalLayout, 'states'), 'cards')
    cards.forEach((card, index) => {
      card.image = 117 + index
      canonicalCards[index].image = 117 + index
    })
    if (variant === 'custom-image') cards[0].image = 999
    if (variant === 'captured-image') cards[0].image = 17
    if (variant === 'unknown-null') cards[0].editorNote = null
    if (variant === 'null-changed') cards[0].number = ''
    if (variant === 'missing-canonical-image') delete canonicalCards[0].image
    if (variant === 'canonical-order') canonicalCards.reverse()
    const result = planOwnerReviewV1(freeze(input))
    expect(find(result.layout, 'states')).toBe(states)
    expect(result.skips).toContainEqual(
      expect.objectContaining({ requestId: 'H08', code: 'editor-change' }),
    )
  })

  it('H08/H10/H13 updates the exact published values, retains IDs and is idempotent', () => {
    const input = publishedHomeFixture()
    const before = structuredClone(input)
    const result = planOwnerReviewV1(freeze(input))
    expect(input).toEqual(before)
    expect(result.layout.some((block) => block.blockType === 'states')).toBe(false)
    expect(rows(find(result.layout, 'faq'), 'items')).toHaveLength(5)
    expect(rows(find(result.layout, 'faq'), 'items')[0].id).toBe('published-faq-0')
    expect(rows(find(result.layout, 'howItWorks'), 'steps')[2].text).toBe(
      'Kövesd a videók útmutatását, és gyakorolj a saját tempódban.',
    )
    expect(rows(find(result.layout, 'services', 'Így tudunk segíteni'))[2].felirat).toBe(
      'Nézd meg a kézworkshopot',
    )
    expect(planOwnerReviewV1({ ...input, layout: result.layout }).changes).toHaveLength(0)
  })

  it.each(['states-text', 'states-media', 'states-setting', 'faq-text', 'faq-extra', 'step'])(
    'preserves editor changes around the published variant: %s',
    (variant) => {
      const input = publishedHomeFixture()
      const states = find(input.layout!, 'states')
      const faq = find(input.layout!, 'faq')
      const step = rows(find(input.layout!, 'howItWorks'), 'steps')[2]
      if (variant === 'states-text') rows(states, 'cards')[2].text += ' '
      if (variant === 'states-media') rows(states, 'cards')[0].image = 999
      if (variant === 'states-setting') data(states.sectionSettings).visible = false
      if (variant === 'faq-text') rows(faq, 'items')[0].answer += ' '
      if (variant === 'faq-extra') rows(faq, 'items')[0].editorNote = null
      if (variant === 'step') step.text = String(step.text).replace(' — ', ' – ')
      const result = planOwnerReviewV1(freeze(input))
      if (variant.startsWith('states')) expect(find(result.layout, 'states')).toBe(states)
      if (variant.startsWith('faq')) expect(find(result.layout, 'faq')).toBe(faq)
      if (variant === 'step') expect(rows(find(result.layout, 'howItWorks'), 'steps')[2]).toBe(step)
    },
  )

  it.each(['Tovább a kéz workshopra', 'Tovább a szakmai képzésre'])(
    'H08 accepts only an approved training caption with its unchanged destination: %s',
    (label) => {
      const input = fixture('kezdolap')
      const row = rows(find(input.layout!, 'services'))[2]
      row.felirat = label
      const result = planOwnerReviewV1(input)
      expect(rows(find(result.layout, 'services', 'Így tudunk segíteni'))[2].felirat).toBe(
        'Nézd meg a kézworkshopot',
      )
      row.url = 'https://example.test/custom'
      expect(
        rows(find(planOwnerReviewV1(freeze(input)).layout, 'services', 'Így tudunk segíteni'))[2],
      ).toBe(row)
    },
  )

  it('A06 replaces only the exact four-node bio prefix, keeping all partner nodes and input metadata', () => {
    const input = publishedAboutFixture()
    const old = bioBlock(input.layout!)
    children(old.content).push({
      type: 'paragraph',
      children: [{ type: 'text', text: 'Saját partner' }],
    })
    const tail = children(old.content).slice(4)
    const before = structuredClone(input)
    const result = planOwnerReviewV1(freeze(input))
    const retained = bioBlock(result.layout)
    expect(input).toEqual(before)
    expect(retained.id).toBe(old.id)
    expect(retained.sectionSettings).toBe(old.sectionSettings)
    expect(children(retained.content)).toEqual(tail)
    children(retained.content).forEach((node, index) => expect(node).toBe(tail[index]))
    const index = result.layout.findIndex((block) => block.id === old.id)
    const team = data(result.layout[index - 1])
    expect(team.blockType).toBe('teamMembers')
    expect(team.id).toBeUndefined()
    expect(rows(team, 'members').map((member) => [member.name, member.photo])).toEqual([
      ['Kocsis Kata', media.kocsisPortrait],
      ['Kiss Kata', media.kissPortrait],
    ])
    expect(result.changes).toContainEqual(
      expect.objectContaining({ requestId: 'A06', path: '/layout' }),
    )
    expect(planOwnerReviewV1({ ...input, layout: result.layout }).changes).toHaveLength(0)
  })

  it('A06 uses approved canonical portraits when no replacement role was supplied', () => {
    const input = publishedAboutFixture()
    input.mediaByRole = {}
    const team = find(planOwnerReviewV1(freeze(input)).layout, 'teamMembers')
    expect(rows(team, 'members').map((member) => member.photo)).toEqual([9, 10])
  })

  it.each([
    'text',
    'format',
    'duplicate',
    'existing-team',
    'missing-canonical',
    'missing-photo',
    'invalid-photo',
    'anchor',
  ])('A06 leaves the original rich text intact when its guard fails: %s', (variant) => {
    const input = publishedAboutFixture()
    const old = bioBlock(input.layout!)
    if (variant === 'text') rows(children(old.content)[1], 'children')[0].text += ' '
    if (variant === 'format') children(old.content)[0].tag = 'h3'
    if (variant === 'duplicate')
      input.layout!.push({ ...structuredClone(old), id: 'duplicate' } as Block)
    if (variant === 'existing-team')
      input.layout!.push(
        structuredClone(input.canonicalLayout.find((block) => block.blockType === 'teamMembers')!),
      )
    if (variant === 'missing-canonical')
      input.canonicalLayout = input.canonicalLayout.filter(
        (block) => block.blockType !== 'teamMembers',
      )
    if (variant === 'missing-photo') {
      input.mediaByRole = {}
      delete rows(find(input.canonicalLayout, 'teamMembers'), 'members')[0].photo
    }
    if (variant === 'invalid-photo') input.mediaByRole = { ...media, kocsisPortrait: -1 }
    if (variant === 'anchor') data(old.sectionSettings).anchorId = 'elerhetoseg'
    const result = planOwnerReviewV1(freeze(input))
    expect(bioBlock(result.layout)).toBe(old)
    expect(result.changes.some((change) => change.requestId === 'A06')).toBe(false)
  })
})

describe('planOwnerReviewV1: approved canonical pages', () => {
  it('H01/H04/H06/H08/H09/H10/H13 keeps the hand hero, uses editable photo blocks and moves existing blocks', () => {
    const input = fixture('kezdolap')
    const before = structuredClone(input)
    const oldHero = input.layout![0]
    const oldFooterCta = find(input.layout!, 'ctaBanner')
    const oldFree = find(input.layout!, 'freeSos')
    const result = planOwnerReviewV1(freeze(input))
    expect(input).toEqual(before)
    expect(result.layout[0]).toBe(oldHero)
    expect(result.layout[1].blockType).toBe('about')
    expect(find(result.layout, 'about').photo).toBe(media.homeFounders)
    expect(find(result.layout, 'freeSos')).toEqual({ ...oldFree, backgroundImage: media.homeSos })
    const courseIndex = result.layout.findIndex((block) => block.blockType === 'courseCards')
    expect(result.layout[courseIndex + 1].blockType).toBe('howItWorks')
    expect(result.layout.some((block) => block.blockType === 'states')).toBe(false)
    expect(rows(find(result.layout, 'services', 'Erre számíthatsz velünk'))).toHaveLength(2)
    const assistance = find(result.layout, 'services', 'Így tudunk segíteni')
    expect(rows(assistance)).toHaveLength(3)
    expect(rows(assistance).map((row) => row.url)).toEqual(
      rows(find(input.layout!, 'services')).map((row) => row.url),
    )
    expect(
      rows(find(result.layout, 'about'), 'stats').find((row) => row.value === '1')?.label,
    ).toBe('közös cél: fájdalommentesség')
    expect(rows(find(result.layout, 'faq'), 'items')).toHaveLength(5)
    expect(find(result.layout, 'ctaBanner')).toBe(oldFooterCta)
    expect(new Set(result.changes.map((item) => item.requestId))).toEqual(
      new Set(['H01', 'H04', 'H06', 'H08', 'H09', 'H10', 'H13']),
    )
    const homeAboutIndex = input.layout!.findIndex((block) => block.blockType === 'about')
    expect(
      result.changes.find((item) => item.requestId === 'H01' && item.path.endsWith('/photo'))?.path,
    ).toBe(`/layout/${homeAboutIndex}/photo`)
  })

  it('S01-S06 updates canonical sections and the verified full course, never prices or custom links', () => {
    const input = fixture('szolgaltatasok')
    const beforeClinic = children(find(input.layout!, 'richText').content)
    const result = planOwnerReviewV1(freeze(input))
    const services = find(result.layout, 'services', 'Így segítünk')
    expect(services.image).toBe(media.servicesJoint)
    expect(find(result.layout, 'welcome').title).toBe(
      'Fáj a kezed, a csuklód, a könyököd vagy a vállad?',
    )
    expect(rows(services)[1].url).toBe(input.completeCourseHref)
    expect(rows(services)[1].felirat).toBe('Nézd meg a teljes kurzust')
    expect(rows(services)[0]).toEqual(rows(find(input.layout!, 'services'))[0])
    const clinic = children(find(result.layout, 'richText').content)
    expect(clinic.slice(2)).toEqual(beforeClinic.slice(5))
    expect(rows(find(result.layout, 'services', 'Ezért fogod imádni'))).toHaveLength(2)
    expect(result.skips).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ requestId: 'S04', code: 'shared-photo' }),
        expect.objectContaining({ requestId: 'S06', code: 'accordion-snapshot-required' }),
      ]),
    )
  })

  it('A01/A02/A03/A05 keeps both complete biographies and adds distinct editable upload nodes', () => {
    const input = fixture('rolunk')
    const before = structuredClone(input)
    const oldItems = rows(find(input.layout!, 'accordion'), 'items')
    const result = planOwnerReviewV1(freeze(input))
    expect(input).toEqual(before)
    const about = find(result.layout, 'about')
    expect(about.photo).toBe(media.aboutPhoto)
    expect(rows(about, 'paragraphs')).toHaveLength(2)
    expect(rows(find(result.layout, 'services', 'Amiben mások vagyunk'))).toHaveLength(2)
    const nextItems = rows(find(result.layout, 'accordion'), 'items')
    for (const [index, role] of (['kocsisPortrait', 'kissPortrait'] as const).entries()) {
      const nextNodes = children(nextItems[index].tartalom)
      expect(nextNodes[0]).toEqual(
        expect.objectContaining({
          type: 'upload',
          version: 3,
          relationTo: 'media',
          value: media[role],
          format: '',
          id: expect.any(String),
        }),
      )
      expect(nextNodes.slice(1)).toEqual(children(oldItems[index].tartalom))
      expect(nextItems[index].cim).toBe(oldItems[index].cim)
      expect(nextItems[index].osszefoglalo).toBe(oldItems[index].osszefoglalo)
    }
    expect(children(nextItems[0].tartalom)[0].id).not.toBe(children(nextItems[1].tartalom)[0].id)
    expect(find(result.layout, 'teamMembers')).toBe(find(input.layout!, 'teamMembers'))
  })

  it('C02 only shortens the canonical contact heading', () => {
    const input = fixture('kapcsolat')
    const result = planOwnerReviewV1(freeze(input))
    expect(result.layout[0]).toBe(input.layout![0])
    expect(result.layout[1]).toEqual({ ...input.layout![1], title: 'Beszéljünk' })
    expect(result.changes).toHaveLength(1)
  })

  it.each<OwnerReviewSlug>(['kezdolap', 'szolgaltatasok', 'rolunk', 'kapcsolat'])(
    '%s: two runs are idempotent and neither input is mutated',
    (slug) => {
      const input = fixture(slug)
      const first = planOwnerReviewV1(freeze(input))
      const secondInput = freeze({ ...input, layout: first.layout })
      const second = planOwnerReviewV1(secondInput)
      expect(second.changes).toEqual([])
      expect(second.layout).toEqual(first.layout)
      expect(second.layout).toBe(first.layout)
      expect(getPayload).not.toHaveBeenCalled()
    },
  )
})

describe('exact-match safety', () => {
  it('does not expose mutable canonical replacement objects between independent plans', () => {
    const first = planOwnerReviewV1(fixture('kezdolap'))
    rows(find(first.layout, 'faq'), 'items')[0].answer = 'Csak az első eredmény szerkesztése.'
    rows(find(first.layout, 'about'), 'paragraphs')[0].text =
      'Csak az első bemutatkozás szerkesztése.'
    const second = planOwnerReviewV1(fixture('kezdolap'))
    expect(rows(find(second.layout, 'faq'), 'items')[0].answer).not.toContain('Csak az első')
    expect(rows(find(second.layout, 'about'), 'paragraphs')[0].text).not.toContain('Csak az első')
  })

  it('H13 retains both approved clinical safety constraints in a dedicated fifth question', () => {
    const input = fixture('kezdolap')
    const oldFaq = rows(find(input.canonicalLayout, 'faq'), 'items')
    const consent =
      'Műtét után mindig a kezelőorvosod vagy gyógytornászod jóváhagyásával kezdj bele.'
    const stop = 'éles fájdalom esetén hagyd abba, és kérj szakmai segítséget.'
    expect(oldFaq[0].answer).toContain(consent)
    expect(oldFaq[1].answer).toContain(stop)

    const result = planOwnerReviewV1(freeze(input))
    const faq = rows(find(result.layout, 'faq'), 'items')
    expect(faq).toHaveLength(5)
    expect(faq[4].answer).toBe(
      `${consent} Éles fájdalom esetén hagyd abba, és kérj szakmai segítséget.`,
    )
    expect(faq[4].question).toBe('Mire figyeljek a gyakorlatok előtt és közben?')
  })

  it('H13 upgrades only the exact previous four-question owner output and is idempotent', () => {
    const input = fixture('kezdolap')
    const planned = planOwnerReviewV1(input)
    const priorItems = rows(find(planned.layout, 'faq'), 'items').slice(0, 4)
    priorItems.forEach((row, index) => {
      row.id = `prior-owner-faq-${index}`
    })
    find(input.layout!, 'faq').items = priorItems
    const first = planOwnerReviewV1(freeze(input))
    const nextItems = rows(find(first.layout, 'faq'), 'items')
    expect(nextItems).toHaveLength(5)
    expect(nextItems.slice(0, 4)).toEqual(priorItems)
    const second = planOwnerReviewV1(freeze({ ...input, layout: first.layout }))
    expect(second.changes).toEqual([])
    expect(second.layout).toBe(first.layout)
  })

  it.each(['old-canonical', 'prior-owner'])(
    'H13 preserves staff-edited answers on %s content',
    (version) => {
      const input = fixture('kezdolap')
      if (version === 'prior-owner') {
        find(input.layout!, 'faq').items = rows(
          find(planOwnerReviewV1(input).layout, 'faq'),
          'items',
        ).slice(0, 4)
      }
      const faq = find(input.layout!, 'faq')
      rows(faq, 'items')[0].answer = 'Szerkesztő által jóváhagyott egyedi válasz.'
      const result = planOwnerReviewV1(freeze(input))
      expect(find(result.layout, 'faq')).toBe(faq)
      expect(result.skips).toContainEqual(
        expect.objectContaining({ requestId: 'H13', code: 'editor-change' }),
      )
    },
  )

  it('H01 makes both canonical personalization fields explicitly clinic-specific', () => {
    const input = fixture('kezdolap')
    const result = planOwnerReviewV1(freeze(input))
    expect(find(result.layout, 'about').feature).toEqual({
      label: 'Személyre szabott rendelői kezelések',
      note: 'A rendelői kezelési tervet a panaszaidhoz és a terhelhetőségedhez igazítjuk.',
    })
    expect(result.changes).toContainEqual(
      expect.objectContaining({ requestId: 'H01', path: '/layout/9/feature/label' }),
    )
  })

  it.each(['label', 'note'])('H01 preserves an editor-customized feature %s', (key) => {
    const input = fixture('kezdolap')
    data(find(input.layout!, 'about').feature)[key] = 'Saját rendelői tájékoztatás'
    const result = planOwnerReviewV1(freeze(input))
    expect(data(find(result.layout, 'about').feature)[key]).toBe('Saját rendelői tájékoztatás')
    expect(result.skips).toContainEqual(
      expect.objectContaining({
        requestId: 'H01',
        code: 'editor-change',
        path: `/layout/9/feature/${key}`,
      }),
    )
  })

  it('H10 changes only the old practice instruction, retaining reordered steps and IDs', () => {
    const input = fixture('kezdolap')
    const steps = rows(find(input.layout!, 'howItWorks'), 'steps')
    steps.reverse()
    steps[0].id = 'practice-step'
    const result = planOwnerReviewV1(freeze(input))
    const nextSteps = rows(find(result.layout, 'howItWorks'), 'steps')
    expect(nextSteps[0]).toEqual({
      ...steps[0],
      text: 'Kövesd a videók útmutatását, és gyakorolj a saját tempódban.',
    })
    expect(nextSteps.slice(1)).toEqual(steps.slice(1))
    expect(result.changes).toContainEqual(
      expect.objectContaining({ requestId: 'H10', path: '/layout/10/steps/0/text' }),
    )
  })

  it.each(['custom-text', 'renamed', 'duplicate', 'missing'])(
    'H10 does not guess a changed practice step: %s',
    (mode) => {
      const input = fixture('kezdolap')
      const how = find(input.layout!, 'howItWorks')
      const steps = rows(how, 'steps')
      if (mode === 'custom-text') steps[2].text = 'Saját gyakorlási útmutatás.'
      if (mode === 'renamed') steps[2].title = 'Saját lépés'
      if (mode === 'duplicate') steps.push({ ...steps[2] })
      if (mode === 'missing') steps.pop()
      const result = planOwnerReviewV1(freeze(input))
      expect(find(result.layout, 'howItWorks').steps).toBe(steps)
      expect(result.skips).toContainEqual(
        expect.objectContaining({
          requestId: 'H10',
          code: mode === 'custom-text' ? 'editor-change' : 'step-not-unique',
        }),
      )
    },
  )

  it('keeps the actual canonical price-list heading and every following node unchanged, with an h2 clinic heading', () => {
    const input = fixture('szolgaltatasok')
    const oldNodes = children(find(input.canonicalLayout, 'richText').content)
    expect(oldNodes[5]).toMatchObject({
      type: 'heading',
      tag: 'h3',
      children: [expect.objectContaining({ text: 'Árlista – gyógytorna / manuálterápia' })],
    })
    const originalNodes = children(find(input.layout!, 'richText').content)
    const result = planOwnerReviewV1(freeze(input))
    const nextNodes = children(find(result.layout, 'richText').content)
    expect(nextNodes[0]).toMatchObject({
      type: 'heading',
      tag: 'h2',
      children: [expect.objectContaining({ text: 'Rendelői kezelések' })],
    })
    expect(nextNodes.slice(2)).toEqual(oldNodes.slice(5))
    expect(nextNodes).toHaveLength(oldNodes.length - 3)
    for (const [index, node] of originalNodes.slice(5).entries()) {
      expect(nextNodes[index + 2]).toBe(node)
    }
  })

  it.each(['javascript:alert(1)', '   ', '//elsewhere.test/program'])(
    'keeps states if an existing replacement CTA is unsafe or empty: %s',
    (url) => {
      const input = fixture('kezdolap')
      rows(find(input.layout!, 'services'))[0].url = url
      const result = planOwnerReviewV1(freeze(input))
      expect(find(result.layout, 'states')).toBe(find(input.layout!, 'states'))
      expect(result.skips).toContainEqual(
        expect.objectContaining({ requestId: 'H08', code: 'missing-service-links' }),
      )
    },
  )

  it('preserves existing Lexical node IDs when prepending a biography portrait', () => {
    const input = fixture('rolunk')
    const items = rows(find(input.layout!, 'accordion'), 'items')
    children(items[0].tartalom)[0].id = 'existing-lexical-node'
    const before = structuredClone(items[0].tartalom)
    const result = planOwnerReviewV1(freeze(input))
    const next = rows(find(result.layout, 'accordion'), 'items')[0]
    expect(children(next.tartalom).slice(1)).toEqual(children(before))
  })

  it.each([undefined, null, [] as Layout])('does not seed a missing layout (%s)', (layout) => {
    const result = planOwnerReviewV1({ ...fixture('kezdolap'), layout })
    expect(result.layout).toEqual([])
    expect(result.changes).toEqual([])
    expect(result.skips.length).toBeGreaterThan(0)
  })

  it('preserves unrelated and unknown blocks, row IDs, names and section settings', () => {
    const input = fixture('kezdolap')
    const unknown = {
      blockType: 'futureBlock',
      id: 'future',
      content: { answer: 42 },
    } as unknown as Block
    input.layout!.splice(2, 0, unknown)
    const usp = find(input.layout!, 'usps')
    usp.blockName = 'Saját szerkesztői név'
    usp.sectionSettings = { visible: false, anchorId: 'sajat-horgony', hatter: 'tint' }
    const about = find(input.layout!, 'about')
    rows(about, 'paragraphs').forEach((row, index) => {
      row.id = `paragraph-${index}`
    })
    rows(find(input.layout!, 'faq'), 'items').forEach((row, index) => {
      row.id = `faq-${index}`
    })
    const result = planOwnerReviewV1(freeze(input))
    expect(result.layout.find((block) => block.id === 'future')).toBe(unknown)
    const next = find(result.layout, 'services', 'Erre számíthatsz velünk')
    expect(next.id).toBe(usp.id)
    expect(next.blockName).toBe(usp.blockName)
    expect(next.sectionSettings).toEqual(usp.sectionSettings)
    expect(rows(find(result.layout, 'about'), 'paragraphs').map((row) => row.id)).toEqual([
      'paragraph-0',
      'paragraph-1',
    ])
    expect(rows(find(result.layout, 'faq'), 'items').map((row) => row.id)).toEqual([
      'faq-0',
      'faq-1',
      'faq-2',
      'faq-3',
      undefined,
    ])
  })

  it('preserves custom copy, a custom photo and a custom USP field', () => {
    const input = fixture('kezdolap')
    const about = find(input.layout!, 'about')
    rows(about, 'paragraphs')[0].text = 'Szerkesztői bevezető'
    about.photo = 9999
    const usp = find(input.layout!, 'usps')
    usp.customEditorField = 'marad'
    const faq = find(input.layout!, 'faq')
    rows(faq, 'items').push({ question: 'Saját kérdés?', answer: 'Saját válasz.' })
    const result = planOwnerReviewV1(freeze(input))
    expect(find(result.layout, 'about').paragraphs).toBe(about.paragraphs)
    expect(find(result.layout, 'about').photo).toBe(9999)
    expect(find(result.layout, 'usps')).toBe(usp)
    expect(find(result.layout, 'faq')).toBe(faq)
    expect(
      result.skips.filter((item) => item.code === 'editor-change').length,
    ).toBeGreaterThanOrEqual(4)
  })

  it('accepts populated media only when the exact old ID matches; does not overwrite custom Media', () => {
    const input = fixture('kezdolap')
    find(input.layout!, 'about').photo = { id: 1, filename: 'legacy.webp', alt: 'Régi kép' }
    find(input.layout!, 'freeSos').backgroundImage = {
      id: 9999,
      filename: 'sos-hands-board.jpg',
      alt: 'Saját kép',
    }
    const result = planOwnerReviewV1(freeze(input))
    expect(find(result.layout, 'about').photo).toBe(media.homeFounders)
    expect(find(result.layout, 'freeSos').backgroundImage).toEqual(
      find(input.layout!, 'freeSos').backgroundImage,
    )
  })

  it.each([undefined, 0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'does not convert the USP or overwrite a photo for invalid media %s',
    (id) => {
      const input = fixture('kezdolap')
      input.mediaByRole = { homeFounders: id, homeExpectations: id }
      const result = planOwnerReviewV1(freeze(input))
      expect(find(result.layout, 'about').photo).toBe(1)
      expect(find(result.layout, 'usps')).toBe(find(input.layout!, 'usps'))
      expect(result.skips.some((item) => item.code === 'missing-media')).toBe(true)
    },
  )

  it('rejects ambiguous blocks and duplicate IDs', () => {
    const input = fixture('kezdolap')
    const about = find(input.layout!, 'about')
    input.layout!.push({ ...about, id: 'second-founder' } as Block)
    const services = find(input.layout!, 'services')
    services.id = input.layout![0].id
    const result = planOwnerReviewV1(freeze(input))
    expect(result.layout.filter((block) => block.blockType === 'about')).toEqual(
      input.layout!.filter((block) => block.blockType === 'about'),
    )
    expect(find(result.layout, 'states')).toBe(find(input.layout!, 'states'))
    expect(result.skips.map((item) => item.code)).toContain('duplicate-id')
    expect(result.skips.map((item) => item.code)).toContain('target-not-unique')
  })

  it('does not select an untitled USP as the renamed target', () => {
    const input = fixture('kezdolap')
    const usp = find(input.layout!, 'usps')
    delete usp.title
    const result = planOwnerReviewV1(freeze(input))
    expect(find(result.layout, 'usps')).toBe(usp)
    expect(result.skips).toContainEqual(
      expect.objectContaining({ requestId: 'H06', code: 'target-not-unique' }),
    )
  })

  it('keeps an editor reorder while still applying independent exact-match fields', () => {
    const input = fixture('kezdolap')
    const welcomeIndex = input.layout!.findIndex((block) => block.blockType === 'welcome')
    const [welcome] = input.layout!.splice(welcomeIndex, 1)
    input.layout!.splice(1, 0, welcome)
    const result = planOwnerReviewV1(freeze(input))
    expect(result.layout[1]).toBe(welcome)
    expect(result.skips).toContainEqual(
      expect.objectContaining({ requestId: 'H01', code: 'editor-order' }),
    )
    expect(result.skips).toContainEqual(
      expect.objectContaining({ requestId: 'H10', code: 'editor-order' }),
    )
    expect(find(result.layout, 'about').photo).toBe(media.homeFounders)
  })

  it.each(['filmHero', 'about', 'howItWorks'])(
    'preserves staff-reordered %s after Payload materializes unset anchors as null',
    (type) => {
      const input = fixture('kezdolap')
      for (const block of input.layout!) {
        const settings = data(block.sectionSettings)
        if (settings.anchorId === undefined) settings.anchorId = null
        data(block).ownerMetadata = { note: null, preserve: ['staff'] }
      }
      const unknown = {
        blockType: 'futureBlock',
        id: 'staff-unknown',
        sectionSettings: { anchorId: null },
        ownerMetadata: { untouched: true },
      } as unknown as Block
      input.layout!.splice(2, 0, unknown)
      const index = input.layout!.findIndex((block) => block.blockType === type)
      const [moved] = input.layout!.splice(index, 1)
      input.layout!.push(moved)
      const before = structuredClone(input)
      const result = planOwnerReviewV1(freeze(input))
      // Canonical states may be removed independently; every retained block must keep its order.
      const retainedIds = new Set(result.layout.map((block) => block.id))
      expect(result.layout.map((block) => block.id)).toEqual(
        input.layout!.filter((block) => retainedIds.has(block.id)).map((block) => block.id),
      )
      expect(input).toEqual(before)
      expect(result.layout.find((block) => block.id === unknown.id)).toBe(unknown)
      for (const blockType of ['filmHero', 'about', 'howItWorks']) {
        const old = find(input.layout!, blockType)
        const next = find(result.layout, blockType)
        expect(next.id).toBe(old.id)
        expect(next.sectionSettings).toBe(old.sectionSettings)
        expect(next.ownerMetadata).toBe(old.ownerMetadata)
      }
      for (const requestId of ['H01', 'H10']) {
        expect(result.skips).toContainEqual(
          expect.objectContaining({ requestId, code: 'editor-order' }),
        )
        expect(
          result.changes.some(
            (change) => change.requestId === requestId && change.path === '/layout',
          ),
        ).toBe(false)
      }
      expect(find(result.layout, 'about').photo).toBe(media.homeFounders)
      expect(planOwnerReviewV1({ ...input, layout: result.layout }).changes).toHaveLength(0)
    },
  )

  it.each(['layout', 'canonicalLayout'] as const)(
    'allows the approved order when only %s has materialized null anchors',
    (key) => {
      const input = fixture('kezdolap')
      for (const block of input[key]!) {
        const settings = data(block.sectionSettings)
        if (settings.anchorId === undefined) settings.anchorId = null
      }
      const result = planOwnerReviewV1(freeze(input))
      expect(result.layout[0].blockType).toBe('filmHero')
      expect(result.layout[1].blockType).toBe('about')
      const courses = result.layout.findIndex((block) => block.blockType === 'courseCards')
      expect(result.layout[courses + 1].blockType).toBe('howItWorks')
      expect(planOwnerReviewV1({ ...input, layout: result.layout }).changes).toHaveLength(0)
    },
  )

  it.each(['', ' ', 'kurzusok '])('does not normalize an explicit course anchor %j', (anchor) => {
    const input = fixture('kezdolap')
    data(find(input.layout!, 'courseCards').sectionSettings).anchorId = anchor
    const result = planOwnerReviewV1(freeze(input))
    expect(find(result.layout, 'courseCards').sectionSettings).toBe(
      find(input.layout!, 'courseCards').sectionSettings,
    )
    expect(
      result.changes.some((change) => change.requestId === 'H10' && change.path === '/layout'),
    ).toBe(false)
    expect(result.skips).toContainEqual(
      expect.objectContaining({ requestId: 'H10', code: 'target-not-unique' }),
    )
  })

  it.each(['text', 'image', 'anchor', 'hidden', 'extra'])(
    'does not delete staff-modified states: %s',
    (edit) => {
      const input = fixture('kezdolap')
      const states = find(input.layout!, 'states')
      if (edit === 'text') rows(states, 'cards')[0].text = 'Saját állapot'
      if (edit === 'image') rows(states, 'cards')[0].image = 9999
      if (edit === 'anchor') data(states.sectionSettings).anchorId = 'megtartando-horgony'
      if (edit === 'hidden') data(states.sectionSettings).visible = false
      if (edit === 'extra') states.unknownField = 'saját adat'
      const result = planOwnerReviewV1(freeze(input))
      expect(find(result.layout, 'states')).toBe(states)
      expect(result.skips).toContainEqual(
        expect.objectContaining({ requestId: 'H08', code: 'editor-change' }),
      )
    },
  )

  it.each(['missing', 'hidden', 'two-rows', 'no-link'])(
    'keeps states without the usable three-panel replacement: %s',
    (mode) => {
      const input = fixture('kezdolap')
      const services = find(input.layout!, 'services')
      if (mode === 'missing')
        input.layout = input.layout!.filter((block) => block.id !== services.id)
      if (mode === 'hidden') data(services.sectionSettings).visible = false
      if (mode === 'two-rows') rows(services).pop()
      if (mode === 'no-link') rows(services)[0].url = ''
      const result = planOwnerReviewV1(freeze(input))
      expect(find(result.layout, 'states')).toBe(find(input.layout!, 'states'))
    },
  )

  it('preserves edited clinic intro, price list and contact data', () => {
    const input = fixture('szolgaltatasok')
    const clinic = find(input.layout!, 'richText')
    children(clinic.content)[1] = {
      type: 'paragraph',
      children: [{ type: 'text', text: 'Saját rendelői ismertető' }],
    }
    const result = planOwnerReviewV1(freeze(input))
    expect(find(result.layout, 'richText')).toBe(clinic)
    expect(find(result.layout, 'teamMembers')).toBe(find(input.layout!, 'teamMembers'))
  })

  it('shortens only the old clinic prefix even if staff edited a price below it', () => {
    const input = fixture('szolgaltatasok')
    const clinic = find(input.layout!, 'richText')
    children(clinic.content)[7] = {
      type: 'paragraph',
      children: [{ type: 'text', text: 'Saját árlista: változatlanul marad.' }],
    }
    const originalTail = children(clinic.content).slice(5)
    const result = planOwnerReviewV1(freeze(input))
    expect(children(find(result.layout, 'richText').content).slice(2)).toEqual(originalTail)
  })

  it.each([
    undefined,
    '/kurzusok',
    '/kurzusok/sos-kezrelax-2',
    '/kurzusok/teljes?admin=1',
    '//elsewhere.test/kurzusok/x',
    'https://elsewhere.test/kurzusok/x',
  ])('requires an explicit full-course URL (%s)', (completeCourseHref) => {
    const input = { ...fixture('szolgaltatasok'), completeCourseHref }
    const result = planOwnerReviewV1(freeze(input))
    expect(rows(find(result.layout, 'services', 'Így segítünk'))[1].url).toBe('/kurzusok')
    expect(result.skips).toContainEqual(
      expect.objectContaining({ requestId: 'S06', code: 'missing-paid-course' }),
    )
  })

  it.each(['url', 'felirat'])('preserves a custom full-course link pair when %s changed', (key) => {
    const input = fixture('szolgaltatasok')
    const serviceRows = rows(find(input.layout!, 'services'))
    serviceRows[1][key] = key === 'url' ? '/kurzusok/sajat-program' : 'Saját felirat'
    const result = planOwnerReviewV1(freeze(input))
    const next = rows(find(result.layout, 'services', 'Így segítünk'))[1]
    expect(next.url).toBe(serviceRows[1].url)
    expect(next.felirat).toBe(serviceRows[1].felirat)
  })

  it('matches biographies by exact name even when items are reordered and preserves a staff-edited CV', () => {
    const input = fixture('rolunk')
    const items = rows(find(input.layout!, 'accordion'), 'items')
    items.reverse()
    children(items[1].tartalom).push({
      type: 'paragraph',
      children: [{ type: 'text', text: 'Új szakmai eredmény' }],
    })
    const oldKocsis = items[1].tartalom
    const result = planOwnerReviewV1(freeze(input))
    const next = rows(find(result.layout, 'accordion'), 'items')
    expect(children(next[0].tartalom)[0].value).toBe(media.kissPortrait)
    expect(next[1].tartalom).toBe(oldKocsis)
  })

  it('does not re-convert or overwrite an editor-customized converted section', () => {
    const input = fixture('kezdolap')
    const first = planOwnerReviewV1(input)
    const usp = find(first.layout, 'services', 'Erre számíthatsz velünk')
    rows(usp)[0].body = 'Saját szöveg az átalakítás után'
    usp.image = 9999
    const second = planOwnerReviewV1(freeze({ ...input, layout: first.layout }))
    expect(find(second.layout, 'services', 'Erre számíthatsz velünk')).toBe(usp)
    expect(second.changes).toHaveLength(0)
  })
})
