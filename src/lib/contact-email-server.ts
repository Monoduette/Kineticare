import type { Payload } from 'payload'
import { cache } from 'react'

import {
  kapcsolatiEmailLayoutbol,
  KAPCSOLAT_OLDAL_WEBCIM,
  KAPCSOLATI_EMAIL_TARTALEK,
} from './contact-email'
import { logger } from './logger'

/**
 * A kapcsolati e-mail SZERVEROLDALI feloldója (modul-térkép H18/A10, H46).
 *
 * A szabály a tiszta `src/lib/contact-email.ts`-ben él; ez a modul csak a
 * `/kapcsolat` CMS-oldal szekciósorát olvassa hozzá.
 *
 * - Lekérdezés: a `kapcsolat` webcímű oldal KÖZZÉTETT változata
 *   (`status: published` + `draft: false`, ugyanaz a szűrő, mint a
 *   src/lib/cms.ts `PUBLISHED_WHERE`-je), `depth: 0`, `limit: 1`, és a
 *   `select` csak a szekciósort kéri: a cím feloldásához reláció és más mező
 *   nem kell. `overrideAccess: true`, mert a lekérdezést a szerver futtatja a
 *   látogató helyett, és a szűrő a kódban determinisztikus (a cms.ts mintája).
 * - Hibatűrés: bármilyen hiba (nincs adatbázis, build-idő, séma-eltérés)
 *   esetén a kódtartalék + logger.warn. Kivétel nem szökik ki: a lábléc, a
 *   404 és a JSON-LD egy adatbázis-hiba miatt sem törhet el.
 */
export async function kapcsolatiEmailPayloadbol(payload: Payload): Promise<string> {
  try {
    const { docs } = await payload.find({
      collection: 'pages',
      where: {
        and: [{ slug: { equals: KAPCSOLAT_OLDAL_WEBCIM } }, { status: { equals: 'published' } }],
      },
      draft: false,
      depth: 0,
      limit: 1,
      overrideAccess: true,
      select: { layout: true },
    })
    const oldal = docs[0]
    if (oldal === undefined) {
      logger.warn('kapcsolati e-mail: nincs közzétett Kapcsolat-oldal, a kódtartalék látszik', {
        webcim: KAPCSOLAT_OLDAL_WEBCIM,
      })
      return KAPCSOLATI_EMAIL_TARTALEK
    }
    const email = kapcsolatiEmailLayoutbol(oldal.layout)
    if (email === null) {
      logger.warn(
        'kapcsolati e-mail: a Kapcsolat-oldal első látható Időpontkérő szekciójában nincs érvényes E-mail-cím, a kódtartalék látszik',
        { webcim: KAPCSOLAT_OLDAL_WEBCIM },
      )
      return KAPCSOLATI_EMAIL_TARTALEK
    }
    return email
  } catch (error) {
    logger.warn('kapcsolati e-mail: a Kapcsolat-oldal nem olvasható, a kódtartalék látszik', {
      error: error instanceof Error ? error.message : String(error),
    })
    return KAPCSOLATI_EMAIL_TARTALEK
  }
}

/**
 * A kapcsolati e-mail a jelenlegi kérésben (lábléc, 404, lapok JSON-LD-je).
 *
 * GYORSÍTÓTÁR: CSAK a React `cache`, azaz kérésenként legfeljebb EGY
 * lekérdezés; a lábléc, a 404-határ és a lap JSON-LD-je ugyanazt az ígéretet
 * kapja (React, cache: „cache lets you cache the result of a data fetch or
 * computation” egy szerver-kérés idejére, https://react.dev/reference/react/cache).
 * `unstable_cache` SZÁNDÉKOSAN nincs: a Pages gyűjteménynek nincs olyan
 * cache-címke-ürítése, amely a mentéskor érvénytelenítené (a Pages.ts
 * hookjaihoz ez a kör nem nyúl), így egy tartós gyorsítótár a mentés után is
 * a régi címet mutatná. A lapok amúgy is `force-dynamic`-ok, egy `depth: 0`,
 * `select`-es, egysoros lekérdezés pedig olcsó.
 *
 * A Payload és a config LUSTÁN töltődik be (az első híváskor), ahogy a
 * src/lib/tudastar-lathatosag.ts-ben: a modult a lábléc és a 404 is
 * importálja, és így az importja nem húzza magával a teljes
 * Payload-konfigurációt oda, ahol a lekérdezés nem is fut (pl. egységteszt).
 */
export const getContactEmail = cache(async (): Promise<string> => {
  try {
    const [{ getPayload }, { default: config }] = await Promise.all([
      import('payload'),
      import('../payload.config'),
    ])
    return await kapcsolatiEmailPayloadbol(await getPayload({ config }))
  } catch (error) {
    logger.warn('kapcsolati e-mail: a Payload nem indult el, a kódtartalék látszik', {
      error: error instanceof Error ? error.message : String(error),
    })
    return KAPCSOLATI_EMAIL_TARTALEK
  }
})
