import { describe, expect, it } from 'vitest'

import { ujTudastarPostNoindex, ujTudastarSlug } from '../lib/tudastar/eeat-kapu'

const ELO_SLUGOK = [
  'miert-zsibbad-a-kezem',
  'keztoalagut-szindroma',
  'teniszkonyok',
  'pattano-ujj',
  'csuklo-es-kezfajdalom',
  'csuklotores-utani-gyogytorna',
] as const

const gyik = [
  { question: 'Mennyi ideig tarthat?', answer: 'A lefolyás egyéni.' },
  { question: 'Mikor kell orvoshoz menni?', answer: 'Ha a panasz nem múlik.' },
]

describe('ujTudastarSlug', () => {
  it('csak a két új slugra igaz', () => {
    expect(ujTudastarSlug('inhuvelygyulladas')).toBe(true)
    expect(ujTudastarSlug('befagyott-vall')).toBe(true)
    for (const slug of ELO_SLUGOK) {
      expect(ujTudastarSlug(slug)).toBe(false)
    }
  })
})

describe('ujTudastarPostNoindex', () => {
  it('az élő hat slugot author/faq nélkül sem noindexeli', () => {
    for (const slug of ELO_SLUGOK) {
      expect(ujTudastarPostNoindex({ slug, author: null, faq: [] })).toBe(false)
      expect(ujTudastarPostNoindex({ slug })).toBe(false)
    }
  })

  it('az új slugot üres faq vagy hiányzó Person author mellett noindexeli', () => {
    expect(
      ujTudastarPostNoindex({
        slug: 'inhuvelygyulladas',
        author: { id: 3, name: 'Kiss Kata' },
        faq: [],
      }),
    ).toBe(true)
    expect(
      ujTudastarPostNoindex({
        slug: 'befagyott-vall',
        author: null,
        faq: gyik,
      }),
    ).toBe(true)
    expect(
      ujTudastarPostNoindex({
        slug: 'inhuvelygyulladas',
        author: { type: 'Organization', name: 'Kineticare' },
        faq: gyik,
      }),
    ).toBe(true)
  })

  it('az új slugot Person authorral és legalább két faq-tétellel indexeli', () => {
    expect(
      ujTudastarPostNoindex({
        slug: 'inhuvelygyulladas',
        author: { id: 3, name: 'Kiss Kata' },
        faq: gyik,
      }),
    ).toBe(false)
    expect(
      ujTudastarPostNoindex({
        slug: 'befagyott-vall',
        author: 7,
        faq: gyik,
      }),
    ).toBe(false)
  })
})
