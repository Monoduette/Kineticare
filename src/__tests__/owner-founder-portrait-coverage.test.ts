import { describe, expect, it, vi } from 'vitest'

// The approved page builders live in the legacy restore module. Keep this inventory test
// independent from Payload initialization, just like the owner-review planner tests.
vi.mock('../payload.config', () => ({ default: {} }))
vi.mock('payload', () => ({
  getPayload: vi.fn(() => {
    throw new Error('No Payload initialization in owner portrait fixtures')
  }),
}))

import { buildHomeLayout } from '../lib/home-seed'
import {
  planOwnerReviewV1,
  type OwnerReviewMediaRole,
  type OwnerReviewSlug,
} from '../lib/owner-review-v1'
import type { Page } from '../payload-types'
import {
  buildKapcsolatLayout,
  buildRolunkLayout,
  buildSzolgaltatasokLayout,
} from '../scripts/restore-legacy-content'

type Layout = NonNullable<Page['layout']>

const HOME_FOUNDERS = 101
const KOCSIS_PORTRAIT = 31
const KISS_PORTRAIT = 32

const homeMedia = {
  'katak-team.jpg': 1,
  'sos-hands-board.jpg': 2,
  'services-hands.png': 3,
  'state-zart.png': 4,
  'state-nyilo.png': 5,
  'state-nyitott.png': 6,
}

const pageMedia = {
  rolunkFoto: 21,
  szolgaltatasokKep: 22,
  kocsisPortre: KOCSIS_PORTRAIT,
  kissPortre: KISS_PORTRAIT,
}

const approvedMedia: Record<OwnerReviewMediaRole, number> = {
  homeFounders: HOME_FOUNDERS,
  homeSos: 102,
  homeExpectations: 103,
  homeServices: 104,
  servicesJoint: 105,
  servicesBenefits: 106,
  aboutDifference: 107,
  aboutPhoto: 108,
  kocsisPortrait: KOCSIS_PORTRAIT,
  kissPortrait: KISS_PORTRAIT,
}

const canonicalLayouts: Record<OwnerReviewSlug, Layout> = {
  kezdolap: buildHomeLayout(homeMedia),
  szolgaltatasok: buildSzolgaltatasokLayout(pageMedia),
  rolunk: buildRolunkLayout(pageMedia),
  kapcsolat: buildKapcsolatLayout(pageMedia),
}

function plannedLayout(slug: OwnerReviewSlug): Layout {
  const canonicalLayout = canonicalLayouts[slug]
  return planOwnerReviewV1({
    slug,
    canonicalLayout,
    layout: structuredClone(canonicalLayout).map((block, index) => ({
      ...block,
      id: `${slug}-${index}`,
    })),
    mediaByRole: approvedMedia,
    completeCourseHref: '/kurzusok/otthoni-kezrehab-program',
  }).layout
}

interface NamedIntroduction {
  page: OwnerReviewSlug
  founder: 'Kiss Kata és Kocsis Kata' | 'Kocsis Kata' | 'Kiss Kata'
  kind: 'joint' | 'individual'
  photo: unknown
}

function namedIntroductions(page: OwnerReviewSlug, layout: Layout): NamedIntroduction[] {
  return layout.flatMap((block): NamedIntroduction[] => {
    // A kezdőlapi About a két alapító közös bemutatkozása: a címe 2026-09-07-től
    // „Megérdemled a profi törődést” (WP18; a WP37 óta a /rolunk saját címet
    // visel), ezért a közös bemutatkozást a blokk helye azonosítja, nem a
    // nevek a címben.
    if (
      block.blockType === 'about' &&
      (page === 'kezdolap' ||
        (block.title?.includes('Kiss Kata') && block.title.includes('Kocsis Kata')))
    ) {
      return [{ page, founder: 'Kiss Kata és Kocsis Kata', kind: 'joint', photo: block.photo }]
    }
    if (block.blockType !== 'teamMembers') return []
    return (block.members ?? []).flatMap((member) =>
      member.name === 'Kocsis Kata' || member.name === 'Kiss Kata'
        ? [{ page, founder: member.name, kind: 'individual', photo: member.photo }]
        : [],
    )
  })
}

describe('A06: canonical founder portrait inventory', () => {
  it('maps every named introduction on all four approved layouts to the correct existing photo', () => {
    const inventory = (Object.keys(canonicalLayouts) as OwnerReviewSlug[]).flatMap((page) =>
      namedIntroductions(page, plannedLayout(page)),
    )

    expect(inventory).toEqual([
      {
        page: 'kezdolap',
        founder: 'Kiss Kata és Kocsis Kata',
        kind: 'joint',
        // A H01 csak a régi című About-ra cserél fotót; a kanonikus seed
        // (új cím, WP18) a saját közös alapítói fotóját viszi (katak-team.jpg).
        photo: homeMedia['katak-team.jpg'],
      },
      {
        page: 'szolgaltatasok',
        founder: 'Kocsis Kata',
        kind: 'individual',
        photo: KOCSIS_PORTRAIT,
      },
      {
        page: 'szolgaltatasok',
        founder: 'Kiss Kata',
        kind: 'individual',
        photo: KISS_PORTRAIT,
      },
      {
        page: 'rolunk',
        founder: 'Kocsis Kata',
        kind: 'individual',
        photo: KOCSIS_PORTRAIT,
      },
      {
        page: 'rolunk',
        founder: 'Kiss Kata',
        kind: 'individual',
        photo: KISS_PORTRAIT,
      },
      {
        page: 'kapcsolat',
        founder: 'Kocsis Kata',
        kind: 'individual',
        photo: KOCSIS_PORTRAIT,
      },
      {
        page: 'kapcsolat',
        founder: 'Kiss Kata',
        kind: 'individual',
        photo: KISS_PORTRAIT,
      },
    ])
  })
})
