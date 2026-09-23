import {
  getAllPublishedPages,
  getPosts,
  getPublishedPageSlugs,
  getPublishedProducts,
} from '@/lib/cms'
import { CTA_TERMEK_LEKERDEZES_LIMIT } from '@/lib/cta-banner-course'
import { buildLlmsFullTxt, vanElerhetoIngyenesSos } from '@/lib/seo-llms'
import { getTudastarLathato } from '@/lib/tudastar-lathatosag'
import { hubUtvonalTerkep } from '@/lib/tudastar/hub-oldalak'
import type { Post } from '@/payload-types'

/**
 * `/llms-full.txt` — a nyilvános lapok TELJES szövege egyetlen markdown
 * fájlban (llmstxt.org: „llms-full.txt”, https://llmstxt.org/). Ugyanaz a
 * CMS-tartalom, ami a lapokon látszik; kérésidőben épül, néhány perces
 * gyorsítótárral. Bejelentkezés mögötti vagy tranzakciós lap nincs benne.
 */
export const dynamic = 'force-dynamic'

/**
 * Megosztott gyorsítótár (CDN/edge) legfeljebb 5 percig tarthatja frissként,
 * utána még legfeljebb 5 percig adhatja a régit, amíg a háttérben frissít.
 *
 * MIÉRT 5+5 PERC (korábban 1 óra + 24 óra): a Tudástár-kapcsoló
 * (src/lib/tudastar-kapcsolo.ts) átkapcsolása ezt a fájlt is módosítja, és a
 * tulajdonos azt kérte, hogy a Tudástár kikapcsolva sehol ne jelenjen meg,
 * visszakapcsolva jöjjön vissza. Mérve 2026-09-22: a Railway edge a választ
 * ténylegesen tárolja (`x-cache: STALE`, `age: 4470` és `5258` mp a
 * kineticare-production.up.railway.app /llms.txt és /llms-full.txt címén),
 * vagyis az 1 órás `s-maxage` mellett a régi szöveg egy óránál tovább is
 * kint maradhatott. Az `s-maxage` a megosztott gyorsítótár frissességi
 * ideje (RFC 9111, 5.2.2.10: https://www.rfc-editor.org/rfc/rfc9111#section-5.2.2.10),
 * a `stale-while-revalidate` pedig azt engedi, hogy lejárat után még ennyi
 * ideig a régi választ adja, amíg a háttérben frissít (RFC 5861, 3.:
 * https://www.rfc-editor.org/rfc/rfc5861#section-3). Így a legrosszabb eset
 * kb. 10 perc. A lapok maguk dinamikusak (`private, no-store`), a
 * sitemap.xml `max-age=0, must-revalidate`: azok azonnal követik a kapcsolót.
 */
const CACHE_CONTROL = 'public, max-age=0, s-maxage=300, stale-while-revalidate=300'

export async function GET(): Promise<Response> {
  // Rejtett Tudástárnál a cikkek lekérdezése sem fut; a builder a hub-oldalakat
  // és a lapok Tudástár-linkjeit is kiveszi (src/lib/seo-llms.ts).
  const tudastarLathato = await getTudastarLathato()
  const [pages, posts, products, publikaltOldalak] = await Promise.all([
    getAllPublishedPages(),
    tudastarLathato ? getPosts({ limit: 500 }) : Promise.resolve<Post[]>([]),
    getPublishedProducts(100),
    getPublishedPageSlugs(),
  ])
  const hubUtvonalak = hubUtvonalTerkep(
    posts.map((post) => post.slug).filter((slug): slug is string => typeof slug === 'string'),
    publikaltOldalak,
  )
  // Az SOS-sáv címe és a nyitó videó vég-leírása attól függ, van-e elérhető
  // ingyenes SOS-kurzus; a döntés a lapéval azonos (src/lib/seo-llms.ts). A
  // lapok az első CTA_TERMEK_LEKERDEZES_LIMIT publikált, listázható terméket
  // kérik, ugyanazzal a feltétellel és rendezéssel (getPublishedProducts),
  // ezért itt is ebből a szeletből döntünk.
  const ingyenesSos = vanElerhetoIngyenesSos(products.slice(0, CTA_TERMEK_LEKERDEZES_LIMIT))
  const body = buildLlmsFullTxt({
    pages,
    posts,
    products,
    hubUtvonalak,
    tudastarLathato,
    ingyenesSos,
  })
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': CACHE_CONTROL,
    },
  })
}
