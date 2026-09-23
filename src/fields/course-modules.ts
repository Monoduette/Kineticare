import type { ArrayField, Field } from 'payload'

import { courseContentReadAccess } from '../access/courseContentRead'
import { streamAssetReadAccess } from '../access/streamAssetRead'
import { hideLegacyAttachmentFallback, validateCourseAttachments } from './course-attachments'

/**
 * products.modules: fejezetek → leckék; a régi videos tömb érintetlen (nem destruktív migráció).
 * Lecke ref = globális BSON id; streamAssetId ugyanazt a streamAssetReadAccess-t kapja.
 */

/** A lecke típusai — a felület ez alapján dönti el, mit és hogyan jelenít meg. */
export const LESSON_KIND_VIDEO = 'video'
export const LESSON_KIND_TEXT = 'szoveg'
export const LESSON_KIND_LINK = 'link'

/**
 * A Hossz mező admin-leírása. A jegykiadás hiányzó hossznál 24 órás TTL-lel
 * megy (nem 503): a szerkesztőnek ez a mondat mondja el, ne a régi „KÖTELEZŐ,
 * nélküle nem indul" szöveg. Forrás: docs/szerkesztoi-utmutato.md 12. pont.
 */
export const LESSON_DURATION_ADMIN_DESCRIPTION =
  'A videó kiválasztásakor átvett hossz másodpercben. Ajánlott ellenőrizni: ebből számoljuk a hátralévő időt. Ha nem ismert, a lejátszás ettől még elindul (a jegy 24 órás). A lejátszáshoz kiválasztott videó és Kész állapot szükséges.'

/**
 * A Tananyag (modulok) mező admin-leírása. A második mondat a néma elnyelést
 * nevezi meg: egyetlen új lecke (GUID nélkül is) elrejti a régi Videók listát.
 */
export const COURSE_MODULES_ADMIN_DESCRIPTION =
  'A kurzus tananyaga modulokra bontva. A vásárló ebben a sorrendben látja a leckéket. Ha üresen hagyod, a lenti „Videók” lista jelenik meg egyetlen modulként. Ha egy új modulba legalább egy leckét felveszel, a régi lista elrejtődik. A régi videókat ne másold át kézzel, mert a vásárlók haladása elveszne: az átemelést a kurzus:videok-modulba parancs végzi.'

/**
 * A videó-állapot opciói — SZÓ SZERINT a `products.videos.status` mezőé
 * (src/plugins/ecommerce.ts), hogy a szerkesztő ugyanazt a három állapotot
 * lássa mindkét helyen, és a lejátszhatóság szabálya se térhessen el.
 */
const lessonStatusOptions = [
  { label: 'Feldolgozás alatt', value: 'processing' },
  { label: 'Kész', value: 'ready' },
  { label: 'Hiba', value: 'error' },
]

/** `siblingData.kind` kiolvasása típusszűkítéssel (`any` tilos). */
function lessonKindOf(siblingData: unknown): string | null {
  if (typeof siblingData !== 'object' || siblingData === null) {
    return null
  }
  const value = (siblingData as { kind?: unknown }).kind
  return typeof value === 'string' ? value : null
}

/**
 * A videó-almezők csak videó-leckén látszanak. A `condition` KIZÁRÓLAG
 * admin-megjelenítés (nincs séma- vagy adathatása), a szerver-oldali
 * lejátszhatóság-szabály ettől függetlenül a `kind`-ot is nézi
 * (src/lib/curriculum/curriculum.ts).
 *
 * A `kind` a mező bevezetése előtti (nem létező) soroknál üres lehet — az üres
 * érték a videó-ágba sorolódik, egyezően a modell `normalizeLessonKind`-jével.
 */
const showForVideo = (_data: unknown, siblingData: unknown): boolean => {
  const kind = lessonKindOf(siblingData)
  return kind === null || kind === LESSON_KIND_VIDEO
}

const showForLink = (_data: unknown, siblingData: unknown): boolean =>
  lessonKindOf(siblingData) === LESSON_KIND_LINK

