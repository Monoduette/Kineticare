import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'
import type { Payload } from 'payload'

import {
  faqMezoAPayloadba,
  felhasznaloIdNevVagyEmailAlapjan,
  szerzokExtraMezok,
} from '../lib/tudastar/import-geo'
import { faqMezore } from '../lib/tudastar/faq'
import { UJ_TUDASTAR_SLUGOK } from '../lib/tudastar/eeat-kapu'

/**
 * Search GEO lock a két ÚJ posztra: Person author + faq, noindex-fallback,
 * a hat élő poszt érintetlen. Collection-szintű noindex mező nincs.
 */

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

function usersPayload(docs: { name?: string; email?: string; id: number }[]): Payload {
  return {
    find: async ({ where }: { where?: Record<string, { equals?: string }> }) => {
      const nameEq = where?.name?.equals
      const emailEq = where?.email?.equals
      const talalt =
        (typeof nameEq === 'string' ? docs.find((doc) => doc.name === nameEq) : undefined) ??
        (typeof emailEq === 'string' ? docs.find((doc) => doc.email === emailEq) : undefined)
      return { docs: talalt === undefined ? [] : [talalt] }
    },
  } as unknown as Payload
}

describe('faqMezoAPayloadba — a hat élő posztot nem backfill-eli', () => {
  it('az új slugokra kiírja a faq tömböt', () => {
    for (const slug of UJ_TUDASTAR_SLUGOK) {
      expect(faqMezoAPayloadba(slug, gyik)).toEqual({ faq: gyik })
      expect(faqMezore(slug)?.length).toBeGreaterThanOrEqual(2)
    }
  })

  it('az élő hat slugra üres objektum, még ha van is tétel a faq.ts-ben', () => {
    for (const slug of ELO_SLUGOK) {
      expect(faqMezoAPayloadba(slug, gyik)).toEqual({})
      expect(faqMezoAPayloadba(slug, faqMezore(slug))).toEqual({})
    }
  })
})

describe('szerzokExtraMezok — hiányzó user nem kitalált, nem dob', () => {
  it('Kiss Kata → author, Kocsis Kata → reviewedBy', async () => {
    const payload = usersPayload([
      { id: 11, name: 'Kiss Kata' },
      { id: 12, name: 'Kocsis Kata' },
    ])
    const extra = await szerzokExtraMezok(payload, ['Kiss Kata', 'Kocsis Kata'])
    expect(extra).toEqual({ author: 11, reviewedBy: 12, hianyzok: [] })
  })

  it('hiányzó usernél author null, hianyzok listázva, nem dob', async () => {
    const extra = await szerzokExtraMezok(usersPayload([]), ['Kiss Kata', 'Kocsis Kata'])
    expect(extra.author).toBeNull()
    expect(extra.reviewedBy).toBeUndefined()
    expect(extra.hianyzok).toEqual(['Kiss Kata', 'Kocsis Kata'])
  })

  it('e-mail alapján is megtalál, ha a név üres', async () => {
    const payload = usersPayload([{ id: 21, email: 'kata@example.test' }])
    const id = await felhasznaloIdNevVagyEmailAlapjan(payload, 'Kiss Kata', 'kata@example.test')
    expect(id).toBe(21)
  })
})

describe('Posts collection — nincs noindex mező', () => {
  it('a Posts.ts nem ad collection-szintű noindex mezőt', () => {
    const forras = readFileSync(path.join(process.cwd(), 'src/collections/Posts.ts'), 'utf8')
    expect(forras).not.toMatch(/name:\s*'noindex'/)
  })
})

describe('importer a két új slugra Person usert keres, a hat élőre nem', () => {
  it('a CIKKEK lista csak az új slugokra tölti a szerzok kulcsot', () => {
    const forras = readFileSync(
      path.join(process.cwd(), 'src/scripts/import-tudastar-cikkek.ts'),
      'utf8',
    )
    expect(forras).not.toContain('cikk author/reviewedBy mezője így nem tölthető')
    expect(forras).toContain('szerzokExtraMezok')
    expect(forras).toContain('faqMezoAPayloadba')
    expect(forras).toContain("szerzok: ['Kiss Kata', 'Kocsis Kata']")
    for (const slug of ELO_SLUGOK) {
      expect(forras).toContain(`slug: '${slug}'`)
    }
  })
})
