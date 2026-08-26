import { describe, expect, it } from 'vitest'

import { buildStaticPageMetadata } from '../lib/seo'

/**
 * Őr a nyilvános oldalak megosztási metaadatára.
 * A `/blog` `generateMetadata`-ja csak `title`-t és `description`-t adott,
 * `openGraph` blokkot nem. A Next ilyenkor a keret-layout OG-jére esik vissza,
 * ezért a Tudástár megosztva SZÓ SZERINT a kezdőlap címét mutatta
 * („Kineticare — Kézrehabilitációs online kurzusplatform”), és `og:url` sem
 */
describe('buildStaticPageMetadata', () => {
  it('a megosztási cím és leírás megegyezik a lap sajátjával', () => {
    const meta = buildStaticPageMetadata({
      title: 'Tudástár',
      description: 'Kézrehabilitációs cikkek.',
      path: '/blog',
    })
    expect(meta.title).toBe('Tudástár')
    expect(meta.openGraph?.title).toBe('Tudástár')
    expect(meta.openGraph?.description).toBe('Kézrehabilitációs cikkek.')
  })

  it('az og:url ABSZOLÚT cím, a canonical viszont relatív marad', () => {
    const meta = buildStaticPageMetadata({
      title: 'Kurzusok',
      description: 'Leírás.',
      path: '/kurzusok',
    })
    const url = meta.openGraph?.url
    expect(String(url)).toMatch(/^https?:\/\/.+\/kurzusok$/)
    expect(meta.alternates?.canonical).toBe('/kurzusok')
    expect('keywords' in meta).toBe(false)
  })

  it('opcionális keywords csak akkor kerül a metadatokba, ha van kifejezés', () => {
    const ures = buildStaticPageMetadata({
      title: 'Kurzusok',
      description: 'Leírás.',
      path: '/kurzusok',
      keywords: [],
    })
    expect('keywords' in ures).toBe(false)
    const kitoltott = buildStaticPageMetadata({
      title: 'Kurzusok',
      description: 'Leírás.',
      path: '/kurzusok',
      keywords: ['otthoni gyógytorna', 'kéztorna', 'kéztorna gyakorlatok'],
    })
    expect(kitoltott.keywords).toEqual(['otthoni gyógytorna', 'kéztorna', 'kéztorna gyakorlatok'])
  })

  it('a lap címe SOSEM eshet vissza a kezdőlapéra', () => {
    // Ez a konkrét regresszió: a Tudástár megosztva a kezdőlap címét mutatta.
    const meta = buildStaticPageMetadata({
      title: 'Tudástár',
      description: 'Kézrehabilitációs cikkek.',
      path: '/blog',
    })
    expect(meta.openGraph?.title).not.toContain('Kézrehabilitációs online kurzusplatform')
  })
})
