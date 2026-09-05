/** Explicit owner-content operation. No boot hook, default is a write-free preview. */
import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import type { Payload } from 'payload'
import sharp from 'sharp'

import { logger } from '../lib/logger'
import { isFreeCourse } from '../lib/courses'
import { missingMediaFiles } from '../lib/media-restore'
import { SOS_FREE_MENU_LABEL, SOS_MENU_LABEL } from '../lib/sos-offer-copy'
import {
  planOwnerReviewV1,
  type OwnerReviewChange,
  type OwnerReviewMediaRole,
} from '../lib/owner-review-v1'
import { buildHomeLayout, HOME_IMAGES, type HomeMediaIds } from '../lib/home-seed'
import type { Menu, Page, Product } from '../payload-types'
import {
  buildKapcsolatLayout,
  buildRolunkLayout,
  buildSzolgaltatasokLayout,
} from './restore-legacy-content'

const PAGE_SLUGS = ['kezdolap', 'szolgaltatasok', 'rolunk', 'kapcsolat'] as const
const ROLES = [
  'founders',
  'sos',
  'expectations',
  'services',
  'about',
  'difference',
  'benefits',
] as const
type PhotoRole = (typeof ROLES)[number]
type PhotoIds = Partial<Record<PhotoRole | 'kocsis' | 'kiss', number>>
interface PhotoAsset {
  role: PhotoRole
  file: string
  alt: string
  sha256: string
  storedSha256?: string
}

export function ownerReviewHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export function readOwnerReviewArguments(args: readonly string[]): {
  apply: boolean
  hash?: string
} {
  if (args.length === 0) return { apply: false }
  if (args.length === 2 && args[0] === '--apply' && /^[a-f0-9]{64}$/.test(args[1])) {
    return { apply: true, hash: args[1] }
  }
  throw new Error('Próbafutás: argumentum nélkül. Alkalmazás: --apply <ellenőrzött terv SHA-256>.')
}

export function parseOwnerReviewAssets(value: unknown): PhotoAsset[] {
  if (!value || typeof value !== 'object' || !('assets' in value) || !Array.isArray(value.assets)) {
    throw new Error('Hiányos fotójegyzék.')
  }
  const rawAssets = value.assets
  const assets = ROLES.map((role) => {
    const matches = rawAssets.filter(
      (item: unknown) => !!item && typeof item === 'object' && 'role' in item && item.role === role,
    )
    if (matches.length !== 1) throw new Error(`Hiányzó vagy ismétlődő fotószerep: ${role}`)
    const asset: unknown = matches[0]
    if (
      !asset ||
      typeof asset !== 'object' ||
      !('file' in asset) ||
      typeof asset.file !== 'string' ||
      !/^[a-z0-9-]+\.webp$/.test(asset.file) ||
      !('alt' in asset) ||
      typeof asset.alt !== 'string' ||
      !asset.alt.trim() ||
      !('sha256' in asset) ||
      typeof asset.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(asset.sha256)
    ) {
      throw new Error(`Érvénytelen fotóadat: ${role}`)
    }
    return { role, file: asset.file, alt: asset.alt, sha256: asset.sha256 }
  })
  if (new Set(assets.map((asset) => asset.file)).size !== assets.length) {
    throw new Error('Ismétlődő fotófájlnév a szerepek között.')
  }
  return assets
}

async function loadAssets(): Promise<PhotoAsset[]> {
  const folder = path.resolve('public/media/team')
  const assets = parseOwnerReviewAssets(
    JSON.parse(await readFile(path.join(folder, 'manifest.json'), 'utf8')),
  )
  for (const asset of assets) {
    const source = await readFile(path.join(folder, asset.file))
    const actual = createHash('sha256').update(source).digest('hex')
    if (actual !== asset.sha256) throw new Error(`A fotó ellenőrzőösszege eltér: ${asset.file}`)
    // The pinned Media collection stores an auto-oriented WebP at quality 80.
    asset.storedSha256 = createHash('sha256')
      .update(await sharp(source, { animated: true }).rotate().webp({ quality: 80 }).toBuffer())
      .digest('hex')
  }
  return assets
}

