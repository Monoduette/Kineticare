import type { Page } from '../payload-types'
import { ctaLabel } from './cta-vocabulary'
import {
  HOME_HELP_LEAD,
  HOME_HELP_STATES,
  isClosedHandHomeHelpRail,
  isHomeHelpRailRows,
  isLegacyThreeWayHomeHelp,
} from './home-help-states'
import { rolunkBemutatkozasBekezdesek } from './rolunk-bemutatkozas'
import { sanitizeCmsUrl } from './safe-url'
import { SOS_COMPARISON_FAQ } from './sos-offer-copy'

export type OwnerReviewSlug = 'kezdolap' | 'szolgaltatasok' | 'rolunk' | 'kapcsolat'
export type OwnerReviewMediaRole =
  | 'homeFounders'
  | 'homeSos'
  | 'homeExpectations'
  | 'homeServices'
  | 'servicesJoint'
  | 'servicesBenefits'
  | 'aboutDifference'
  | 'aboutPhoto'
  | 'kocsisPortrait'
  | 'kissPortrait'

export interface OwnerReviewV1Input {
  slug: OwnerReviewSlug
  layout: Page['layout']
  /** Approved OLD builder output, including old media IDs; never copy the live layout here. */
  canonicalLayout: NonNullable<Page['layout']>
  mediaByRole?: Partial<Record<OwnerReviewMediaRole, number>>
  /** The caller must resolve and verify the paid full course, not the free SOS product. */
  completeCourseHref?: string
}

export interface OwnerReviewChange {
  requestId: string
  blockId: string | null
  /** JSON Pointer into the INPUT layout; structural changes use /layout. */
  path: string
  reason: string
  before?: unknown
  after?: unknown
}

export interface OwnerReviewSkip extends OwnerReviewChange {
  code: string
}

export interface OwnerReviewV1Result {
  layout: NonNullable<Page['layout']>
  changes: OwnerReviewChange[]
  skips: OwnerReviewSkip[]
}

type Layout = NonNullable<Page['layout']>
type Block = Layout[number]
type RecordValue = Record<string, unknown>
type Path = (string | number)[]
type Target = { old: Block; index: number }
type Spec = {
  type: Block['blockType']
  title?: string
  nextTitle?: string
  nextType?: Block['blockType']
  anchor?: string
}

const record = (value: unknown): RecordValue =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as RecordValue) : {}

const mediaIdOf = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  const nested = record(value).id
  return typeof nested === 'number' && Number.isSafeInteger(nested) && nested > 0
    ? nested
    : undefined
}

/** A 2026-09-07 előtti A05 által beszúrt bevezető portré-csomópont azonosító-előtagja. */
export const OWNER_REVIEW_PORTRAIT_NODE_PREFIX = 'owner-review-v1-'

/**
 * A 2026-09-07 előtti A05 a portrét a lenyitott tartalom ELSŐ upload-
 * csomópontjaként szúrta be. Mióta a harmonika-sor `kep` mezője viszi a
 * portrét (csukva is látszik), ez a csomópont ugyanazt a képet ismételné.
 * Ha a tartalom első gyermeke PONTOSAN ilyen (upload, a saját előtagú id-val,
 * ugyanarra a Media-id-ra), a nélküle álló tartalmat adja vissza; minden más
 * tartalmat változatlanul (ugyanazt a referenciát).
 */
export const withoutOwnerReviewPortraitNode = (tartalom: unknown, mediaId: number): unknown => {
  const children = at(tartalom, ['root', 'children'])
  if (!Array.isArray(children) || children.length === 0) return tartalom
  const first = record(children[0])
  if (
    first.type !== 'upload' ||
    mediaIdOf(first.value) !== mediaId ||
    typeof first.id !== 'string' ||
    !first.id.startsWith(OWNER_REVIEW_PORTRAIT_NODE_PREFIX)
  ) {
    return tartalom
  }
  return setAt(tartalom, ['root', 'children'], children.slice(1))
}

const at = (value: unknown, path: Path): unknown =>
  path.reduce<unknown>(
    (current, key) =>
      current === null || current === undefined
        ? undefined
        : (current as Record<string | number, unknown>)[key],
    value,
  )

const setAt = (value: unknown, [key, ...rest]: Path, next: unknown): unknown => {
  if (key === undefined) return next
  const copy = Array.isArray(value) ? [...value] : { ...record(value) }
  ;(copy as Record<string | number, unknown>)[key] = setAt(at(value, [key]), rest, next)
  return copy
}

// Payload adds row IDs and null optional fields. Media relationships must still match by ID.
const normalized = (value: unknown, field = ''): unknown => {
  if (
    ['photo', 'image', 'backgroundImage', 'value', 'kep'].includes(field) &&
    typeof record(value).id === 'number'
  ) {
    return record(value).id
  }
  if (Array.isArray(value)) return value.map((item) => normalized(item))
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(record(value))
        .filter(([key, item]) => key !== 'id' && item !== undefined && item !== null)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, normalized(item, key)]),
    )
  }
  return value ?? null
}

const equal = (left: unknown, right: unknown, field = ''): boolean =>
  JSON.stringify(normalized(left, field)) === JSON.stringify(normalized(right, field))

// Published allowlists retain nulls, media IDs, formatting and unknown fields.
// Only generated row/block IDs and JSON key order are irrelevant to these exact matches.
const withoutIds = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(withoutIds)
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(record(value))
        .filter(([key]) => key !== 'id')
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, withoutIds(item)]),
    )
  return value
}
const exactPublished = (left: unknown, right: unknown): boolean =>
  JSON.stringify(withoutIds(left)) === JSON.stringify(withoutIds(right))

