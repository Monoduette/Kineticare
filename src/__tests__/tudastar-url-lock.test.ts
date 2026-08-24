import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  LEGACY_GONE_PATHS,
  LEGACY_REDIRECTS,
  LEGACY_SITEMAP_PATHS,
} from '../lib/legacy-redirects'
import { UJ_TUDASTAR_SLUGOK } from '../lib/tudastar/eeat-kapu'

/**
 * URL-LOCK: a két új cikk csak `/blog/<slug>` poszt. Gyökér pages, seedelt
 * published 200 és örökölt átirányítás tilos (a hub később 308).
 */

const GYOKER = UJ_TUDASTAR_SLUGOK.map((slug) => `/${slug}`)

const importer = readFileSync(
  path.join(process.cwd(), 'src/scripts/import-tudastar-cikkek.ts'),
  'utf8',
)
const seed = readFileSync(path.join(process.cwd(), 'src/scripts/seed.ts'), 'utf8')

describe('a két új cikk csak posts, gyökér hub nélkül', () => {
  it('az importer a két slugot posts-ra írja, pages collectionre nem', () => {
    expect(importer).toContain("slug: 'inhuvelygyulladas'")
    expect(importer).toContain("slug: 'befagyott-vall'")
    expect(importer).toContain("collection: 'posts'")
    expect(importer).not.toMatch(/collection:\s*'pages'/)
  })

  it('a seed nem hoz létre gyökér pages rekordot a két slugra', () => {
    for (const slug of UJ_TUDASTAR_SLUGOK) {
      expect(seed).not.toContain(`slug: '${slug}'`)
      expect(seed).not.toContain(`slug: "${slug}"`)
    }
  })

  it('LEGACY_REDIRECTS / GONE / sitemap-örökség nem nyúl a gyökér címekhez', () => {
    const sources = LEGACY_REDIRECTS.map((rule) => rule.source)
    const destinations = LEGACY_REDIRECTS.map((rule) => rule.destination)
    for (const gyoker of GYOKER) {
      expect(sources, gyoker).not.toContain(gyoker)
      expect(destinations, gyoker).not.toContain(gyoker)
      expect(LEGACY_GONE_PATHS, gyoker).not.toContain(gyoker)
      expect(LEGACY_SITEMAP_PATHS, gyoker).not.toContain(gyoker)
    }
  })
})