async function readState(payload: Payload, assets: PhotoAsset[]) {
  const pages = await payload.find({
    collection: 'pages',
    where: { slug: { in: [...PAGE_SLUGS] } },
    depth: 0,
    pagination: false,
    draft: true,
    overrideAccess: true,
  })
  const media = await payload.find({
    collection: 'media',
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })
  const filenames = new Map(media.docs.map((doc) => [doc.id, doc.filename ?? '']))
  const ids: PhotoIds = {}
  const mediaProof: { id: number; filename: string; updatedAt: string; sha256: string }[] = []
  const mediaFileBlockers: string[] = []
  const placeholderBase = Math.max(0, ...media.docs.map((doc) => doc.id)) + 1000
  for (const [index, asset] of assets.entries()) {
    const matches = media.docs.filter((doc) => doc.filename === asset.file)
    if (matches.length > 1) throw new Error(`Ismétlődő médiafájlnév: ${asset.file}`)
    if (matches.length === 1) {
      const upload = payload.collections.media.config.upload
      if (!upload || upload.disableLocalStorage || !upload.staticDir) {
        throw new Error(`A meglévő fotó helyi fájlazonossága nem ellenőrizhető: ${asset.file}`)
      }
      const storedHash = createHash('sha256')
        .update(await readFile(path.resolve(upload.staticDir, asset.file)))
        .digest('hex')
      if (storedHash !== asset.storedSha256) {
        throw new Error(`A meglévő fotó tartalma eltér a jóváhagyott képtől: ${asset.file}`)
      }
      const missing = missingMediaFiles(path.resolve(upload.staticDir), matches[0])
      if (missing.length > 0) {
        mediaFileBlockers.push(`Hiányzó fotófájlok; helyreállítás szükséges: ${missing.join(', ')}`)
      }
      mediaProof.push({
        id: matches[0].id,
        filename: asset.file,
        updatedAt: matches[0].updatedAt,
        sha256: storedHash,
      })
    }
    ids[asset.role] = matches[0]?.id ?? placeholderBase + index
  }
  const portraits = [
    ['kocsis', '67b3c6e9e315f_KocsisKatakozeli'],
    ['kiss', '67c07def59ac2_KissKataelegans'],
  ] as const
  for (const [role, prefix] of portraits) {
    const matches = media.docs.filter((doc) => doc.filename?.startsWith(`${prefix}.`))
    if (matches.length === 1) ids[role] = matches[0].id
  }
  const products = await payload.find({
    collection: 'products',
    where: { slug: { in: ['otthoni-kezrehab-program', 'sos-kezrelax-villamkurzus'] } },
    depth: 0,
    limit: 4,
    draft: false,
    overrideAccess: true,
  })
  const paidMatches = products.docs.filter((product) => product.slug === 'otthoni-kezrehab-program')
  const paid = paidMatches.length === 1 ? paidMatches[0] : undefined
  const freeMatches = products.docs.filter(
    (product) => product.slug === 'sos-kezrelax-villamkurzus',
  )
  const free = freeMatches.length === 1 ? freeMatches[0] : undefined
  const freeOfferAvailable =
    free?.status === 'published' && free._status === 'published' && isFreeCourse(free)
  const productProof = products.docs
    .map((product) => ({
      id: product.id,
      slug: product.slug,
      status: product.status,
      _status: product._status,
      priceInHUFEnabled: product.priceInHUFEnabled,
      priceInHUF: product.priceInHUF,
      updatedAt: product.updatedAt,
    }))
    .sort((a, b) => a.id - b.id)
  const menus = await payload.find({
    collection: 'menus',
    pagination: false,
    depth: 0,
    overrideAccess: true,
  })
  const menuPlans = planOwnerReviewMenus(menus.docs, free)
  const completeCourseHref =
    paid?.status === 'published' &&
    paid._status === 'published' &&
    paid.priceInHUFEnabled === true &&
    typeof paid.priceInHUF === 'number' &&
    paid.priceInHUF > 0
      ? `/kurzusok/${paid.slug}`
      : undefined
  const plans = PAGE_SLUGS.map((slug) => {
    const matches = pages.docs.filter((page) => page.slug === slug)
    if (matches.length !== 1)
      return { slug, changes: [], skipped: ['Az oldal hiányzik vagy nem egyértelmű.'] }
    const page = matches[0]
    if (page._status === 'draft')
      return {
        slug,
        changes: [],
        skipped: ['Szerkesztői piszkozat van; kézi egyeztetés szükséges.'],
      }
    const result = planPage(page, ids, filenames, completeCourseHref)
    const fields = planOwnerReviewPageFields(page, result.layout, ids.about, filenames)
    return {
      slug,
      id: page.id,
      updatedAt: page.updatedAt,
      before: {
        layout: page.layout,
        heroImage: page.heroImage,
        title: page.title,
        excerpt: page.excerpt,
      },
      ...result,
      pageFields: fields.data,
      changes: [...result.changes, ...fields.changes],
    }
  })
  const freeOfferChanges = ['H13', 'P03'].filter((requestId) =>
    plans.some((plan) => plan.changes.some((change) => change.requestId === requestId)),
  )
  const blockers = [
    ...mediaFileBlockers,
    ...(!freeOfferAvailable && freeOfferChanges.length > 0
      ? [
          `${freeOfferChanges.join(', ')}: Az ingyenes SOS-t említő új tartalomhoz ellenőrzött, közzétett ingyenes kurzus szükséges.`,
        ]
      : []),
  ]
  const pendingAssets = plans.some((plan) => plan.changes.length > 0)
    ? assets.filter((asset) => (ids[asset.role] ?? 0) >= placeholderBase)
    : []
  if (pendingAssets.length > 0) {
    const upload = payload.collections.media.config.upload
    if (!upload || upload.disableLocalStorage || !upload.staticDir) {
      blockers.push('Az új fotók helyi feltöltési könyvtára nem ellenőrizhető.')
    } else {
      let existing: string[]
      try {
        existing = await readdir(path.resolve(upload.staticDir))
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
          existing = []
        } else {
          throw error
        }
      }
      const reservedNames = media.docs.flatMap((doc) =>
        [doc.filename, ...Object.values(doc.sizes ?? {}).map((size) => size?.filename)].filter(
          (filename): filename is string => typeof filename === 'string',
        ),
      )
      const occupiedNames = [...new Set([...existing, ...reservedNames])].sort()
      for (const asset of pendingAssets) {
        const sourceName = path.parse(asset.file)
        // A pinned Payload variánsai: <alapnév>-<szélesség>x<magasság>.<kiterjesztés>.
        const collision = occupiedNames.find((filename) => {
          if (filename === asset.file) return true
          const stored = path.parse(filename)
          const prefix = `${sourceName.name}-`
          return (
            stored.ext === sourceName.ext &&
            stored.name.startsWith(prefix) &&
            /^\d+x\d+$/.test(stored.name.slice(prefix.length))
          )
        })
        if (collision)
          blockers.push(`Fotó fájlnévütközés: ${collision}; meglévő fájlt nem írunk felül.`)
      }
    }
  }
  return {
    pages,
    filenames,
    ids,
    plans,
    completeCourseHref,
    placeholderBase,
    mediaProof,
    menuPlans,
    productProof,
    blockers,
  }
}

