import {
  getAllPublishedPages,
  getPosts,
  getPublishedPageSlugs,
  getPublishedProducts,
} from '@/lib/cms'
import { buildLlmsTxt } from '@/lib/seo-llms'
import { hubUtvonalTerkep } from '@/lib/tudastar/hub-oldalak'

/**
 * `/llms.txt` — a webhely gépi olvasásra szánt térképe az llmstxt.org
 * alakjában (https://llmstxt.org/). A tartalom a CMS-ből épül kérésidőben
 * (`force-dynamic`), ahogy a sitemap is; a válasz egy órán át gyorsítótárazható
 * (a CMS-változás ennyi késéssel ér ide, ami egy térképnél elfogadható).
 * Miért nem elsődleges stratégia: `docs/seo-geo-llm.md` 4. fejezet.
 */
export const dynamic = 'force-dynamic'

const CACHE_CONTROL = 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400'

export async function GET(): Promise<Response> {
  const [pages, posts, products, publikaltOldalak] = await Promise.all([
    getAllPublishedPages(),
    getPosts({ limit: 500 }),
    getPublishedProducts(100),
    getPublishedPageSlugs(),
  ])
  const hubUtvonalak = hubUtvonalTerkep(
    posts.map((post) => post.slug).filter((slug): slug is string => typeof slug === 'string'),
    publikaltOldalak,
  )
  const body = buildLlmsTxt({ pages, posts, products, hubUtvonalak })
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': CACHE_CONTROL,
    },
  })
}