// Owner-approved public capture, 2026-09-05. Not a baseline for any other live content.
const PUBLISHED_STATES = {
  blockType: 'states',
  title: 'Három állapot, egy folyamat',
  blockName: null,
  lead: 'A terápia íve három képben: a fájdalomtól zárt kézből előbb oldódik a görcs, aztán visszatér a szabad mozgás. Ugyanezt a három állapotot rajzolja ki a logónk is.',
  cards: [
    {
      number: null,
      title: 'Zárt',
      text: 'Fájdalom, bizonytalanság, a kéz védekezése. Ismerős, ha hónapok óta szenvedsz.',
    },
    {
      number: null,
      title: 'Nyíló',
      text: 'A közös munka meghozza az első enyhülést. Minden alkalommal egy mozdulattal több lesz.',
    },
    {
      number: null,
      title: 'Nyitott',
      text: 'Újra a saját kezed. Munkázhatsz, sportolhatsz, önfeledten élhetsz.',
    },
  ],
  sectionSettings: { visible: true, anchorId: null, hatter: 'feher' },
}
const PUBLISHED_FAQ = {
  blockType: 'faq',
  heading: 'Gyakori kérdések',
  blockName: null,
  items: [
    {
      question: 'Műtét után is végezhetem a gyakorlatokat?',
      answer:
        'A kurzusok általános rehabilitációs programok. Műtét után mindig a kezelőorvosod vagy gyógytornászod jóváhagyásával kezdj bele — ha bizonytalan vagy, írj nekünk a kapcsolat oldalon, és segítünk eligazodni.',
    },
    {
      question: 'Fájdalmasak a gyakorlatok?',
      answer:
        'Nem kell, hogy fájjanak. A gyakorlatokat a saját tűrőképességedhez igazítod; éles fájdalom esetén hagyd abba, és kérj szakmai segítséget.',
    },
    {
      question: 'Mennyi időt vesz igénybe naponta?',
      answer:
        'Napi 10–15 perc is elég — a rövid, rendszeres gyakorlás hozza a tartós eredményt, nem az egyszeri nagy erőfeszítés.',
    },
    {
      question: 'Szükségem van eszközökre a gyakorlatokhoz?',
      answer:
        'Nem. A gyakorlatok többsége saját testsúllyal, otthon található eszközökkel végezhető — ahol bármi kell, azt a videóban jelezzük.',
    },
  ],
  sectionSettings: { visible: true, anchorId: null, hatter: 'feher' },
}
const PUBLISHED_PRACTICE_TEXT =
  'A gyakorlatok lépésről lépésre vezetnek — naponta néhány perc is elég a haladáshoz.'

// Exact legacy rolunkSzakemberNodes prefix, confirmed in the same approved capture.
const LEGACY_BIO_PREFIX = [
  ['heading', 'Kocsis Kata'],
  [
    'paragraph',
    'Gyógytornász, sportrehabilitációs tréner, gyógymasszőr – telefon: +36 30 169 2263',
  ],
  ['heading', 'Kiss Kata'],
  [
    'paragraph',
    'Gyógytornász, manuálterapeuta, sportrehabilitációs tréner – telefon: +36 20 357 3493',
  ],
].map(([type, text]) => ({
  type,
  ...(type === 'heading' ? { tag: 'h2' } : {}),
  format: '',
  indent: 0,
  version: 1,
  direction: null,
  children: [{ type: 'text', text, mode: 'normal', style: '', detail: 0, format: 0, version: 1 }],
}))

const blockTitle = (block: Block): unknown => record(block).title ?? record(block).heading
// Payload materializes an unset optional anchor as null; builders may omit it.
const blockAnchor = (block: Block): unknown => at(block, ['sectionSettings', 'anchorId']) ?? null
const withRowIds = (next: RecordValue[], current: unknown): RecordValue[] =>
  next.map((row, index) => {
    const id = at(current, [index, 'id'])
    return id === undefined ? { ...row } : { ...row, id }
  })

const HOME_ABOUT: Spec = { type: 'about', title: 'Kiss Kata és Kocsis Kata vagyunk' }
const HOME_SERVICES: Spec = { type: 'services', title: 'Így tudunk segíteni' }
const HOME_STATES: Spec = { type: 'states', title: 'Három állapot, egy folyamat' }
const SERVICE_ROWS: Spec = {
  type: 'services',
  title: 'Válaszd ki, hogyan segíthetünk neked a legjobban',
  nextTitle: 'Így segítünk',
  anchor: 'szolgaltatasaink',
}

const HOME_PARAGRAPHS = [
  {
    text: 'Kiss Kata és Kocsis Kata vagyunk, gyógytornászok. A kéz, a csukló, a könyök és a váll rehabilitációjával foglalkozunk.',
    emphasized: true,
  },
  {
    text: 'Személyes kezeléssel és otthoni videókurzussal segítünk eligazodni a lehetőségeid között. Közös célunk, hogy könnyebben menjenek a mindennapi mozdulatok.',
    emphasized: false,
  },
]

// A02: az ÉLES /rolunk About bekezdései — a kezdőlappal KÖZÖS forrásból
// (WP18, src/lib/rolunk-bemutatkozas.ts), hogy a review, a seed és a
// tartalom-csere ne csúszhasson szét.
const ABOUT_PARAGRAPHS = rolunkBemutatkozasBekezdesek()

const GENERAL_FAQ = [
  {
    question: 'Online kurzust vagy személyes kezelést válasszak?',
    answer:
      'A kurzus előre összeállított gyakorlatsorokat ad az otthoni mozgáshoz. Személyes kezelésen megvizsgálunk, és hozzád igazítjuk a kezelési tervet. Ha bizonytalan vagy, keress minket, és segítünk eligazodni.',
  },
  { ...SOS_COMPARISON_FAQ },
  {
    question: 'Hogyan kérhetek időpontot személyes kezelésre?',
    answer:
      'A Kapcsolat oldalon megtalálod az időpontkérő űrlapot és az elérhetőségeinket. A rendelői alkalom részleteit közösen egyeztetjük.',
  },
  {
    question: 'Kérdezhetek, mielőtt választok?',
    answer:
      'Igen. A Kapcsolat oldalon elérsz minket, ha kérdésed van a kezelésekről vagy a kurzusokról. Segítünk átgondolni, melyik lehetőséggel érdemes továbbindulnod.',
  },
]

// These two conditions already existed in the approved canonical FAQ; no new medical advice.
const PRACTICE_SAFETY_FAQ = {
  question: 'Mire figyeljek a gyakorlatok előtt és közben?',
  answer:
    'Műtét után mindig a kezelőorvosod vagy gyógytornászod jóváhagyásával kezdj bele. Éles fájdalom esetén hagyd abba, és kérj szakmai segítséget.',
}

