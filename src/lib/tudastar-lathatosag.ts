import { unstable_cache } from 'next/cache'
import { cache } from 'react'

import { MENUS_CACHE_TAG } from './cache-tags'
import { logger } from './logger'
import { tudastarLathatoMenukbol } from './tudastar-kapcsolo'

/**
 * A Tudástár-kapcsoló SZERVEROLDALI kérdése: látható-e most a Tudástár?
 *
 * A szabály maga a tiszta `src/lib/tudastar-kapcsolo.ts`-ben él (ott a
 * vezetői döntés szó szerint); ez a modul csak a menüket olvassa hozzá.
 * Minden felület (kezdőlap, CMS-oldalak, Tudástár-lapok metaadata, sitemap,
 * llms, 404) ezt a függvényt hívja, a fejléc-menü pedig ugyanazt a tiszta
 * szabályt a saját, már lekérdezett menülistáján (`buildNavTree`).
 *
 * - Lekérdezés: `overrideAccess: true`, mert a rejtett (visible=false) sor is
 *   számít, az anonim olvasási szabály (src/access/menus-visibility.ts) pedig
 *   azt elrejtené. `depth: 0` és `select`: csak a döntéshez kellő négy mező
 *   jön, relációk feloldása nélkül.
 * - Gyorsítótár: `unstable_cache` a `MENUS_CACHE_TAG` címkével. A Menus
 *   gyűjtemény afterChange/afterDelete hookja ezt a címkét azonnal üríti
 *   (`revalidateMenusCache`, `expire: 0`), így a kapcsolás a mentés utáni első
 *   kérésnél látszik, újraindítás nélkül.
 * - Kérésen belül a React `cache` fogja össze a hívásokat: a generateMetadata,
 *   a lap és a 404-határ egy renderben egyetlen gyorsítótár-olvasást ad.
 * - Hiba (pl. build-időben nincs adatbázis): BEKAPCSOLT + logger.warn, hogy
 *   egy adatbázis-hiba ne vigye el csendben a Tudástár indexelését.
 * - A Payload és a config LUSTÁN töltődik be (a lekérdezés első futásakor):
 *   a modult minden route importálja (a sitemap, az llms és a 404 is), és így
 *   az importja nem húzza magával a teljes Payload-konfigurációt oda, ahol a
 *   lekérdezés nem is fut (pl. a route-ok egységtesztjei).
 */

/**
 * Biztonsági lejárat másodpercben, ha a címke-ürítés valamiért elmaradna.
 * Szándékosan ugyanannyi, mint a fejléc-menüé (`NAV_TREE_REVALIDATE_SECONDS`,
 * src/lib/menus.ts), hogy a menü és a kapcsoló ne csússzon el egymástól; a
 * konstans azért nem onnan jön, mert az a modul a Payload-konfigurációt is
 * betölti.
 */
export const TUDASTAR_REVALIDATE_SECONDS = 60

async function queryTudastarLathato(): Promise<boolean> {
  const [{ getPayload }, { default: config }] = await Promise.all([
    import('payload'),
    import('../payload.config'),
  ])
  const payload = await getPayload({ config })
  const { docs } = await payload.find({
    collection: 'menus',
    depth: 0,
    pagination: false,
    overrideAccess: true,
    select: { type: true, url: true, visible: true, unlisted: true },
  })
  return tudastarLathatoMenukbol(docs)
}

const cachedTudastarLathato = unstable_cache(queryTudastarLathato, ['tudastar-lathato'], {
  tags: [MENUS_CACHE_TAG],
  revalidate: TUDASTAR_REVALIDATE_SECONDS,
})

export const getTudastarLathato = cache(async (): Promise<boolean> => {
  try {
    return await cachedTudastarLathato()
  } catch (error) {
    logger.warn('Tudástár-kapcsoló: a menük olvasása sikertelen, a Tudástár látható marad', {
      error: error instanceof Error ? error.message : String(error),
    })
    return true
  }
})