export function planOwnerReviewMenus(menus: Menu[], product: Product | undefined) {
  if (
    !product ||
    product.status !== 'published' ||
    product._status !== 'published' ||
    !isFreeCourse(product)
  )
    return []
  return menus.flatMap((menu) => {
    const ref = menu.ref?.relationTo === 'products' ? menu.ref.value : undefined
    const productId = typeof ref === 'number' ? ref : ref?.id
    if (menu.type !== 'product' || productId !== product.id || menu.label !== SOS_MENU_LABEL)
      return []
    return [{ id: menu.id, updatedAt: menu.updatedAt, before: menu, label: SOS_FREE_MENU_LABEL }]
  })
}

export function planOwnerReviewPageFields(
  page: Pick<Page, 'slug' | 'title' | 'excerpt' | 'heroImage'>,
  layout: NonNullable<Page['layout']>,
  aboutPhoto: number | undefined,
  filenames: ReadonlyMap<number, string>,
) {
  const data: Partial<Pick<Page, 'heroImage' | 'title' | 'excerpt'>> = {}
  const changes: OwnerReviewChange[] = []
  const add = (requestId: string, key: keyof typeof data, after: string | null, reason: string) => {
    Object.assign(data, { [key]: after })
    changes.push({ requestId, blockId: null, path: `/${key}`, before: page[key], after, reason })
  }
  if (page.slug === 'szolgaltatasok') {
    if (page.title === 'A kezed folyton dolgozik – segítünk, hogy közben ne fájjon') {
      add('S03', 'title', 'Szolgáltatások', 'A pontos régi lapcím rövidítése.')
    }
    if (
      page.excerpt ===
      'Hatékony kezeléseket, otthon végezhető programokat és szakmai továbbképzéseket nyújtunk azoknak, akik biztos eredményeket szeretnének.'
    ) {
      add(
        'S03',
        'excerpt',
        'Személyes kezelések, otthoni videókurzusok és szakmai képzések.',
        'A pontos régi felvezető rövidítése eredménygarancia nélkül.',
      )
    }
  }
  const heroId = typeof page.heroImage === 'number' ? page.heroImage : page.heroImage?.id
  const knownHero =
    heroId !== undefined &&
    ['katak-team', '682a121babe80_IMG_7573'].includes(path.parse(filenames.get(heroId) ?? '').name)
  const hasAboutPhoto =
    aboutPhoto !== undefined &&
    layout.some(
      (block) =>
        block.blockType === 'about' &&
        block.sectionSettings?.visible !== false &&
        (typeof block.photo === 'number' ? block.photo : block.photo?.id) === aboutPhoto,
    )
  if (page.slug === 'rolunk' && knownHero && hasAboutPhoto) {
    add(
      'A01',
      'heroImage',
      null,
      'Az ismert régi teljes szélességű fejlécfotó helyét az új, kéthasábos bemutatkozás veszi át.',
    )
  }
  return { data, changes }
}

