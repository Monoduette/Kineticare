import type { MetadataRoute } from 'next'

import { absoluteUrl } from '@/lib/seo'

/**
 * robots.txt — a Next.js metadata-API generálja (`/robots.txt`).
 * Két külön döntés van benne, és fontos, hogy ne keveredjenek:
 * fiók, kosár, pénztár, auth-oldalak) nem valók keresőbe: vagy bejelentkezést
 * igényelnek, vagy egyszer használatos állapotot mutatnak. A `/kurzusaim` és
 * a `/fiok` ráadásul felhasználóhoz kötött tartalom.
 * feltétele, hogy az AI-botok egyáltalán elérjék a tartalmat. Ezek a botok
 */

/** Bejelentkezés mögötti, tranzakciós vagy egyszer használatos útvonalak. */
const DISALLOWED_PATHS = [
  '/admin',
  '/api/',
  // A /graphql végpont a configban le van tiltva (graphQL.disable) és a
  // route-fájlja is törölve — a tiltás védőhálónak marad itt.
  '/graphql',
  '/fiok',
  '/kurzusaim',
  '/kosar',
  '/penztar',
  '/fizetes/',
  '/sikertelen',
  // A `/belepes` és a `/regisztracio` SZÁNDÉKOSAN NINCS itt (tulajdonosi
  // döntés, 2026-09-07: „mindent indexelhessenek kivéve a belépett user
  // fizetős kurzusát”): a márkás keresésre („kineticare belépés”) a lap
  // indexelhető; a sitemapben viszont nem szerepel (vékony tartalom).
  // Az átállási lap külön előtag, mert a `/belepes` már nem fedi le.
  '/belepes-atallas',
  '/elfelejtett-jelszo',
  '/jelszo-visszaallitas',
  // Piszkozat-előnézet be-/kikapcsoló végpontok — a válaszaik amúgy is
  // noindexeltek, ez csak plusz védőháló a felesleges crawl ellen.
  '/next/',
  // PostHog elsőfél-proxy (next.config.ts `rewrites`): ez nem a mi tartalmunk,
  // hanem továbbított analitikai forgalom. Indexelni nincs mit rajta, a
  // bejárása viszont fölösleges kimenő kérést generálna minden találatra.
  '/ingest/',
]

/**
 * Amit SZÁNDÉKOSAN NEM tiltunk, hogy egy későbbi „takarítás" se vegye el:
 * - `/blog/` és `/blog/kategoria/` — a Tudástár a hosszútávú SEO/GEO-motor.
 *   Az ÜRES kategória-lap indexelését nem itt, hanem az oldal `noindex`
 *   jelzésével akadályozzuk: a robots.txt-vel tiltott lapot a Google be sem
 *   járja, tehát a `noindex`-et sem látná meg
 *   (https://developers.google.com/search/docs/crawling-indexing/block-indexing:
 *   „For the `noindex` rule to be effective, the page … must not be blocked by
 *   a robots.txt file").
 * - `/kurzusok/` és a jogi lapok — nyilvános, indexelendő tartalom.
 */

/**
 * AI-crawlerek és -ágensek, amelyeket kifejezetten engedünk.
 * Forrás-kategóriák: OpenAI, Anthropic, Perplexity, Common Crawl, Google AI,
 * valamint a felhasználó megbízásából cselekvő ágens-fetcher (Google-Agent).
 */
const AI_USER_AGENTS = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'Claude-User',
  'Claude-SearchBot',
  'PerplexityBot',
  'Perplexity-User',
  'CCBot',
  'Google-Extended',
  'Google-Agent',
  'Applebot-Extended',
  'Bingbot',
  'meta-externalagent',
]

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: DISALLOWED_PATHS,
      },
      ...AI_USER_AGENTS.map((userAgent) => ({
        userAgent,
        allow: '/',
        disallow: DISALLOWED_PATHS,
      })),
    ],
    sitemap: absoluteUrl('/sitemap.xml'),
    host: absoluteUrl('/'),
  }
}
