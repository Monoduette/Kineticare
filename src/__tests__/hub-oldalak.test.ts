/**
 * Gyökér tünet-hubok (klaszterek) — a hub-térkép és a fordítási lánc őrei.
 *
 * Mit őrzünk és miért:
 *  1. A HUB_OLDALAK ↔ CIKKEK párosítás: a hub törzse KIZÁRÓLAG lektorált
 *     cikk-markdownból jöhet. Egy elgépelt fájlnév vagy slug némán üres/rossz
 *     hubot szülne — itt hangosan bukik.
 *  2. Slug-ütközések: hub nem állhat meglévő route-ra vagy CMS-oldalra
 *     (HUB_TILTOTT_SLUGOK), és a `de-quervain-szindroma` tiltása itt is áll.
 *  3. Az átirányítás-döntés (hubAtiranyitasCel) tiszta függvény: piszkozat-hub
 *     SOHA nem irányít át, publikált hub mindig — DB nélkül tesztelve.
 *  4. A teljes fordítási lánc (hubokatFordit): mind a 8 hub forrása lefordul,
 *     mért SEO-céllal és 2–6 tételes GYIK-kel. Ez ugyanaz a garancia, amit a
 *     cikk-importer ad a posts-oldalon.
 */
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  HUB_OLDALAK,
  HUB_TILTOTT_SLUGOK,
  hubAtiranyitasCel,
  hubSlugForPost,
} from '../lib/tudastar/hub-oldalak'
import { CIKKEK } from '../scripts/import-tudastar-cikkek'
import { hubokatFordit } from '../scripts/import-hub-oldalak'
import { GYIK_MAX, GYIK_MIN } from '../lib/tudastar/faq'

const cikkekDir = path.join(process.cwd(), 'docs', 'cikkek')

describe('HUB_OLDALAK térkép', () => {
  it('pontosan 8 hub van, és minden slug egyedi', () => {
    expect(HUB_OLDALAK).toHaveLength(8)
    const slugok = HUB_OLDALAK.map((hub) => hub.slug)
    expect(new Set(slugok).size).toBe(slugok.length)
  })

  it('minden hub forrása a CIKKEK egy létező (fajl, slug) párja', () => {
    const parok = new Map(CIKKEK.map((cikk) => [cikk.slug, cikk.fajl]))
    for (const hub of HUB_OLDALAK) {
      expect(parok.get(hub.cikkSlug), `ismeretlen cikkSlug: ${hub.cikkSlug}`).toBe(hub.cikkFajl)
    }
  })

  it('minden cikkhez legfeljebb egy hub tartozik', () => {
    const cikkSlugok = HUB_OLDALAK.map((hub) => hub.cikkSlug)
    expect(new Set(cikkSlugok).size).toBe(cikkSlugok.length)
  })

  it('hub nem ütközik tiltott sluggal (meglévő route, CMS-oldal, de quervain)', () => {
    const tiltott = new Set(HUB_TILTOTT_SLUGOK)
    for (const hub of HUB_OLDALAK) {
      expect(tiltott.has(hub.slug), `tiltott hub-slug: ${hub.slug}`).toBe(false)
    }
  })

  it('a kez-zsibbadas hub a miert-zsibbad-a-kezem cikkből épül (H-ZS fej)', () => {
    expect(hubSlugForPost('miert-zsibbad-a-kezem')).toBe('kez-zsibbadas')
  })

  it('vallfajdalom hub SZÁNDÉKOSAN nincs: lektorált orvosi törzs nélkül nem építünk', () => {
    expect(HUB_OLDALAK.some((hub) => hub.slug === 'vallfajdalom')).toBe(false)
  })
})

describe('hubAtiranyitasCel', () => {
  it('publikált hub mellett a cikk a gyökérre irányít', () => {
    expect(hubAtiranyitasCel('teniszkonyok', new Set(['teniszkonyok']))).toBe('/teniszkonyok')
    expect(hubAtiranyitasCel('miert-zsibbad-a-kezem', new Set(['kez-zsibbadas']))).toBe(
      '/kez-zsibbadas',
    )
  })

  it('piszkozat (nem publikált) hub mellett a cikk él tovább — nincs átirányítás', () => {
    expect(hubAtiranyitasCel('teniszkonyok', new Set<string>())).toBeNull()
    expect(hubAtiranyitasCel('teniszkonyok', new Set(['rolunk', 'szolgaltatasok']))).toBeNull()
  })

  it('hub nélküli slugnál soha nincs átirányítás', () => {
    expect(hubSlugForPost('nem-letezo-cikk')).toBeNull()
    expect(hubAtiranyitasCel('nem-letezo-cikk', new Set(['teniszkonyok']))).toBeNull()
  })
})

describe('hubokatFordit — a teljes fordítási lánc', () => {
  const forditott = hubokatFordit(cikkekDir)

  it('mind a 8 hub lefordul, hub-sluggal és nem üres címmel/törzzsel', () => {
    expect(forditott).toHaveLength(8)
    for (const hub of forditott) {
      expect(hub.slug.length).toBeGreaterThan(0)
      expect(hub.cikk.title.length).toBeGreaterThan(0)
      expect(hub.cikk.szoszam).toBeGreaterThan(300)
    }
  })

  it('minden hub SEO-célja a mért táblából jön (nem üres cím, leírás, kulcsszó)', () => {
    for (const hub of forditott) {
      expect(hub.cikk.seoTitle.length).toBeGreaterThan(0)
      expect(hub.cikk.seoDescription.length).toBeGreaterThan(0)
      expect(hub.cikk.seoKeywords.length).toBeGreaterThan(0)
    }
  })

  it('ahol van GYIK, az a pages.faq korlátain belül van (2–6 tétel)', () => {
    for (const hub of forditott) {
      if (hub.cikk.faq === undefined) continue
      expect(hub.cikk.faq.length).toBeGreaterThanOrEqual(GYIK_MIN)
      expect(hub.cikk.faq.length).toBeLessThanOrEqual(GYIK_MAX)
    }
  })

  it('a hub-törzs nem ígér gyógyulási arányt vagy határidőt', () => {
    // A „garantál/garancia" szavakat SZÁNDÉKOSAN nem lintel a teszt: a
    // lektorált törzs tagadó alakban használja őket („nincs garantált hat
    // hét", „ne higgy a garantált…") — pont a hamis ígéretet cáfolja. Amit
    // őrzünk: pozitív gyógyulási-arány és határidő-ígéret nem kerülhet be.
    const tiltott = /(\d+\s?%-a (meg)?gyógyul|nap alatt (meggyógyul|elmúlik|helyreáll))/i
    for (const hub of forditott) {
      const szoveg = JSON.stringify(hub.cikk.content)
      expect(tiltott.test(szoveg), `tiltott ígéret a(z) ${hub.slug} hubban`).toBe(false)
    }
  })
})