export function planPage(
  page: Pick<Page, 'slug' | 'layout'>,
  ids: PhotoIds,
  filenames: ReadonlyMap<number, string>,
  completeCourseHref?: string,
) {
  const findFile = (file: string) => {
    const base = path.parse(file).name
    const matches = [...filenames].filter(([, filename]) => path.parse(filename).name === base)
    return matches.length === 1 ? matches[0][0] : undefined
  }
  const homeMedia: HomeMediaIds = {}
  for (const entry of HOME_IMAGES) homeMedia[entry.file] = findFile(entry.file)
  const legacyMedia = {
    rolunkFoto: findFile('680a69d078306_Katakfeherbenhattal.png'),
    szolgaltatasokKep: findFile('67b2668feae66_Kezeleskek.png'),
    kocsisPortre: ids.kocsis,
    kissPortre: ids.kiss,
    sajtoLogok: HOME_IMAGES.filter((entry) => entry.file.startsWith('press-')).flatMap((entry) =>
      homeMedia[entry.file] === undefined ? [] : [homeMedia[entry.file]!],
    ),
  }
  if (page.slug === 'szolgaltatasok') {
    const liveServices = page.layout?.filter(
      (block) =>
        block.blockType === 'services' && block.sectionSettings?.anchorId === 'szolgaltatasaink',
    )
    const image =
      liveServices?.length === 1 && liveServices[0].blockType === 'services'
        ? liveServices[0].image
        : undefined
    const imageId = typeof image === 'number' ? image : image?.id
    // Verified published 2026-09-05 variant; arbitrary editor photos stay protected.
    if (imageId && path.parse(filenames.get(imageId) ?? '').name === 'kezeles-kezen') {
      legacyMedia.szolgaltatasokKep = imageId
    }
  }
  const canonical =
    page.slug === 'kezdolap'
      ? buildHomeLayout(homeMedia)
      : page.slug === 'rolunk'
        ? buildRolunkLayout(legacyMedia)
        : page.slug === 'szolgaltatasok'
          ? buildSzolgaltatasokLayout(legacyMedia)
          : buildKapcsolatLayout(legacyMedia)
  const mediaByRole: Partial<Record<OwnerReviewMediaRole, number>> = {
    homeFounders: ids.founders,
    homeSos: ids.sos,
    homeExpectations: ids.expectations,
    homeServices: ids.services,
    servicesJoint: ids.about,
    servicesBenefits: ids.benefits,
    aboutDifference: ids.difference,
    aboutPhoto: ids.about,
    kocsisPortrait: ids.kocsis,
    kissPortrait: ids.kiss,
  }
  const result = planOwnerReviewV1({
    slug: page.slug as (typeof PAGE_SLUGS)[number],
    layout: page.layout,
    canonicalLayout: canonical,
    mediaByRole,
    completeCourseHref,
  })
  return { layout: result.layout, changes: result.changes, skipped: result.skips }
}

