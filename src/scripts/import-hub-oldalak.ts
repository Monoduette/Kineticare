/**
 * Gyökér tünet-hubok betöltése a `pages` collectionbe — a lektorált
 * cikk-markdownból (docs/cikkek/), a mért SEO-céltáblával és GYIK-kel.
 *
 * ═══ MIÉRT KÜLÖN SCRIPT ═══
 * Az import-tudastar-cikkek.ts a `posts`-ot tölti, és a fejléce szerint
 * gyökér pages-hubot SZÁNDÉKOSAN nem hoz létre (v1 lock). A hub-építés
 * tulajdonosi döntés (2026-08-29, Norbert: „építsd meg a 9 klasztert"),
 * ezért külön scriptben, külön publikálási kapuval él. A klaszter-térkép
 * és az indoklás: src/lib/tudastar/hub-oldalak.ts.
 *
 * ═══ KAPUK ═══
 *   OWNER_TUDASTAR_CONFIRM=igen — enélkül PRÓBAFUTÁS: semmi nem íródik.
 *   OWNER_HUB_PUBLISH=igen      — enélkül a hub PISZKOZAT marad.
 *
 * A publikálási kapu SZÁNDÉKOSAN NEM a cikkek OWNER_TUDASTAR_PUBLISH-e:
 * a hub publikálása a `/blog/{cikk}` 308-átirányítását és az Ads finalok
 * gyökérre váltását vonja maga után (lásd hub-oldalak.ts fejléc) — ez a
 * Katák jóváhagyása + tulajdonosi cutover-döntés után nyitható csak meg.
 *
 * ═══ MIT ÍR, ÉS MIT NEM ═══
 * Ír: title, excerpt, content, seoTitle, seoDescription, seoKeywords, faq,
 * status. NEM nyúl: author, reviewedBy, reviewedAt, nextReviewAt (ezek a
 * Katák jóváhagyásakor, kézzel töltendők — üresen a PageEeat nem renderel
 * Person sémát), heroImage, layout, order.
 *
 * ═══ ÚJRAFUTTATHATÓ ═══
 * Slug szerint párosít: meglévő hubot frissít, nem duplikál. Egy már
 * PUBLIKÁLT hubot nem fokoz le piszkozattá (a status csak akkor kerül a
 * payloadba, ha draft → draft vagy a publish-kapu nyitva).
 *
 * Futtatás:
 *   npm run import:hubok                                   (próba)
 *   OWNER_TUDASTAR_CONFIRM=igen npm run import:hubok       (piszkozat)
 *   OWNER_TUDASTAR_CONFIRM=igen OWNER_HUB_PUBLISH=igen …   (közzététel)
 */
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { getPayload, type Payload } from 'payload'

import { logger } from '../lib/logger'
import { HUB_OLDALAK } from '../lib/tudastar/hub-oldalak'
import config from '../payload.config'
import { cikketFordit, type ForditottCikk } from './import-tudastar-cikkek'

const kapuNyitva = (nev: string): boolean => process.env[nev]?.trim().toLowerCase() === 'igen'

interface ForditottHub {
  /** A gyökér slug (a pages-rekord slugja). */
  slug: string
  cikk: ForditottCikk
}

/** Mind a 8 hub forrásának fordítása — hibára DOB, félkész állapot nélkül. */
export function hubokatFordit(cikkekDir: string): ForditottHub[] {
  return HUB_OLDALAK.map(({ slug, cikkFajl, cikkSlug }) => ({
    slug,
    cikk: cikketFordit(cikkekDir, cikkFajl, cikkSlug),
  }))
}

async function main(): Promise<void> {
  const dryRun = !kapuNyitva('OWNER_TUDASTAR_CONFIRM')
  const publikal = kapuNyitva('OWNER_HUB_PUBLISH')
  const cikkekDir = path.join(process.cwd(), 'docs', 'cikkek')

  logger.info(
    dryRun
      ? 'Hub-import: PRÓBAFUTÁS (OWNER_TUDASTAR_CONFIRM=igen nélkül semmi nem íródik).'
      : `Hub-import: ÉLES futás. Célállapot: ${publikal ? 'KÖZZÉTÉVE (blog→gyökér 308 élesedik!)' : 'piszkozat'}.`,
  )

  const forditott = hubokatFordit(cikkekDir)
  for (const hub of forditott) {
    logger.info('Hub-import: lefordítva', {
      hubSlug: hub.slug,
      cikkSlug: hub.cikk.slug,
      cim: hub.cikk.title,
      szoszam: hub.cikk.szoszam,
      seoTitle: hub.cikk.seoTitle,
      gyikTetelek: hub.cikk.faq?.length ?? 0,
    })
  }

  if (dryRun) {
    logger.info(
      `Hub-import: a próbafutás rendben, ${forditott.length} hub fordult le hibátlanul. ` +
        'Íráshoz: OWNER_TUDASTAR_CONFIRM=igen. Publikálás CSAK a Katák jóváhagyása után: OWNER_HUB_PUBLISH=igen.',
    )
    return
  }

  const payload: Payload = await getPayload({ config })
  let letrehozva = 0
  let frissitve = 0

  for (const hub of forditott) {
    const meglevo = await payload.find({
      collection: 'pages',
      where: { slug: { equals: hub.slug } },
      limit: 1,
      depth: 0,
      overrideAccess: true,
      draft: true,
    })
    const letezo = meglevo.docs[0]
    const marPublikalt = letezo?._status === 'published'

    // Egy már publikált hubot piszkozat-célállapot NEM fokoz le: a status
    // ilyenkor kimarad a payloadból, a tartalom frissül, az állapot marad.
    const celallapot: 'draft' | 'published' | undefined =
      publikal || !marPublikalt ? (publikal ? 'published' : 'draft') : undefined

    const adat = {
      title: hub.cikk.title,
      slug: hub.slug,
      excerpt: hub.cikk.excerpt,
      content: hub.cikk.content,
      seoTitle: hub.cikk.seoTitle,
      seoDescription: hub.cikk.seoDescription,
      seoKeywords: hub.cikk.seoKeywords,
      ...(hub.cikk.faq === undefined ? {} : { faq: hub.cikk.faq }),
      ...(celallapot === undefined
        ? {}
        : { status: celallapot, _status: celallapot }),
    }

    if (letezo) {
      await payload.update({
        collection: 'pages',
        id: letezo.id,
        data: adat,
        overrideAccess: true,
      })
      frissitve += 1
      logger.info('Hub-import: frissítve', {
        hubSlug: hub.slug,
        id: letezo.id,
        allapot: celallapot ?? 'változatlan (publikált)',
      })
    } else {
      const uj = await payload.create({
        collection: 'pages',
        data: { ...adat, status: celallapot ?? 'draft', _status: celallapot ?? 'draft' },
        overrideAccess: true,
      })
      letrehozva += 1
      logger.info('Hub-import: létrehozva', { hubSlug: hub.slug, id: uj.id })
    }
  }

  logger.info('Hub-import: kész.', {
    letrehozva,
    frissitve,
    allapot: publikal ? 'published' : 'draft (vagy változatlan)',
  })
}

const kozvetlenul =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (kozvetlenul) {
  main()
    .then(() => {
      process.exit(0)
    })
    .catch((error: unknown) => {
      logger.error('Hub-import: hiba történt.', {
        error: error instanceof Error ? error.message : String(error),
      })
      process.exit(1)
    })
}
