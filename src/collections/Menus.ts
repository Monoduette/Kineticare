import { revalidateTag } from 'next/cache'
import {
  ValidationError,
  type CollectionAfterChangeHook,
  type CollectionAfterDeleteHook,
  type CollectionBeforeValidateHook,
  type CollectionConfig,
} from 'payload'

import { visibleMenusOrAdmin } from '../access/menus-visibility'
import { rootMenuParentFilter } from '../lib/admin/relationship-filters'
import { MENUS_CACHE_TAG } from '../lib/cache-tags'
import { logger, type Logger } from '../lib/logger'
import {
  clearMismatchedMenuRef,
  filterMenuRefOptions,
  validateMenuParentChain,
  validateMenuTypeConsistency,
  type MenuValidationIssue,
} from '../lib/menu-validation'
import { validateCmsUrl } from '../lib/safe-url'

/**
 * Menüfa-validáció (T-013): max 2 szint (gyökér → gyermek), nincs önmagára
 * mutatás/ciklus, és type-konzisztens cél (url → url kötelező; egyéb type →
 * ref kötelező és a type-hoz tartozó collectionre mutat). A szabálylogika az
 * src/lib/menu-validation.ts-ben él, DB nélkül unit-tesztelhető.
 */
const validateMenu: CollectionBeforeValidateHook = async ({ data, originalDoc, req }) => {
  if (!data) return data

  const normalized = clearMismatchedMenuRef(data)

  const issues: MenuValidationIssue[] = [
    ...validateMenuTypeConsistency(normalized),
    ...(await validateMenuParentChain({
      docId: originalDoc?.id ?? null,
      parent: data.parent,
      fetchById: async (id) => {
        try {
          const doc = await req.payload.findByID({
            collection: 'menus',
            id,
            depth: 0,
            overrideAccess: true,
          })
          return doc ? { id: doc.id, parent: doc.parent } : null
        } catch {
          return null
        }
      },
    })),
  ]

  if (issues.length > 0) {
    throw new ValidationError({
      collection: 'menus',
      errors: issues.map((issue) => ({ message: issue.message, path: issue.path })),
    })
  }

  return normalized
}

export interface RevalidateMenusCacheDeps {
  revalidate?: (tag: string, profile: { expire: number }) => void
  log?: Pick<Logger, 'warn'>
}

export function revalidateMenusCache(deps: RevalidateMenusCacheDeps = {}): boolean {
  const revalidate = deps.revalidate ?? revalidateTag
  const log = deps.log ?? logger
  try {
    revalidate(MENUS_CACHE_TAG, { expire: 0 })
    return true
  } catch (error) {
    log.warn(
      'menü-gyorsítótár ürítése sikertelen — a navigáció legfeljebb a lejáratig régi maradhat',
      { error: error instanceof Error ? error.message : String(error) },
    )
    return false
  }
}

const revalidateMenusAfterChange: CollectionAfterChangeHook = ({ doc }) => {
  revalidateMenusCache()
  return doc
}

const revalidateMenusAfterDelete: CollectionAfterDeleteHook = ({ doc }) => {
  revalidateMenusCache()
  return doc
}

