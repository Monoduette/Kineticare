import type { ArrayField, Block, Field, UIField } from 'payload'

import { about } from './about'
import { accordion } from './accordion'
import { appointment } from './appointment'
import { courseCards } from './course-cards'
import { credsStrip } from './creds-strip'
import { ctaBanner } from './cta-banner'
import { faq } from './faq'
import { filmHero } from './film-hero'
import { freeSos } from './free-sos'
import { howItWorks } from './how-it-works'
import { knowledge } from './knowledge'
import { pressLogos } from './press-logos'
import { richText } from './rich-text'
import { services } from './services'
import { states } from './states'
import { teamMembers } from './team-members'
import { testimonials } from './testimonials'
import { usps } from './usps'
import { welcome } from './welcome'

/** A szekció-tájékoztató UI-mezőjének neve (adatbázis-oszlopa nincs, `type: 'ui'`). */
export const SECTION_SOURCE_FIELD_NAME = 'szekcioForrasJelzes'

/**
 * Az „ugyanaz máshol” jelzés UI-mezőjének neve (adatbázis-oszlopa nincs,
 * `type: 'ui'`): hasonló szekció más oldalon, közös telefonszám, e-mail-cím
 * vagy kép (modul-térkép H10, H49; src/lib/admin/szekcio-masolatok.ts).
 */
export const SECTION_COPIES_FIELD_NAME = 'szekcioMasolatJelzes'

const SECTION_ROW_LABEL = '/components/admin/SectionRowLabel#SectionRowLabel'
const ARRAY_ROW_LABEL = '/components/admin/SectionRowLabel#ArrayRowLabel'
const SECTION_SOURCE_NOTICE = '/components/admin/SectionSourceNotice#SectionSourceNotice'
const SECTION_COPIES = '/components/admin/SectionCopies#SectionCopies'

/**
 * A tömbsor címének forrása: előbb ezek a nevek (ebben a sorrendben), utána a
 * sor többi text/textarea mezője. A `number` (sorszám) és az `url` (webcím)
 * nem cím: a „01” vagy a „/kurzusok” nem azonosítja a sort.
 */
const CIM_MEZO_SORREND = [
  'title',
  'cim',
  'question',
  'name',
  'nev',
  'heading',
  'label',
  'felirat',
  'text',
  'value',
]
const NEM_CIM_MEZOK = new Set(['url', 'number'])

/** Ahol egy mező önmagában nem mond eleget (a „10+” szám), ott a mezők összefűzve. */
const TOMB_CIM_OSSZEFUZES: Readonly<Record<string, { titleFields: string[]; separator: string }>> =
  {
    'about.stats': { titleFields: ['value', 'label'], separator: ' ' },
  }

/** A (statikus) felirat magyar szövege; függvény vagy hiány esetén a tartalék. */
function feliratSzovege(label: unknown, tartalek: string): string {
  if (typeof label === 'string' && label.trim().length > 0) {
    return label
  }
  if (typeof label === 'object' && label !== null) {
    const forditasok = label as Record<string, unknown>
    const hu = forditasok.hu ?? Object.values(forditasok)[0]
    if (typeof hu === 'string' && hu.trim().length > 0) {
      return hu
    }
  }
  return tartalek
}

/** Egy mezőlista közvetlen mezői: a név nélküli row/collapsible/tab kilapítva. */
function kozvetlenMezok(fields: readonly Field[]): Field[] {
  return fields.flatMap((field): Field[] => {
    if (field.type === 'row' || field.type === 'collapsible') {
      return kozvetlenMezok(field.fields)
    }
    if (field.type === 'tabs') {
      return field.tabs.flatMap((tab) =>
        'name' in tab && tab.name ? [] : kozvetlenMezok(tab.fields),
      )
    }
    return [field]
  })
}

/** A text/textarea mezők neve, a cím-sorrend szerint rendezve. */
function szovegMezok(fields: readonly Field[]): string[] {
  const nevek = kozvetlenMezok(fields)
    .filter((field) => field.type === 'text' || field.type === 'textarea')
    .map((field) => ('name' in field ? field.name : ''))
    .filter((name) => name.length > 0 && !NEM_CIM_MEZOK.has(name))
  const rang = (name: string): number => {
    const index = CIM_MEZO_SORREND.indexOf(name)
    return index === -1 ? CIM_MEZO_SORREND.length : index
  }
  return [...nevek].sort((a, b) => rang(a) - rang(b))
}

function elsoKepMezo(fields: readonly Field[]): string | undefined {
  const kep = kozvetlenMezok(fields).find((field) => field.type === 'upload')
  return kep && 'name' in kep ? kep.name : undefined
}

/** Tömbsor-címke minden olyan tömbre, amelynek még nincs saját RowLabel-je. */
function tombSorCimkekkel(fields: readonly Field[], blockSlug: string, prefix: string): Field[] {
  return fields.map((field): Field => {
    if (field.type === 'array') {
      return tombSorCimkevel(field, blockSlug, `${prefix}${field.name}`)
    }
    if (field.type === 'group') {
      const belso = 'name' in field && field.name ? `${prefix}${field.name}.` : prefix
      return { ...field, fields: tombSorCimkekkel(field.fields, blockSlug, belso) }
    }
    if (field.type === 'row' || field.type === 'collapsible') {
      return { ...field, fields: tombSorCimkekkel(field.fields, blockSlug, prefix) }
    }
    if (field.type === 'tabs') {
      return {
        ...field,
        tabs: field.tabs.map((tab) => ({
          ...tab,
          fields: tombSorCimkekkel(
            tab.fields,
            blockSlug,
            'name' in tab && tab.name ? `${prefix}${tab.name}.` : prefix,
          ),
        })),
      }
    }
    return field
  })
}

