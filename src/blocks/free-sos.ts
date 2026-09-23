import type { Block, Field } from 'payload'

import { ctaLabel } from '../lib/cta-vocabulary'
import { linkGroup } from './link-fields'
import { sectionSettings } from './section-settings'

/**
 * Ingyenes villámkurzus sáv: az ingyenes SOS-kurzus ajánlása (terv 2.
 * blokk-katalógus, M4).
 *
 * Az értékesítési audit szerint az ingyenes anyag a tölcsér TETEJE, nem a
 * csúcsa: a fizetős kurzusok UTÁN, visszafogottabb súllyal jelenik meg, hogy ne
 * vigye el a figyelmet a vásárlástól.
 *
 * ŐSZINTE ADMIN-SZÖVEGEK (admin-audit K18, modul-térkép H07 és H23): minden
 * mező leírása azt mondja, amit a lap valóban csinál
 * (src/components/content/home/FreeSos.tsx). A cím a szerkesztőé, a felvezető
 * sor a kurzus nevéből jön, a gomb felirata és célja számított, a sáv kép
 * nélküli (WP26). Források (megnyitva, 2026-09-22):
 * - NN/g, 10 Usability Heuristics, #2: „The design should speak the users'
 *   language. Use words, phrases, and concepts familiar to the user, rather
 *   than internal jargon.” https://www.nngroup.com/articles/ten-usability-heuristics/
 *   és https://www.nngroup.com/articles/match-system-real-world/
 * - NN/g, Memory Recognition and Recall: „By making information and interface
 *   functions visible and easily accessible.”
 *   https://www.nngroup.com/articles/recognition-and-recall/
 * - GOV.UK Design System, Text input, hint text: „Use hint text for help
 *   that's relevant to the majority of users, like how their information will
 *   be used, or where to find it.” A leírás ezért azt mondja meg, hol látszik a
 *   szöveg és honnan jön, nem többet.
 *   https://design-system.service.gov.uk/components/text-input/
 * - WCAG 2.2 SC 3.3.2 Labels or Instructions.
 *   https://www.w3.org/WAI/WCAG22/Understanding/labels-or-instructions.html
 *
 * A BLOKK NEVE (R1 5. vezetői döntés, a slug változatlan): „Ingyenes
 * villámkurzus sáv”. A lapon a sáv legnagyobb szövege „Ingyenes villámkurzus”,
 * és a tulajdonos is így nevezte (2026-09-07: „‚Ingyenes villámkurzus’ nagyon
 * rövid leírással”, „full width kék sáv”). A név így a szerkesztő saját szava
 * (NN/g #2), és az adminban ugyanazt a szót ismeri fel, amit a lapon lát
 * (felismerés, nem felidézés). A korábbi „Ingyenes SOS-sáv” az „SOS” szót a
 * lapnak csak a kis felvezető sorában találta meg. A „… sáv” alak a többi
 * egyszerűsített blokknévhez igazodik (R1: „Gombos kiemelő sáv”, „Szakmai
 * háttér sáv”; NN/g #4, Consistency and standards).
 *
 * SÉMA-SEMLEGES: csak felirat, leírás, `admin.hidden` és a gomb feliratmezőjének
 * `admin.readOnly`-ja változik, oszlop nem
 * (a drizzle-séma az `admin` kulcsot nem olvassa; G1/G2 őr:
 * src/__tests__/schema-config-sync.test.ts). A kötelező `title` látható marad,
 * readOnly és defaultValue nincs (backlog K18: a readOnly kötelező mezőn új
 * blokknál mentést akadályozna, a defaultValue DB-alapértéket generálna).
 */

/** A gomb szótári feliratai (§3.2 #4 és #10), a FreeSos.tsx-szel azonos forrásból. */
const GOMB_FELIRAT_INGYENES = ctaLabel('free-course-claim')
const GOMB_FELIRAT_LISTA = ctaLabel('course-list-open')

/**
 * A „Gomb” csoport és három mezőjének igaz leírása.
 *
 * A `resolveFreeSosCta` (FreeSos.tsx) a feliratot SOSEM veszi át a CMS-ből, a
 * célt pedig csak akkor, ha az UGYANENNEK a kurzusnak az oldala (akár
 * paraméterrel vagy horgonnyal); másik kurzusra vagy oldalra a sáv nem vihet
 * (P03: az ingyenes ajánlat bizalmi határ). Az új lap kapcsoló csak ilyen
 * elfogadott címnél hat. A korábbi leírás „MÁSIK kurzus oldalára” vivő címet
 * ígért, amit a kód eldob (modul-térkép H23).
 */