/** Offline planner only: no config, Payload, filesystem, clock, network or bootstrap imports. */
export function planOwnerReviewV1(input: OwnerReviewV1Input): OwnerReviewV1Result {
  const original = input.layout ?? []
  let layout = original
  const changes: OwnerReviewChange[] = []
  const skips: OwnerReviewSkip[] = []
  const removed = new Set<number>()

  const detail = (requestId: string, index: number | null, path: Path = []): OwnerReviewChange => ({
    requestId,
    blockId: index === null ? null : (original[index]?.id ?? null),
    path:
      index === null
        ? '/layout'
        : `/layout/${index}${path.map((part) => `/${String(part).replaceAll('~', '~0').replaceAll('/', '~1')}`).join('')}`,
    reason: '',
  })
  const skip = (
    id: string,
    code: string,
    reason: string,
    index: number | null = null,
    path: Path = [],
  ) => {
    skips.push({ ...detail(id, index, path), code, reason })
  }

  // Resolve identity before editing. A renamed/duplicated target is never guessed by position.
  const resolve = (id: string, spec: Spec): Target | null => {
    const oldMatches = input.canonicalLayout.filter(
      (block) =>
        block.blockType === spec.type &&
        (spec.title === undefined || blockTitle(block) === spec.title) &&
        (spec.anchor === undefined || blockAnchor(block) === spec.anchor),
    )
    if (oldMatches.length !== 1) {
      skip(id, 'canonical-target', 'A régi kanonikus célblokk hiányzik vagy nem egyértelmű.')
      return null
    }
    const old = oldMatches[0]
    const matches = original.flatMap((block, index) => {
      if (old.id && block.id !== old.id) return []
      if (block.blockType !== spec.type && block.blockType !== spec.nextType) return []
      if (spec.anchor !== undefined && blockAnchor(block) !== spec.anchor) return []
      if (
        spec.title !== undefined &&
        blockTitle(block) !== spec.title &&
        (spec.nextTitle === undefined || blockTitle(block) !== spec.nextTitle)
      )
        return []
      return [index]
    })
    if (matches.length !== 1) {
      skip(
        id,
        'target-not-unique',
        'A célblokk hiányzik, átnevezték vagy több példánya van; nem találgatunk.',
      )
      return null
    }
    const index = matches[0]
    if (
      original[index].id &&
      original.filter((block) => block.id === original[index].id).length !== 1
    ) {
      skip(id, 'duplicate-id', 'A blokkazonosító nem egyedi.', index)
      return null
    }
    return { old, index }
  }

  const change = (
    id: string,
    target: Target,
    path: Path,
    before: unknown,
    after: unknown,
    reason: string,
  ) => {
    if (layout === original) layout = [...original]
    layout[target.index] = setAt(layout[target.index], path, after) as Block
    changes.push({ ...detail(id, target.index, path), before, after, reason })
  }

  const field = (id: string, target: Target | null, path: Path, next: unknown): boolean => {
    if (!target) return false
    const before = at(layout[target.index], path)
    const key = String(path.at(-1) ?? '')
    if (equal(before, next, key)) {
      skip(id, 'already-applied', 'Már a kért érték szerepel.', target.index, path)
      return true
    }
    if (!equal(before, at(target.old, path), key)) {
      skip(
        id,
        'editor-change',
        'Nem egyezik pontosan a régi értékkel; a szerkesztő tartalma megmarad.',
        target.index,
        path,
      )
      return false
    }
    change(id, target, path, before, next, 'Pontos régi érték egyezése alapján tervezett csere.')
    return true
  }

  const photo = (id: string, target: Target | null, path: Path, role: OwnerReviewMediaRole) => {
    if (!target) return
    const mediaId = input.mediaByRole?.[role]
    if (!Number.isSafeInteger(mediaId) || (mediaId ?? 0) <= 0) {
      skip(
        id,
        'missing-media',
        `Hiányzó vagy érvénytelen jóváhagyott média: ${role}.`,
        target.index,
        path,
      )
      return
    }
    field(id, target, path, mediaId)
  }

  const paragraphs = (id: string, target: Target | null, next: RecordValue[]) => {
    if (target)
      field(id, target, ['paragraphs'], withRowIds(next, at(layout[target.index], ['paragraphs'])))
  }

  const uspPhoto = (
    id: string,
    title: string,
    role: OwnerReviewMediaRole,
    rows: { title: string; body: string }[],
  ) => {
    const target = resolve(id, { type: 'usps', nextType: 'services', title })
    if (!target) return
    const current = layout[target.index]
    if (current.blockType === 'services') {
      skip(
        id,
        'already-converted',
        'Már képes szolgáltatássor; a későbbi szerkesztéseit nem írjuk felül.',
        target.index,
      )
      return
    }
    const mediaId = input.mediaByRole?.[role]
    if (!Number.isSafeInteger(mediaId) || (mediaId ?? 0) <= 0) {
      skip(id, 'missing-media', `Az átalakításhoz szükséges kép hiányzik: ${role}.`, target.index)
      return
    }
    const contentOnly = (block: Block) =>
      Object.fromEntries(
        Object.entries(block).filter(
          ([key]) => !['sectionSettings', 'blockName', 'id'].includes(key),
        ),
      )
    if (!equal(contentOnly(current), contentOnly(target.old))) {
      skip(
        id,
        'editor-change',
        'Az USP nem teljesen kanonikus; nem alakítjuk át és nem veszítünk el szerkesztői mezőt.',
        target.index,
      )
      return
    }
    const next: Extract<Block, { blockType: 'services' }> = {
      blockType: 'services',
      id: current.id,
      blockName: current.blockName,
      title,
      image: mediaId,
      rows: rows.map((row, index) => ({ ...row, number: String(index + 1).padStart(2, '0') })),
      sectionSettings: current.sectionSettings,
    }
    change(
      id,
      target,
      [],
      current,
      next,
      'Kanonikus USP cseréje képes, kétsoros, szerkeszthető services blokkra.',
    )
  }

  const courseHref = (): string | null => {
    const href = input.completeCourseHref
    return href && /^\/kurzusok\/[a-z0-9][a-z0-9-]*\/?$/.test(href) && !/sos|relax/i.test(href)
      ? href
      : null
  }

  const patchServiceRows = (id: string, target: Target | null) => {
    if (!target) return
    const oldRows = at(target.old, ['rows'])
    const currentRows = at(layout[target.index], ['rows'])
    if (!Array.isArray(oldRows) || !Array.isArray(currentRows)) {
      skip(id, 'missing-rows', 'Hiányzó szolgáltatássorok.', target.index)
      return
    }
    for (const [oldIndex, oldRow] of oldRows.entries()) {
      const matches = currentRows.flatMap((row, index) =>
        record(row).title === record(oldRow).title &&
        (!record(oldRow).id || record(row).id === record(oldRow).id)
          ? [index]
          : [],
      )
      if (matches.length !== 1) {
        skip(
          id,
          'row-not-unique',
          'A szolgáltatássort átnevezték vagy nem egyértelmű.',
          target.index,
          ['rows'],
        )
        continue
      }
      const index = matches[0]
      const rowTarget = { ...target, old: setAt(target.old, ['rows', index], oldRow) as Block }
      if (oldIndex === 1) {
        field(
          id,
          rowTarget,
          ['rows', index, 'body'],
          'Otthoni videókurzusunkkal a saját tempódban gyakorolhatsz. A teljes program tartalmát és árát a kurzus oldalán találod.',
        )
      }
      if (oldIndex === 2) {
        const current = record(currentRows[index])
        const approvedCaption =
          id === 'H08' &&
          current.title === 'Szakmai képzések' &&
          current.url === 'https://probodystudio.hu/kez-workshop/' &&
          current.ujAblakban === true &&
          ['Tovább a kéz workshopra', 'Tovább a szakmai képzésre'].includes(String(current.felirat))
        const captionTarget = approvedCaption
          ? {
              ...rowTarget,
              old: setAt(rowTarget.old, ['rows', index, 'felirat'], current.felirat) as Block,
            }
          : rowTarget
        field(id, captionTarget, ['rows', index, 'felirat'], 'Nézd meg a kézworkshopot')
      }
    }
  }

  if (input.slug === 'kezdolap') {
    const founders = resolve('H01', HOME_ABOUT)
    const hero = resolve('H01', { type: 'filmHero' })
    const how = resolve('H10', { type: 'howItWorks', title: 'Így működik az online kurzus' })
    const courses = resolve('H10', { type: 'courseCards', anchor: 'kurzusok' })
    const services = resolve('H08', HOME_SERVICES)
    const states = resolve('H08', HOME_STATES)

    if (hero) {
      const oldCtas = at(hero.old, ['ctas'])
      const ctas = at(layout[hero.index], ['ctas'])
      const canonical = Array.isArray(oldCtas)
        ? oldCtas.filter((cta) => record(cta).url === '#ingyenes')
        : []
      const matches = Array.isArray(ctas)
        ? ctas.flatMap((cta, index) => (record(cta).url === '#ingyenes' ? [index] : []))
        : []
      if (
        canonical.length !== 1 ||
        matches.length !== 1 ||
        (record(canonical[0]).id && at(ctas, [matches[0], 'id']) !== record(canonical[0]).id)
      ) {
        skip(
          'P03',
          'cta-not-unique',
          'A kanonikus SOS-horgonyhoz tartozó hero-CTA hiányzik vagy nem egyértelmű.',
          hero.index,
          ['ctas'],
        )
      } else {
        const path: Path = ['ctas', matches[0], 'felirat']
        // Explicit legacy caption: the current builder already reads the new vocabulary.
        // P03 must enter the caller's verified-free-product publication HOLD, independently of H13.
        const target = { ...hero, old: setAt(hero.old, path, 'Nézd meg az SOS-kurzust') as Block }
        field('P03', target, path, ctaLabel('free-strip-jump'))
      }
    } else {
      skip('P03', 'target-not-unique', 'A hero nem egyértelmű; az SOS-feliratot nem találgatjuk.')
    }

    paragraphs('H01', founders, HOME_PARAGRAPHS)
    field('H01', founders, ['feature', 'label'], 'Személyre szabott rendelői kezelések')
    field(
      'H01',
      founders,
      ['feature', 'note'],
      'A rendelői kezelési tervet a panaszaidhoz és a terhelhetőségedhez igazítjuk.',
    )
    photo('H01', founders, ['photo'], 'homeFounders')
    if (how) {
      const steps = at(layout[how.index], ['steps'])
      const oldSteps = at(how.old, ['steps'])
      const oldMatches = Array.isArray(oldSteps)
        ? oldSteps.filter((step) => record(step).title === 'Otthon gyakorolsz')
        : []
      const matches = Array.isArray(steps)
        ? steps.flatMap((step, index) =>
            record(step).title === 'Otthon gyakorolsz' &&
            (!record(oldMatches[0]).id || record(step).id === record(oldMatches[0]).id)
              ? [index]
              : [],
          )
        : []
      if (matches.length === 1 && oldMatches.length === 1) {
        const index = matches[0]
        const oldStep =
          at(steps, [index, 'text']) === PUBLISHED_PRACTICE_TEXT
            ? { ...record(oldMatches[0]), text: PUBLISHED_PRACTICE_TEXT }
            : oldMatches[0]
        const target = { ...how, old: setAt(how.old, ['steps', index], oldStep) as Block }
        field(
          'H10',
          target,
          ['steps', index, 'text'],
          'Kövesd a videók útmutatását, és gyakorolj a saját tempódban.',
        )
      } else {
        skip(
          'H10',
          'step-not-unique',
          'Az otthoni gyakorlás lépését átnevezték, hiányzik vagy nem egyértelmű.',
          how.index,
          ['steps'],
        )
      }
    }
    photo(
      'H04',
      resolve('H04', { type: 'freeSos', anchor: 'ingyenes' }),
      ['backgroundImage'],
      'homeSos',
    )
    uspPhoto('H06', 'Erre számíthatsz velünk', 'homeExpectations', [
      {
        title: 'Szakmai figyelem',
        body: 'A kutatásokat és a gyakorlati tapasztalatainkat együtt használjuk. Személyes kezelésen a terhelhetőségedhez igazítjuk a közös munkát.',
      },
      {
        title: 'Segítség a mindennapokhoz',
        body: 'Rendelői kezeléssel és otthoni videókurzussal is támogatunk. Megmutatjuk, hogyan építheted be a gyakorlást a hétköznapjaidba.',
      },
    ])
    if (services) {
      const liveRows = at(layout[services.index], ['rows'])
      const servicesVisible = at(layout[services.index], ['sectionSettings', 'visible']) !== false
      const linkedRows =
        Array.isArray(liveRows) &&
        liveRows.length === 3 &&
        liveRows.every(
          (row) =>
            sanitizeCmsUrl(record(row).url) !== null &&
            typeof record(row).title === 'string' &&
            String(record(row).title).trim().length > 0 &&
            typeof record(row).felirat === 'string' &&
            String(record(row).felirat).trim().length > 0,
        )
      if (isHomeHelpRailRows(liveRows)) {
        field('H08', services, ['elrendezes'], 'sin')
        field('H08', services, ['lead'], HOME_HELP_LEAD)
        field('H08', services, ['sectionSettings', 'hatter'], 'tint')
      } else if (
        (isLegacyThreeWayHomeHelp(liveRows) || isClosedHandHomeHelpRail(liveRows)) &&
        linkedRows &&
        servicesVisible
      ) {
        const liveTarget = { ...services, old: layout[services.index] }
        const canonicalHelpRows = at(services.old, ['rows'])
        const lockedPhotos = Array.isArray(canonicalHelpRows)
          ? canonicalHelpRows.map((row) => mediaIdOf(record(row).photo))
          : []
        const stateCards = states ? at(layout[states.index], ['cards']) : null
        const stillPhotos = Array.isArray(stateCards)
          ? stateCards.map((card) => mediaIdOf(record(card).image))
          : []
        const photos = HOME_HELP_STATES.map((_, index) => lockedPhotos[index] ?? stillPhotos[index])
        const nextRows = withRowIds(
          HOME_HELP_STATES.map((state, index) => ({
            number: state.number,
            title: state.title,
            osszefoglalo: state.osszefoglalo,
            body: state.body,
            felirat: state.felirat,
            url: state.url,
            ujAblakban: state.ujAblakban,
            ...(photos[index] !== undefined ? { photo: photos[index] } : {}),
          })),
          liveRows,
        )
        field('H08', liveTarget, ['elrendezes'], 'sin')
        field('H08', liveTarget, ['lead'], HOME_HELP_LEAD)
        field('H08', liveTarget, ['eyebrow'], '')
        field('H08', liveTarget, ['sectionSettings', 'hatter'], 'tint')
        field('H08', liveTarget, ['rows'], nextRows)
      } else {
        patchServiceRows('H08', services)
      }
    }
    if (services && states) {
      // The approved builder resolves the same assets into this database's IDs.
      // Never derive expected media from the current, potentially edited cards.
      const canonicalCards = at(states.old, ['cards'])
      const reviewedStates =
        Array.isArray(canonicalCards) &&
        canonicalCards.length === PUBLISHED_STATES.cards.length &&
        canonicalCards.every(
          (card, index) =>
            record(card).title === PUBLISHED_STATES.cards[index].title &&
            Number.isSafeInteger(record(card).image) &&
            Number(record(card).image) > 0,
        )
          ? {
              ...PUBLISHED_STATES,
              cards: PUBLISHED_STATES.cards.map((card, index) => ({
                ...card,
                image: record(canonicalCards[index]).image,
              })),
            }
          : null
      const rows = at(layout[services.index], ['rows'])
      const usable =
        Array.isArray(rows) &&
        rows.length === 3 &&
        rows.every(
          (row) =>
            sanitizeCmsUrl(record(row).url) !== null &&
            typeof record(row).title === 'string' &&
            String(record(row).title).trim().length > 0 &&
            typeof record(row).felirat === 'string' &&
            String(record(row).felirat).trim().length > 0,
        )
      if (
        !usable ||
        at(layout[services.index], ['sectionSettings', 'visible']) === false ||
        !isHomeHelpRailRows(rows)
      ) {
        skip(
          'H08',
          'missing-service-links',
          'A háromsoros, látható szolgáltatás-sín és a meglévő CTA-k szükségesek a states kiváltásához.',
          states.index,
        )
      } else if (
        !equal(original[states.index], states.old) &&
        !exactPublished(original[states.index], reviewedStates)
      ) {
        skip(
          'H08',
          'editor-change',
          'Csak a teljesen kanonikus states törölhető; az egyedi tartalom és beállítás megmarad.',
          states.index,
        )
      } else {
        removed.add(states.index)
        changes.push({
          ...detail('H08', states.index),
          before: original[states.index],
          after: null,
          reason:
            'A kanonikus states helyett a három szolgáltatás-ajtó a services sín + panel elrendezésben él.',
        })
      }
    }
    photo('H08', services, ['image'], 'homeServices')

    if (founders) {
      const stats = at(layout[founders.index], ['stats'])
      const oldStats = at(founders.old, ['stats'])
      const matches = Array.isArray(stats)
        ? stats.flatMap((row, index) =>
            record(row).value === '1' &&
            ['közös cél: az Ön mozgásszabadsága', 'közös cél: fájdalommentesség'].includes(
              String(record(row).label),
            )
              ? [index]
              : [],
          )
        : []
      const old = Array.isArray(oldStats)
        ? oldStats.filter(
            (row) =>
              record(row).value === '1' &&
              record(row).label === 'közös cél: az Ön mozgásszabadsága',
          )
        : []
      if (matches.length === 1 && old.length === 1) {
        const index = matches[0]
        field(
          'H09',
          { ...founders, old: setAt(founders.old, ['stats', index], old[0]) as Block },
          ['stats', index, 'label'],
          'közös cél: fájdalommentesség',
        )
      } else
        skip(
          'H09',
          'stat-not-unique',
          'A kanonikus közös cél statisztikasora hiányzik vagy szerkesztett.',
          founders.index,
        )
    }
    const faq = resolve('H13', { type: 'faq', title: 'Gyakori kérdések' })
    if (faq) {
      const items = at(layout[faq.index], ['items'])
      // Upgrade only our exact earlier four-question output, never a staff-edited variant.
      const target = exactPublished(original[faq.index], PUBLISHED_FAQ)
        ? { ...faq, old: setAt(faq.old, ['items'], PUBLISHED_FAQ.items) as Block }
        : equal(items, GENERAL_FAQ)
          ? { ...faq, old: setAt(faq.old, ['items'], GENERAL_FAQ) as Block }
          : faq
      field('H13', target, ['items'], withRowIds([...GENERAL_FAQ, PRACTICE_SAFETY_FAQ], items))
    }

    // A staff reorder is not consent to restore seed order. Compare all identifiable canonical
    // blocks, including approved conversion shapes; unknown blocks keep their relative order.
    const canonicalOrder = input.canonicalLayout.flatMap((old, canonicalIndex) => {
      const matches = original.flatMap((block, index) =>
        (block.blockType === old.blockType ||
          (old.blockType === 'usps' && block.blockType === 'services')) &&
        blockTitle(block) === blockTitle(old) &&
        blockAnchor(block) === blockAnchor(old)
          ? [index]
          : [],
      )
      return matches.length === 1 ? [{ canonicalIndex, index: matches[0] }] : []
    })
    const baseOrder = canonicalOrder.map(({ index }) => index)
    const actualOrder = [...baseOrder].sort((a, b) => a - b)
    const movedOrder = (order: number[], source: Target | null, after: Target | null) => {
      if (!source || !after || !order.includes(source.index) || !order.includes(after.index))
        return order
      const next = order.filter((index) => index !== source.index)
      next.splice(next.indexOf(after.index) + 1, 0, source.index)
      return next
    }
    const approvedOrders = [
      baseOrder,
      movedOrder(baseOrder, founders, hero),
      movedOrder(baseOrder, how, courses),
      movedOrder(movedOrder(baseOrder, founders, hero), how, courses),
    ]
    const orderAllowed = approvedOrders.some((order) => equal(order, actualOrder))
    let indices = original.map((_, index) => index).filter((index) => !removed.has(index))
    const move = (id: string, source: Target | null, after: Target | null) => {
      if (!source || !after) return
      if (indices.indexOf(source.index) === indices.indexOf(after.index) + 1) {
        skip(id, 'already-applied', 'A blokk már közvetlenül a kért helyen van.', source.index)
      } else if (!orderAllowed) {
        skip(
          id,
          'editor-order',
          'A szerkesztő eltérő szekciósorrendjét nem írjuk felül.',
          source.index,
        )
      } else {
        const before = [...indices]
        indices = movedOrder(indices, source, after)
        changes.push({
          ...detail(id, null),
          blockId: original[source.index].id ?? null,
          before,
          after: [...indices],
          reason:
            'Meglévő blokk mozgatása a jóváhagyott sorrenden belül; más blokkot nem építünk újra.',
        })
      }
    }
    move('H01', founders, hero)
    move('H10', how, courses)
    if (removed.size || indices.some((index, position) => index !== position))
      layout = indices.map((index) => layout[index])
  }

  if (input.slug === 'szolgaltatasok') {
    const services = resolve('S01', SERVICE_ROWS)
    photo('S01', services, ['image'], 'servicesJoint')
    if (services) {
      skip(
        'S04',
        'shared-photo',
        'A közös kontextusfotót az S01 ugyanazon services.image mezőben kezeli.',
        services.index,
        ['image'],
      )
      field('S03', services, ['title'], 'Így segítünk')
      patchServiceRows('S03', services)
    }
    const welcome = resolve('S02', {
      type: 'welcome',
      title: 'Fáj a kezed, csuklód, könyököd vagy vállad?',
      nextTitle: 'Fáj a kezed, a csuklód, a könyököd vagy a vállad?',
    })
    field('S02', welcome, ['title'], 'Fáj a kezed, a csuklód, a könyököd vagy a vállad?')
    field('S03', welcome, ['lead'], 'Segítünk megtalálni a következő lépést.')
    if (welcome) {
      field(
        'S03',
        welcome,
        ['checklist'],
        withRowIds(
          [
            {
              text: 'Személyes kezelésen megvizsgálunk, és veled együtt határozzuk meg a célokat.',
            },
            { text: 'Az otthoni gyakorláshoz videókurzust is választhatsz.' },
            { text: 'Ha bizonytalan vagy, segítünk eligazodni a lehetőségek között.' },
          ],
          at(layout[welcome.index], ['checklist']),
        ),
      )
      field(
        'S03',
        welcome,
        ['sideParagraphs'],
        withRowIds(
          [
            {
              text: 'Tudjuk, mennyire megnehezíthetik a kézpanaszok a munkát, a sportot és a hétköznapi mozdulatokat.',
              emphasized: false,
            },
            {
              text: 'Gyógytornával, manuálterápiával és otthoni gyakorlással támogatunk. A célokat és a terhelést személyes kezelésen hozzád igazítjuk.',
              emphasized: true,
            },
          ],
          at(layout[welcome.index], ['sideParagraphs']),
        ),
      )
    }
    const clinic = resolve('S03', { type: 'richText', anchor: 'rendeloi' })
    if (clinic) {
      const path: Path = ['content', 'root', 'children']
      const oldNodes = at(clinic.old, path)
      const nodes = at(layout[clinic.index], path)
      const clinicIntroNodeCount = 5
      if (
        Array.isArray(oldNodes) &&
        Array.isArray(nodes) &&
        oldNodes.length > clinicIntroNodeCount
      ) {
        const shortHeading = {
          ...record(setAt(oldNodes[0], ['children', 0, 'text'], 'Rendelői kezelések')),
          tag: 'h2',
        }
        const shortBody = setAt(
          oldNodes[1],
          ['children', 0, 'text'],
          'Személyes vizsgálat után gyógytornával, manuálterápiával és szükség szerint kiegészítő technikákkal dolgozunk. A kezelési tervet a panaszaidhoz és a terhelhetőségedhez igazítjuk.',
        )
        const nextPrefix = [shortHeading, shortBody]
        if (equal(nodes.slice(0, 2), nextPrefix)) {
          skip(
            'S03',
            'already-applied',
            'A rövid rendelői ismertető már szerepel.',
            clinic.index,
            path,
          )
        } else if (
          equal(nodes.slice(0, clinicIntroNodeCount), oldNodes.slice(0, clinicIntroNodeCount))
        ) {
          change(
            'S03',
            clinic,
            path,
            nodes,
            [...nextPrefix, ...nodes.slice(clinicIntroNodeCount)],
            'Csak a pontos régi rendelői bevezető rövidül; az árlista és az utána álló tartalom változatlan.',
          )
        } else
          skip(
            'S03',
            'editor-change',
            'A rendelői bevezetőt szerkesztették; az árlistához sem nyúlunk.',
            clinic.index,
            path,
          )
      } else
        skip(
          'S03',
          'canonical-content',
          'A rendelői Lexical-tartalom nem a várt szerkezetű.',
          clinic.index,
          path,
        )
    }
    uspPhoto('S05', 'Ezért fogod imádni', 'servicesBenefits', [
      {
        title: 'A kéz a szakterületünk',
        body: 'Évek óta foglalkozunk kézrehabilitációval. A szakmai kutatásokat és a rendelőben szerzett tapasztalatainkat együtt használjuk.',
      },
      {
        title: 'A hétköznapokra készülünk',
        body: 'A célunk, hogy könnyebben menjenek a számodra fontos mozdulatok. A kezelések mellett az otthoni gyakorlásban is segítünk.',
      },
    ])
    const href = courseHref()
    if (!href)
      skip(
        'S06',
        'missing-paid-course',
        'A CLI által igazolt teljes, fizetős kurzus belső URL-je szükséges.',
      )
    else if (services) {
      const rows = at(layout[services.index], ['rows'])
      const oldRows = at(services.old, ['rows'])
      const matches = Array.isArray(rows)
        ? rows.flatMap((row, index) =>
            record(row).title === 'Otthoni online program' ? [index] : [],
          )
        : []
      const oldMatches = Array.isArray(oldRows)
        ? oldRows.filter((row) => record(row).title === 'Otthoni online program')
        : []
      if (matches.length === 1 && oldMatches.length === 1) {
        const index = matches[0]
        const target = {
          ...services,
          old: setAt(services.old, ['rows', index], oldMatches[0]) as Block,
        }
        const url = at(layout[target.index], ['rows', index, 'url'])
        const label = at(layout[target.index], ['rows', index, 'felirat'])
        if (
          (equal(url, record(oldMatches[0]).url) && equal(label, record(oldMatches[0]).felirat)) ||
          (url === href && label === 'Nézd meg a teljes kurzust')
        ) {
          field('S06', target, ['rows', index, 'url'], href)
          field('S06', target, ['rows', index, 'felirat'], 'Nézd meg a teljes kurzust')
        } else
          skip(
            'S06',
            'editor-change',
            'A kurzuslinket vagy feliratát szerkesztették; a pár együtt marad.',
            target.index,
            ['rows', index],
          )
      } else skip('S06', 'row-not-unique', 'A teljes kurzus kanonikus sora nem egyértelmű.')
    }
    skip(
      'S06',
      'accordion-snapshot-required',
      'A régi buildSzolgaltatasokLayout nem tartalmaz kurzusharmonikát. Egyedi élő harmonikához külön jóváhagyott exact-match pillanatkép kell; globális URL-csere nincs.',
    )
  }

  if (input.slug === 'rolunk') {
    const about = resolve('A02', {
      type: 'about',
      title: 'Megérdemled a profi törődést',
      anchor: 'rolunk',
    })
    paragraphs('A02', about, ABOUT_PARAGRAPHS)
    photo('A01', about, ['photo'], 'aboutPhoto')
    uspPhoto('A03', 'Amiben mások vagyunk', 'aboutDifference', [
      {
        title: 'A kézre figyelünk',
        body: 'A kéz rehabilitációja a szakterületünk. A kutatásokat és a gyakorlati tapasztalatainkat együtt használjuk a közös munkában.',
      },
      {
        title: 'Veled dolgozunk',
        body: 'Személyes kezelésen megbeszéljük, mely mozdulatok fontosak neked, és ezekhez igazítjuk a célokat. Az otthoni gyakorláshoz is adunk kapaszkodót.',
      },
    ])
    const cv = resolve('A05', {
      type: 'accordion',
      title: 'Részletes szakmai háttér',
      anchor: 'szakmai-hatter',
    })
    if (cv) {
      // A05 (2026-09-07): a portré a harmonika-sor `kep` mezőjébe kerül (a
      // csukott sor elején, kis körben), NEM a lenyitott tartalom tetejére —
      // így a kép nem ismétlődik. A sor címe a régi seed („Név — szakmai
      // önéletrajz") és az új, gondolatjel nélküli alak szerint is felismert.
      for (const [name, role] of [
        ['Kocsis Kata', 'kocsisPortrait'],
        ['Kiss Kata', 'kissPortrait'],
      ] as const) {
        const items = at(layout[cv.index], ['items'])
        const oldItems = at(cv.old, ['items'])
        const titles = [`${name} — szakmai önéletrajz`, `${name} szakmai önéletrajza`]
        const isBio = (item: unknown) => {
          const cim = record(item).cim
          return typeof cim === 'string' && titles.includes(cim)
        }
        const matches = Array.isArray(items)
          ? items.flatMap((item, index) => (isBio(item) ? [index] : []))
          : []
        const oldMatches = Array.isArray(oldItems) ? oldItems.filter(isBio) : []
        const mediaId = input.mediaByRole?.[role]
        if (matches.length !== 1 || oldMatches.length !== 1) {
          skip('A05', 'bio-not-unique', `Nem egyértelmű a szakmai háttér: ${name}.`, cv.index)
          continue
        }
        if (mediaId === undefined || !Number.isSafeInteger(mediaId) || mediaId <= 0) {
          skip('A05', 'missing-media', `Hiányzó portré: ${role}.`, cv.index)
          continue
        }
        const index = matches[0]
        const path: Path = ['items', index, 'kep']
        const current = at(layout[cv.index], path)
        if (mediaIdOf(current) === mediaId) {
          skip('A05', 'already-applied', 'Már a kért portré szerepel.', cv.index, path)
          continue
        }
        if (current !== undefined && current !== null) {
          skip(
            'A05',
            'editor-change',
            `A(z) ${name} sorának portréját a szerkesztő már beállította; érintetlen marad.`,
            cv.index,
            path,
          )
          continue
        }
        // Az élő sor `kep` mezője üres (régi seed): a kanonikus érték a portré.
        const target = { ...cv, old: setAt(cv.old, path, current) as Block }
        if (!field('A05', target, path, mediaId)) continue
        // A régi A05 saját bevezető portré-csomópontja ugyanazt a képet
        // ismételné a lenyitott tartalom tetején: pontos egyezésre levesszük.
        const tartalomPath: Path = ['items', index, 'tartalom']
        const tartalom = at(layout[cv.index], tartalomPath)
        const tisztitott = withoutOwnerReviewPortraitNode(tartalom, mediaId)
        if (tisztitott !== tartalom) {
          change(
            'A05',
            target,
            tartalomPath,
            tartalom,
            tisztitott,
            'A korábbi bevezető portré-csomópont a sor portré-mezőjébe költözött; a tartalom tetején nem ismétlődik.',
          )
        }
      }
    }

    // Run structural insertion last: all earlier targets use indices into the input layout.
    const convertLegacyBios = () => {
      if (original.some((block) => block.blockType === 'teamMembers')) {
        skip('A06', 'existing-team', 'A meglévő szerkeszthető szakemberblokk érintetlen marad.')
        return
      }
      const candidates = original.flatMap((block, index) => {
        const nodes = at(block, ['content', 'root', 'children'])
        return block.blockType === 'richText' &&
          Array.isArray(nodes) &&
          exactPublished(nodes.slice(0, 4), LEGACY_BIO_PREFIX)
          ? [index]
          : []
      })
      if (candidates.length !== 1) {
        skip(
          'A06',
          'bio-prefix-not-unique',
          'A jóváhagyott négy-node-os szakemberbevezető hiányzik vagy nem egyedi.',
        )
        return
      }
      const index = candidates[0]
      const current = layout[index]
      if (current.id && original.filter((block) => block.id === current.id).length !== 1) {
        skip('A06', 'duplicate-id', 'A blokkazonosító nem egyedi.', index)
        return
      }
      if (at(current, ['sectionSettings', 'visible']) === false) {
        skip('A06', 'hidden-source', 'Rejtett szakembertartalmat nem teszünk közzé.', index)
        return
      }
      // A kanonikus blokkot a horgonya azonosítja, nem a címe: a /rolunk
      // szakember-szekciójának címe 2026-09-07-én (WP15) személyközpontúra
      // változott („Akik a kezeddel foglalkoznak"), a horgony változatlan.
      const canonicalTeams = input.canonicalLayout.filter(
        (block) => block.blockType === 'teamMembers' && blockAnchor(block) === 'elerhetoseg',
      )
      if (canonicalTeams.length !== 1) {
        skip(
          'A06',
          'canonical-team',
          'A jóváhagyott szakemberblokk hiányzik vagy nem egyértelmű.',
          index,
        )
        return
      }
      if (original.some((block) => blockAnchor(block) === 'elerhetoseg')) {
        skip(
          'A06',
          'anchor-conflict',
          'Az elerhetoseg horgony már foglalt; nem hozunk létre ütközést.',
          index,
        )
        return
      }
      const team = structuredClone(canonicalTeams[0]) as Extract<
        Block,
        { blockType: 'teamMembers' }
      >
      const expectedMembers = [
        ['Kocsis Kata', 'kocsisPortrait'],
        ['Kiss Kata', 'kissPortrait'],
      ] as const
      if (
        team.members?.length !== 2 ||
        expectedMembers.some(
          ([name]) => team.members?.filter((member) => member.name === name).length !== 1,
        )
      ) {
        skip(
          'A06',
          'canonical-members',
          'A két névhez kötött kanonikus szakember szükséges.',
          index,
        )
        return
      }
      for (const [name, role] of expectedMembers) {
        const member = team.members.find((member) => member.name === name)!
        const replacement = input.mediaByRole?.[role]
        const mediaId =
          replacement === undefined
            ? typeof member.photo === 'number'
              ? member.photo
              : member.photo?.id
            : replacement
        if (!Number.isSafeInteger(mediaId) || (mediaId ?? 0) <= 0) {
          skip('A06', 'missing-media', `Érvényes, névhez rendelt portré szükséges: ${role}.`, index)
          return
        }
        member.photo = mediaId
        delete member.id
      }
      delete team.id
      const path = ['content', 'root', 'children']
      const nodes = at(current, path) as unknown[]
      change(
        'A06',
        { old: original[index], index },
        path,
        nodes,
        nodes.slice(4),
        'Csak a jóváhagyott négy szakember-node kiváltása; minden további partner-node változatlan.',
      )
      layout = [...layout.slice(0, index), team, ...layout.slice(index)]
      changes.push({
        ...detail('A06', null),
        blockId: current.id ?? null,
        before: null,
        after: team,
        reason: 'Kanonikus, portrés teamMembers beillesztése a megőrzött partnerszöveg elé.',
      })
    }
    convertLegacyBios()
  }

  if (input.slug === 'kapcsolat') {
    const contact = resolve('C02', {
      type: 'teamMembers',
      title: 'Kit hívj, ha nem várnál a visszahívásra?',
      nextTitle: 'Beszéljünk',
      anchor: 'elerhetoseg',
    })
    field('C02', contact, ['title'], 'Beszéljünk')
  }

  return { layout, changes, skips }
}
