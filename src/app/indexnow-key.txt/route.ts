import { getIndexNowKey } from '@/lib/indexnow'

/**
 * `/indexnow-key.txt` — az IndexNow-kulcsfájl (src/lib/indexnow.ts). A
 * kereső ezzel ellenőrzi, hogy a beküldő tényleg a host gazdája: a fájl
 * tartalma maga a kulcs. A gyökérben áll, így a host minden címére érvényes
 * (https://www.indexnow.org/documentation, „keyLocation”).
 * Kulcs nélkül 404: a funkció ki van kapcsolva, nincs mit ellenőrizni.
 */
export const dynamic = 'force-dynamic'

export function GET(): Response {
  const key = getIndexNowKey()
  if (key === null) {
    return new Response('Not found', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    })
  }
  return new Response(key, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  })
}