export const FREE_SOS_CTA_DESCRIPTIONS = {
  group: `A gomb felirata és célja automatikus: az ingyenes kurzus oldalára visz, és ha éppen nincs ingyenes kurzus, a kurzuslistára. Az itteni mezőket nem kell kitöltened.`,
  felirat: `Ez a mező a weboldalon nem jelenik meg. A gomb feliratát a rendszer adja egységesen: „${GOMB_FELIRAT_INGYENES}”, ingyenes kurzus nélkül „${GOMB_FELIRAT_LISTA}”.`,
  url: 'Hagyd üresen: a gomb magától az ingyenes kurzus oldalára visz. Más kurzus vagy oldal címét a rendszer nem veszi figyelembe.',
  ujAblakban:
    'Ennél a gombnál nincs rá szükség, mert a gomb a saját kurzusoldalunkra visz. Csak akkor hat, ha fent az ingyenes kurzus címét adtad meg.',
} as const

/**
 * A közös `linkGroup` (link-fields.ts) csoportja, a SOS-sávhoz igazított
 * leírásokkal. A `felirat` és az `url` leírása a linkGroup saját opciója; az
 * `ujAblakban` leírására nincs opció, ezért azt a visszaadott mezőn cseréljük.
 * A mezők neve, típusa és sorrendje változatlan (séma-semleges).
 *
 * A `felirat` CSAK OLVASHATÓ (modul-térkép H07): a lapon nem jelenik meg, mert
 * a gomb feliratát a §3.2 szótára adja (`resolveFreeSosCta`). Szerkeszthetően
 * hamis sikert jelzett volna: a szerkesztő átírja, ment, és a lapon semmi nem
 * változik. A mező nem kötelező (a linkGroup `labelRequired` alapértéke
 * false), ezért a readOnly a mentést nem akadályozza, a meglévő érték pedig
 * megmarad. Payload, Fields overview, Admin Options: „Setting a field to
 * readOnly has no effect on the API whatsoever but disables the admin
 * component's editability to prevent editors from modifying the field's
 * value.” https://payloadcms.com/docs/fields/overview
 * A leírás mondja ki, miért nem írható (WCAG 2.2 SC 3.3.2).
 */
function freeSosCtaGroup(): Field {
  const group = linkGroup({
    name: 'cta',
    label: 'Gomb',
    description: FREE_SOS_CTA_DESCRIPTIONS.group,
    labelDescription: FREE_SOS_CTA_DESCRIPTIONS.felirat,
    urlDescription: FREE_SOS_CTA_DESCRIPTIONS.url,
  })
  if (group.type !== 'group') {
    return group
  }
  return {
    ...group,
    fields: group.fields.map((field) => {
      if (field.type === 'checkbox' && field.name === 'ujAblakban') {
        return {
          ...field,
          admin: { ...field.admin, description: FREE_SOS_CTA_DESCRIPTIONS.ujAblakban },
        }
      }
      if (field.type === 'text' && field.name === 'felirat') {
        return { ...field, admin: { ...field.admin, readOnly: true } }
      }
      return field
    }),
  }
}

export const freeSos: Block = {
  slug: 'freeSos',
  interfaceName: 'BlockFreeSos',
  labels: {
    singular: 'Ingyenes villámkurzus sáv',
    plural: 'Ingyenes villámkurzus sávok',
  },
  admin: {
    group: 'Kezdőlap (ajánlott sorrendben)',
  },
  fields: [
    {
      name: 'title',
      type: 'text',
      required: true,
      label: 'A sáv nagy címe',
      admin: {
        description:
          'A sáv legnagyobb szövege, pl. „Ingyenes villámkurzus”. A fölötte álló kis sor a kurzus neve: azt a Webshop\u00a0→ Kurzusok\u00a0→ SOS Kézrelax villámkurzus\u00a0→ Alapadatok fülön, a „Kurzus címe” mezőben írod át. Ha éppen nincs elérhető ingyenes kurzus, a sáv ehelyett a „Kurzusaink” címet mutatja.',
      },
    },
    {
      name: 'body',
      type: 'textarea',
      label: 'Szöveg',
      admin: {
        description:
          'Pár mondat arról, mit kap a látogató az ingyenes anyagban. Ha üresen hagyod, itt a kurzus „Rövid leírás” mezője látszik.',
      },
    },
    freeSosCtaGroup(),
    {
      name: 'backgroundImage',
      type: 'upload',
      relationTo: 'media',
      label: 'Háttérkép',
      admin: {
        // A sáv a tulajdonos döntésére kép nélküli (WP26, 2026-09-07), a mező
        // hatástalan volt, mégis kitölthetőnek látszott (K18). Az admin.hidden
        // a mezőt rejtett inputtá teszi, az értéke mentéskor tovább megy, így a
        // feltöltött kép hivatkozása megmarad (Payload, Fields overview, Admin
        // Options: „Its value will still submit with requests in the Admin
        // Panel, but the field itself will not be visible to editors.”
        // https://payloadcms.com/docs/fields/overview).
        hidden: true,
        description: 'A sáv kép nélküli, ez a mező a weboldalon nem jelenik meg.',
      },
    },
    sectionSettings({ defaultBackground: 'tint' }),
  ],
}