export const Menus: CollectionConfig = {
  slug: 'menus',
  labels: {
    singular: 'Menüpont',
    plural: 'Menüpontok',
  },
  admin: {
    useAsTitle: 'label',
    group: 'Navigáció',
    defaultColumns: ['label', 'type', 'order', 'visible'],
    description:
      'Az oldal tetején látszó menü. Legfeljebb 2 szint: főmenüpont és alatta almenüpontok.',
  },
  access: {
    // T-013: nyilvános olvasás, de nem-admin csak a visible=true sorokat látja.
    // A centrális politika (src/access/policies.ts) ugyanezt a függvényt
    // applikálja — a kettő szándékosan azonos.
    read: visibleMenusOrAdmin,
  },
  hooks: {
    beforeValidate: [validateMenu],
    afterChange: [revalidateMenusAfterChange],
    afterDelete: [revalidateMenusAfterDelete],
  },
  fields: [
    {
      name: 'label',
      type: 'text',
      required: true,
      label: 'Felirat',
      admin: {
        description: 'Ez a szöveg jelenik meg a menüben (pl. „Kurzusok").',
      },
    },
    {
      name: 'type',
      type: 'select',
      required: true,
      defaultValue: 'page',
      label: 'Hová mutat',
      options: [
        { label: 'Oldal', value: 'page' },
        { label: 'Bejegyzés', value: 'post' },
        { label: 'Külső link', value: 'url' },
        { label: 'Kurzus', value: 'product' },
      ],
      admin: {
        description: 'Válaszd ki, milyen tartalomra visz a menüpont; ettől függ a következő mező.',
      },
    },
    {
      name: 'ref',
      type: 'relationship',
      relationTo: ['pages', 'posts', 'products'],
      label: 'Cél',
      filterOptions: ({ relationTo, siblingData }) =>
        filterMenuRefOptions({ relationTo, siblingData }),
      admin: {
        allowCreate: false,
        condition: (_, siblingData) => siblingData?.type !== 'url',
        description: 'Csak a fent választott típus elemei: oldal, cikk vagy kurzus.',
      },
    },
    {
      name: 'url',
      type: 'text',
      label: 'Külső webcím',
      admin: {
        condition: (_, siblingData) => siblingData?.type === 'url',
        description: 'Teljes webcím más oldalra, https://-sel kezdve.',
      },
      /*
       * Szerver-oldali ellenőrzés MENTÉSKOR (src/lib/safe-url.ts).
       *
       * A `resolveMenuHref` (src/lib/menu-tree.ts) a tiltott alakú címet
       * csendben ejti — a menüpont egyszerűen kimarad a navigációból, és a
       * szerkesztő ebből semmit nem lát. Ez a validate a mező mellett, magyar
       * üzenettel szól.
       *
       * CSAK a „Külső link" típusnál fut: a mező az admin `condition`-je miatt
       * más típusnál nem is látszik, és a `resolveMenuHref` sem olvassa —
       * egy régi, típusváltás után benne ragadt érték ezért ne akadályozza meg
       * egy amúgy helyes menüpont mentését.
       *
       * A kötelezőséget NEM ez adja: „url" típusnál a `validateMenuTypeConsistency`
       * (src/lib/menu-validation.ts) követeli meg a kitöltést, a teljes menüpont
       * összefüggéseivel együtt.
       */
      validate: (value: string | null | undefined, { siblingData }: { siblingData?: unknown }) => {
        const type =
          typeof siblingData === 'object' && siblingData !== null
            ? (siblingData as Record<string, unknown>).type
            : undefined
        if (type !== 'url') {
          return true
        }
        return validateCmsUrl(value)
      },
    },
    {
      name: 'parent',
      type: 'relationship',
      relationTo: 'menus',
      label: 'Fölérendelt menüpont',
      filterOptions: rootMenuParentFilter,
      admin: {
        allowCreate: false,
        description:
          'Csak akkor töltsd ki, ha ez almenüpont. A listában csak főmenüpontok vannak: almenüpont alá már nem tehetsz továbbit.',
      },
    },
    {
      name: 'order',
      type: 'number',
      label: 'Sorrend',
      admin: {
        description: 'A menün belüli sorrend (kisebb szám = előrébb).',
      },
    },
    {
      name: 'visible',
      type: 'checkbox',
      defaultValue: true,
      label: 'Látható',
      admin: {
        description: 'Ha kiveszed a pipát, a menüpont eltűnik az oldalról, de nem vész el.',
      },
    },
    {
      name: 'openInNewTab',
      type: 'checkbox',
      defaultValue: false,
      label: 'Új lapon nyíljon',
      admin: {
        description: 'Külső linkeknél szokás bekapcsolni, hogy a látogató ne hagyja el az oldalt.',
      },
    },
  ],
}