/**
 * K46: a „Korábbi nyilvános fájl” csak azon a mellékletsoron látszik, amelyhez
 * már tartozik ilyen fájl. Új sorban így nem kínál fel egy kivezetett
 * lehetőséget (a videók mezőjének mintája, src/plugins/ecommerce.ts). A mező
 * NEM kötelező, ezért a feltétel séma-semleges (a drizzle csak kötelező
 * mezőnél veszi le a NOT NULL-t, és ez az oszlop amúgy is NULL-ozható); a
 * G2 őr (schema-config-sync.test.ts) igazolja. Az üres mező értéke a
 * form-állapotban megmarad, tehát a régi sorok adata sem vész el.
 */
export const hasLegacyAttachmentFile = (_data: unknown, siblingData: unknown): boolean => {
  if (typeof siblingData !== 'object' || siblingData === null) return false
  const file = (siblingData as { file?: unknown }).file
  return file !== null && file !== undefined && file !== ''
}

/** Egy lecke mezői. */
const lessonFields: Field[] = [
  {
    name: 'title',
    type: 'text',
    required: true,
    label: 'Lecke címe',
    admin: {
      description: 'Ez jelenik meg a tananyag-listában, pl. „Ismerd meg a kezed”.',
    },
  },
  {
    name: 'kind',
    type: 'select',
    required: true,
    defaultValue: LESSON_KIND_VIDEO,
    label: 'Lecke típusa',
    options: [
      { label: 'Videó', value: LESSON_KIND_VIDEO },
      { label: 'Szöveges lecke', value: LESSON_KIND_TEXT },
      { label: 'Külső link', value: LESSON_KIND_LINK },
    ],
    admin: {
      description:
        'Videós leckénél a védett videótárból választasz felvételt. A szöveges lecke írott anyagot vagy letölthető fájlt tartalmaz. A külső link máshová visz, például egy Facebook-csoportba.',
    },
  },
  {
    name: 'summary',
    type: 'textarea',
    label: 'Rövid összefoglaló',
    admin: {
      description: 'Egy-két mondat a lecke címe alatt. Nem kötelező.',
    },
  },
  {
    name: 'streamAssetId',
    type: 'text',
    label: 'Lecke videója',
    // Ugyanaz a mezőszintű védelem, mint a régi videó-soron (S2/b).
    access: {
      read: streamAssetReadAccess,
    },
    admin: {
      condition: showForVideo,
      components: {
        Field: '/components/admin/BunnyVideoField#ProtectedBunnyVideoField',
      },
      // A zsargon („GUID", „library") az admin UX-audit szerint a kurzusfeltöltés
      // leggyakoribb elakadási pontja volt: a szerkesztő nem tudta, MELYIK
      // értéket kell a Bunny felületéről kimásolni — és rossz érték mellett a
      // videó némán nem indul el.
      description:
        'A lecke felvétele a védett videótárból. A nyilvános előzetes videót külön, a Kurzusoldal fülön választod ki.',
    },
  },
  {
    name: 'durationSec',
    type: 'number',
    label: 'Hossz (másodperc)',
    admin: {
      condition: showForVideo,
      readOnly: true,
      description: LESSON_DURATION_ADMIN_DESCRIPTION,
    },
  },
  {
    name: 'status',
    type: 'select',
    defaultValue: 'processing',
    label: 'Videó állapota',
    options: lessonStatusOptions,
    admin: {
      condition: showForVideo,
      readOnly: true,
      description:
        'A videó kiválasztásakor átvett feldolgozási állapot. Csak a Kész állapotú videó játszható le és számít bele a haladásba.',
    },
  },
  {
    name: 'url',
    type: 'text',
    label: 'Külső webcím',
    // A link maga a tananyag: a GUID-dal ellentétben nincs mögötte egy újabb
    // token-végpont. Ezért már az olvasás a teljes, lejáratkövető kapun megy át.
    access: {
      read: courseContentReadAccess,
    },
    admin: {
      condition: showForLink,
      description: 'Teljes webcím (https://…), ahová a lecke gombja visz.',
    },
  },
  {
    name: 'content',
    type: 'richText',
    label: 'Lecke szövege',
    access: {
      read: courseContentReadAccess,
    },
    admin: {
      description:
        'A lecke alatt megjelenő írott anyag. Videós leckénél jegyzet vagy a gyakorlat leírása is lehet. Nem kötelező.',
    },
  },
  {
    name: 'attachments',
    type: 'array',
    validate: validateCourseAttachments,
    hooks: { afterRead: [hideLegacyAttachmentFallback] },
    label: 'Letölthető anyagok',
    labels: {
      singular: 'Melléklet',
      plural: 'Mellékletek',
    },
    access: {
      read: courseContentReadAccess,
    },
    admin: {
      description:
        'Új segédlethez védett kurzusfájlt válassz. A korábbi nyilvános fájlok továbbra is elérhetők a saját webcímükön.',
    },
    fields: [
      {
        name: 'label',
        type: 'text',
        label: 'Megnevezés',
        admin: {
          description: 'Ha üresen hagyod, a fájl neve jelenik meg.',
        },
      },
      {
        name: 'file',
        type: 'upload',
        relationTo: 'media',
        required: false,
        label: 'Korábbi nyilvános fájl',
        admin: {
          condition: hasLegacyAttachmentFile,
          description:
            'Régi melléklet, amely nyilvános webcímen is elérhető. Csak akkor látszik, ha a sorhoz már tartozik ilyen fájl. Új anyaghoz a védett kurzusfájlt használd.',
        },
      },
      {
        name: 'protectedFile',
        type: 'upload',
        relationTo: 'course-files',
        label: 'Védett kurzusfájl',
        filterOptions: ({ id }) => (typeof id === 'number' ? { course: { equals: id } } : false),
        admin: {
          description:
            'Előbb mentsd el a kurzust, majd tölts fel hozzá fájlt. A vásárló a kurzus közzététele után töltheti le.',
        },
      },
    ],
  },
]

