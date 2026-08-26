/**
 * systeme.io címke-értelmezés: purchase (hozzáférés), refund (kiüt vásárlás-címkét),
 * ignore (nem vásárlás). Ismeretlen címke → figyelmeztetés, sor folytatódik.
 * Címke→SKU a CLI `--map`-ből jön, nem itt.
 */

import { normalizeKey } from './normalize'

export type SystemeTagKind = 'purchase' | 'refund' | 'ignore'

/** Egy címke-szabály. A `cancels` csak `refund`-nál értelmezett. */
export interface SystemeTagRule {
  /** A címke eredeti írásmódja (a naplóban és a `--map` javaslatban ez jelenik meg). */
  readonly tag: string
  readonly kind: SystemeTagKind
  /** `refund` esetén: melyik VÁSÁRLÁS-címkét üti ki. */
  readonly cancels?: string
  /** Emberi magyarázat a súgóhoz és a mérleghez. */
  readonly note: string
}

/**
 * A tulajdonos által átadott systeme.io-lista címkéi (2026-08-16-i export).
 *
 * A tábla azért él kódban, mert a VISSZATÉRÍTÉS-párosítás („melyik címkét üti
 * ki") üzleti tudás, nem formátum-kérdés — a CSV-ből nem következik. Új címke
 * kódmódosítás nélkül is felvehető a CLI `--ignore-tag` és `--refund-tag`
 * kapcsolóival.
 */
export const SYSTEME_TAG_RULES: readonly SystemeTagRule[] = [
  {
    tag: 'SOS KézRelax vásárló',
    kind: 'purchase',
    note: 'Az ingyenes SOS Kézrelax villámkurzus vásárlója.',
  },
  {
    tag: 'Otthoni KézRehab vásárló',
    kind: 'purchase',
    note: 'A fizetős Otthoni KézRehab Program vásárlója.',
  },
  {
    tag: 'Előjelentkezők',
    kind: 'ignore',
    note: 'Érdeklődő (előjelentkező) — NEM vásárlás, hozzáférést nem ad.',
  },
  {
    tag: 'Visszatérítés KézRelax',
    kind: 'refund',
    cancels: 'SOS KézRelax vásárló',
    note: 'Visszatérített SOS Kézrelax — a kurzushoz nem jár hozzáférés.',
  },
  {
    tag: 'Visszatérítés Kézrehab',
    kind: 'refund',
    cancels: 'Otthoni KézRehab vásárló',
    note: 'Visszatérített Otthoni KézRehab — a kurzushoz nem jár hozzáférés.',
  },
]

/** Normalizált címke-kulcs → szabály. */
export interface TagRuleSet {
  readonly byKey: ReadonlyMap<string, SystemeTagRule>
}

export interface TagRuleSetResult {
  readonly ruleSet: TagRuleSet
  /** Magyar hibaüzenetek a hibás `--ignore-tag` / `--refund-tag` értékekre. */
  readonly errors: readonly string[]
}

export interface TagRuleOptions {
  /** További, hozzáférést NEM adó címkék (`--ignore-tag "Hírlevél"`). */
  readonly ignoreTags?: readonly string[]
  /** További visszatérítés-párok `"Visszatérítés X=Vásárlás-címke"` alakban. */
  readonly refundPairs?: readonly string[]
}

/**
 * A szabálytábla összeállítása: a beépített szabályok + a CLI-ből érkező
 * kiegészítések. A későbbi bejegyzés felülírja a korábbit (a CLI erősebb).
 */
export function buildTagRuleSet(options: TagRuleOptions = {}): TagRuleSetResult {
  const byKey = new Map<string, SystemeTagRule>()
  const errors: string[] = []

  for (const rule of SYSTEME_TAG_RULES) {
    byKey.set(normalizeKey(rule.tag), rule)
  }

  for (const raw of options.ignoreTags ?? []) {
    const tag = raw.trim()
    if (tag === '') {
      errors.push('Hibás --ignore-tag érték: a címke nem lehet üres.')
      continue
    }
    byKey.set(normalizeKey(tag), {
      tag,
      kind: 'ignore',
      note: 'A futtató jelölte nem-vásárlás címkének (--ignore-tag).',
    })
  }

  for (const raw of options.refundPairs ?? []) {
    const separator = raw.indexOf('=')
    if (separator === -1) {
      errors.push(
        `Hibás --refund-tag érték: "${raw}". A helyes forma: --refund-tag "Visszatérítés-címke=Vásárlás-címke".`,
      )
      continue
    }
    const tag = raw.slice(0, separator).trim()
    const cancels = raw.slice(separator + 1).trim()
    if (tag === '' || cancels === '') {
      errors.push(
        `Hibás --refund-tag érték: "${raw}". Sem a visszatérítés-, sem a vásárlás-címke nem lehet üres.`,
      )
      continue
    }
    byKey.set(normalizeKey(tag), {
      tag,
      kind: 'refund',
      cancels,
      note: 'A futtató jelölte visszatérítés-címkének (--refund-tag).',
    })
  }

  return { ruleSet: { byKey }, errors }
}