function tombSorCimkevel(field: ArrayField, blockSlug: string, utvonal: string): ArrayField {
  const fields = tombSorCimkekkel(field.fields, blockSlug, `${utvonal}.`)
  const components = field.admin?.components ?? {}
  if (components.RowLabel) {
    return { ...field, fields }
  }
  const osszefuzes = TOMB_CIM_OSSZEFUZES[`${blockSlug}.${utvonal}`]
  const kepMezo = elsoKepMezo(field.fields)
  return {
    ...field,
    fields,
    admin: {
      ...field.admin,
      components: {
        ...components,
        RowLabel: {
          path: ARRAY_ROW_LABEL,
          clientProps: {
            singular: feliratSzovege(field.labels?.singular, 'Sor'),
            titleFields: osszefuzes?.titleFields ?? szovegMezok(field.fields),
            ...(osszefuzes ? { separator: osszefuzes.separator } : {}),
            ...(kepMezo ? { imageField: kepMezo } : {}),
          },
        },
      },
    },
  }
}

/**
 * Az oldalblokk admin-megjelenése, SÉMA-SEMLEGESEN (mezőnév, típus, validáció
 * és access változatlan; a G2 őr, src/__tests__/schema-config-sync.test.ts
 * bizonyítja):
 *
 * - `admin.components.Label`: beszédes sorcímke („05 · Szolgáltatás-sorok: Így
 *   tudunk segíteni”, rejtett szekciónál „Rejtve” jellel). A Payload BlockRow a
 *   Label-lel a teljes alapcímkét cseréli (sorszám, típus-pill, „Névtelen”
 *   input), @payloadcms/ui/dist/fields/Blocks/BlockRow.js:139-158.
 * - `admin.disableBlockName: true`: eltűnik a címke nélküli „Névtelen” input
 *   (a blockName oszlop a payload baseBlockFields része, marad; a már megadott
 *   név a sorcímkében zárójelben látszik).
 * - minden saját RowLabel nélküli tömb „1. Rendelői kezelések” alakú sorcímkét
 *   kap (a sor text/textarea mezőiből, képes sornál a kép leírásából);
 * - az ELSŐ mező egy `type: 'ui'` tájékoztató: „Megnézem az oldalon”, forrás és
 *   „Ugrás oda, ahol szerkeszted” link, rejtett szekciónál magyarázat.
 *
 * A blokkfájl saját Label-jét vagy RowLabel-jét nem írja felül. A slug és a
 * blokkok sorrendje nem változik.
 */
export function withSectionAdmin(block: Block): Block {
  const components = block.admin?.components ?? {}
  const vanJelzes = block.fields.some(
    (field) => 'name' in field && field.name === SECTION_SOURCE_FIELD_NAME,
  )
  const jelzes: UIField = {
    name: SECTION_SOURCE_FIELD_NAME,
    type: 'ui',
    admin: { components: { Field: SECTION_SOURCE_NOTICE } },
  }
  return {
    ...block,
    admin: {
      ...block.admin,
      disableBlockName: true,
      components: {
        ...components,
        Label: components.Label ?? {
          path: SECTION_ROW_LABEL,
          clientProps: {
            blockLabel: feliratSzovege(block.labels?.singular, block.slug),
            textFields: szovegMezok(block.fields),
          },
        },
      },
    },
    fields: [...(vanJelzes ? [] : [jelzes]), ...tombSorCimkekkel(block.fields, block.slug, '')],
  }
}

/**
 * A szekció-rendszer blokk-katalógusa (docs/szekcio-rendszer-terv.md 2. pont).
 * A tömb SORRENDJE az admin „+ Blokk" választólistájának sorrendje. Szándékosan
 * a terv 4. pontja szerinti AJÁNLOTT kezdőlap-sorrendet követi (M1–M8 +
 * kinézet-blokkok), hogy a laikus szerkesztő fentről lefelé haladva építhessen
 * kezdőlapot. Az utolsó öt blokk (szakértő-kártyák, nyitható szekció,
 * időpontkérő, szabad szöveg, gombos sáv) nem kötődik kezdőlapi pozícióhoz,
 * ezért a „Bárhol használható” admin-csoportban áll.
 *
 * Minden elem a `withSectionAdmin` burkolón megy át (sorcímke, tömbsor-címkék,
 * tájékoztató). A nevesített exportok (lent) a nyers blokkok maradnak.
 */
export const pageBlocks: Block[] = [
  filmHero,
  credsStrip,
  courseCards,
  freeSos,
  pressLogos,
  welcome,
  usps,
  states,
  services,
  about,
  howItWorks,
  testimonials,
  knowledge,
  faq,
  teamMembers,
  accordion,
  appointment,
  richText,
  ctaBanner,
].map(withSectionAdmin)

/** A katalógus blokk-azonosítói (renderelő és tesztek számára). */
export const pageBlockSlugs: string[] = pageBlocks.map((block) => block.slug)

export {
  about,
  accordion,
  appointment,
  courseCards,
  credsStrip,
  ctaBanner,
  faq,
  filmHero,
  freeSos,
  howItWorks,
  knowledge,
  pressLogos,
  richText,
  services,
  states,
  teamMembers,
  testimonials,
  usps,
  welcome,
}
export { linkFields, linkGroup, LINK_URL_DESCRIPTION } from './link-fields'
export type { LinkFieldsOptions, LinkGroupOptions } from './link-fields'
export { sectionSettings, validateAnchorId } from './section-settings'
export type { SectionBackground, SectionSettingsOptions } from './section-settings'