export async function applyOwnerReviewV1(args: readonly string[]): Promise<void> {
  const options = readOwnerReviewArguments(args)
  const assets = await loadAssets()
  const { getPayload } = await import('payload')
  const { default: config } = await import('../payload.config')
  const baseConfig = await config
  const payload = await getPayload({
    config: {
      ...baseConfig,
      telemetry: false,
      typescript: { ...baseConfig.typescript, autoGenerate: false },
      admin: {
        ...baseConfig.admin,
        importMap: { ...baseConfig.admin?.importMap, autoGenerate: false },
      },
    },
    disableOnInit: true,
    cron: false,
  })
  try {
    const state = await readState(payload, assets)
    const fingerprint = {
      version: 1,
      assets,
      plans: state.plans,
      mediaProof: state.mediaProof,
      menus: state.menuPlans,
      products: state.productProof,
      blockers: state.blockers,
    }
    const hash = ownerReviewHash(fingerprint)
    logger.info('KC V1 tartalmi terv', {
      hash,
      apply: options.apply,
      blockers: state.blockers,
      menus: state.menuPlans.map((plan) => ({
        id: plan.id,
        before: plan.before.label,
        after: plan.label,
      })),
      pages: state.plans.map(({ slug, changes, skipped }) => ({
        slug,
        changes: changes.length,
        skipped,
      })),
    })
    for (const plan of state.plans) {
      for (const change of plan.changes) {
        logger.info('KC V1 tételes változtatás', {
          slug: plan.slug,
          requestId: change.requestId,
          path: change.path,
          reason: change.reason,
          before: JSON.stringify(change.before),
          after: JSON.stringify(change.after),
        })
      }
    }
    if (!options.apply) return
    if (options.hash !== hash)
      throw new Error('A terv változott. Új próbafutás és független ellenőrzés szükséges.')
    if (state.blockers.length) throw new Error(`Publikálási HOLD: ${state.blockers.join(' ')}`)
    const targets = state.plans
      .filter((plan) => 'id' in plan)
      .filter((plan) => plan.changes.length > 0)
    if (!targets.length && !state.menuPlans.length) return

    // The reviewed version is checked again before the first write.
    const fresh = await readState(payload, assets)
    if (
      ownerReviewHash({
        version: 1,
        assets,
        plans: fresh.plans,
        mediaProof: fresh.mediaProof,
        menus: fresh.menuPlans,
        products: fresh.productProof,
        blockers: fresh.blockers,
      }) !== hash
    ) {
      throw new Error('A tartalom az ellenőrzés közben változott; nem írtunk az adatbázisba.')
    }
    const ids = { ...state.ids }
    for (const asset of targets.length ? assets : []) {
      if ((ids[asset.role] ?? 0) < state.placeholderBase) continue
      const created = await payload.create({
        collection: 'media',
        data: { alt: asset.alt },
        filePath: path.resolve('public/media/team', asset.file),
        overrideAccess: true,
      })
      if (created.filename !== asset.file) {
        throw new Error(
          `A feltöltés eltérő fájlnevet adott (${asset.file}, média-ID: ${created.id}). ` +
            'Részleges médiafeltöltés történt; az oldalakat nem módosítottuk. Kézi ellenőrzés szükséges.',
        )
      }
      ids[asset.role] = created.id
    }
    for (const target of targets) {
      const page = state.pages.docs.find((doc) => doc.id === target.id)
      if (!page) throw new Error('Az ellenőrzött oldal hiányzik.')
      const latest = await payload.findByID({
        collection: 'pages',
        id: page.id,
        draft: true,
        depth: 0,
        overrideAccess: true,
      })
      if (
        latest.updatedAt !== page.updatedAt ||
        ownerReviewHash(latest.layout) !== ownerReviewHash(page.layout)
      ) {
        throw new Error(`Az oldal közben változott, érintetlenül hagytuk: ${page.slug}`)
      }
      const result = planPage(page, ids, state.filenames, state.completeCourseHref)
      const fields = planOwnerReviewPageFields(page, result.layout, ids.about, state.filenames)
      await payload.update({
        collection: 'pages',
        id: page.id,
        data: { layout: result.layout, ...fields.data },
        overrideAccess: true,
      })
      logger.info('KC V1 oldal frissítve', { slug: page.slug, changes: result.changes })
    }
    for (const plan of state.menuPlans) {
      const latest = await payload.findByID({
        collection: 'menus',
        id: plan.id,
        depth: 0,
        overrideAccess: true,
      })
      if (ownerReviewHash(latest) !== ownerReviewHash(plan.before)) {
        throw new Error(`A menüpont közben változott, érintetlenül hagytuk: ${plan.id}`)
      }
      await payload.update({
        collection: 'menus',
        id: plan.id,
        data: { label: plan.label },
        overrideAccess: true,
      })
      logger.info('KC V1 ingyenes menücímke frissítve', { id: plan.id })
    }
  } finally {
    await payload.destroy()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  applyOwnerReviewV1(process.argv.slice(2))
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      logger.error('KC V1 tartalomfrissítés leállt', {
        error: error instanceof Error ? error.message : 'Ismeretlen hiba',
      })
      process.exit(1)
    })
}