/**
 * Egy `Tag` cella címkékre bontása.
 *
 * A systeme.io vesszővel sorolja fel a címkéket EGY idézőjeles cellában (a
 * mező-szintű vesszőt a CSV-tokenizer már feldolgozta, ide csak a cella
 * BELSEJE jut el). A `|` és `;` azért is elválasztó, mert más exportok azokat
 * használják — a címkéinkben egyik sem fordul elő.
 */
export function splitTagCell(cell: string): string[] {
  const seen = new Set<string>()
  const tags: string[] = []
  for (const raw of cell.split(/[,|;]/)) {
    const tag = raw.trim()
    if (tag === '') {
      continue
    }
    const key = normalizeKey(tag)
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    tags.push(tag)
  }
  return tags
}

/** Egy sor címkéinek értelmezése. */
export interface TagClassification {
  /** A ténylegesen JÁRÓ hozzáférések címkéi (a visszatérítettek nélkül). */
  readonly courseNames: readonly string[]
  /** Visszatérítés miatt KIHAGYOTT vásárlás-címkék. */
  readonly refundedCourseNames: readonly string[]
  /** Hozzáférést nem adó, de ismert címkék (pl. előjelentkező). */
  readonly ignoredTags: readonly string[]
  /** Visszatérítés-címke, amihez a sorban nincs megfelelő vásárlás-címke. */
  readonly unmatchedRefundTags: readonly string[]
  /** Egyik szabályba sem illő címkék — figyelmeztetés, hozzáférés nélkül. */
  readonly unknownTags: readonly string[]
}

/**
 * A címkék besorolása.
 *
 * KÉT MENETBEN: előbb a visszatérítés-címkéket gyűjtjük össze (a sorrend így
 * nem számít — a `Visszatérítés` állhat a vásárlás-címke ELŐTT is), aztán
 * döntünk a vásárlás-címkékről. A visszatérítés KIZÁRÓLAG a saját párját üti
 * ki: a sor másik, nem visszatérített kurzusa jár.
 */
export function classifyTags(
  tags: readonly string[],
  ruleSet: TagRuleSet,
): TagClassification {
  const cancelledKeys = new Set<string>()
  const refundTags: { tag: string; cancels: string }[] = []

  for (const tag of tags) {
    const rule = ruleSet.byKey.get(normalizeKey(tag))
    if (rule?.kind === 'refund' && rule.cancels !== undefined) {
      cancelledKeys.add(normalizeKey(rule.cancels))
      refundTags.push({ tag, cancels: rule.cancels })
    }
  }

  const courseNames: string[] = []
  const refundedCourseNames: string[] = []
  const ignoredTags: string[] = []
  const unknownTags: string[] = []
  const grantedKeys = new Set<string>()

  for (const tag of tags) {
    const key = normalizeKey(tag)
    const rule = ruleSet.byKey.get(key)
    if (rule === undefined) {
      unknownTags.push(tag)
      continue
    }
    if (rule.kind === 'refund') {
      continue
    }
    if (rule.kind === 'ignore') {
      ignoredTags.push(tag)
      continue
    }
    if (cancelledKeys.has(key)) {
      refundedCourseNames.push(rule.tag)
      continue
    }
    if (!grantedKeys.has(key)) {
      grantedKeys.add(key)
      // A szabálytábla írásmódja megy tovább (nem a cella írásmódja): így a
      // `--map "Címke=SKU"` pár egyetlen, kiszámítható alakra hivatkozik.
      courseNames.push(rule.tag)
    }
  }

  const unmatchedRefundTags = refundTags
    .filter(({ cancels }) => !refundedCourseNames.some((name) => normalizeKey(name) === normalizeKey(cancels)))
    .map(({ tag }) => tag)

  return {
    courseNames,
    refundedCourseNames,
    ignoredTags,
    unmatchedRefundTags,
    unknownTags,
  }
}
