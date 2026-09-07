import {
  getAllPublishedPages,
  getPosts,
  getPublishedPageSlugs,
  getPublishedProducts,
} from '@/lib/cms'
import { buildLlmsFullTxt } from '@/lib/seo-llms'
import { hubUtvonalTerkep } from '@/lib/tudastar/hub-oldalak'

/**
 * `/llms-full.txt` — a nyilvános lapok TELJES szövege egyetlen markdown
 * fájlban (llmstxt.org: „llms-full.txt”, https://llmstxt.org/). Ugyanaz a
 * CMS-tartalom, ami a lapokon látszik; kérésidőben épül, egy órás
 * gyorsítótárral. Bejelentkezés mögötti vagy tranzakciós lap nincs benne.
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
  const body = buildLlmsFullTxt({ pages, posts, products, hubUtvonalak })
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': CACHE_CONTROL,
    },
  })
}