/**
 * A `products.modules` mező.
 *
 * Az `initCollapsed` szándékos: egy 27 leckés kurzusnál a nyitott állapot
 * kezelhetetlen szerkesztői felületet adna. Az összecsukás viszont CSAK
 * beszédes sorfelirattal működik — enélkül (az admin UX-audit mérése szerint) a
 * hét modul nyolc teljesen egyforma, „Modul 01…08" feliratú szürke csík volt, és
 * a szerkesztő egyesével nyitogatta ki őket, hogy megtalálja a keresettet.
 * Ezért kap a modul- és a lecke-sor is `RowLabel`-t: a felirat a CÍM (a leckék
 * számával, illetve a lecke típusával és lejátszhatóságával).
 * A feliratképzés tiszta logikája: src/components/admin/curriculum-row-label.ts.
 */
export const courseModulesField: ArrayField = {
  name: 'modules',
  type: 'array',
  label: 'Tananyag (modulok)',
  labels: {
    singular: 'Modul',
    plural: 'Modulok',
  },
  admin: {
    initCollapsed: true,
    components: {
      RowLabel: '/components/admin/CurriculumRowLabels#ModuleRowLabel',
    },
    description: COURSE_MODULES_ADMIN_DESCRIPTION,
  },
  fields: [
    {
      name: 'title',
      type: 'text',
      required: true,
      label: 'Modul címe',
      admin: {
        description: 'Például: „Alapok: így kezdj neki”.',
      },
    },
    {
      name: 'summary',
      type: 'textarea',
      label: 'Modul rövid leírása',
      admin: {
        description: 'Egy mondat a fejezetről a tananyag-listában. Nem kötelező.',
      },
    },
    {
      name: 'lessons',
      type: 'array',
      label: 'Leckék',
      labels: {
        singular: 'Lecke',
        plural: 'Leckék',
      },
      admin: {
        initCollapsed: true,
        components: {
          RowLabel: '/components/admin/CurriculumRowLabels#LessonRowLabel',
        },
      },
      fields: lessonFields,
    },
  ],
}
