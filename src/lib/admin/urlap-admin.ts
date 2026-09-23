import type {
  Field,
  FieldHook,
  PayloadRequest,
  TextFieldSingleValidation,
  UIField,
  Where,
} from 'payload'
import { text as alapSzovegValidalas } from 'payload/shared'

import { appointment } from '../../blocks/appointment'
import type { Form } from '../../payload-types'
import { APPOINTMENT_FORM_TITLE } from '../appointment/form'
import { logger } from '../logger'
import { NEWSLETTER_FORM_TITLE } from '../newsletter/form'

/**
 * Az Űrlapok gyűjtemény (form-builder plugin) admin-igazsága, modul-térkép
 * H17 és H45.
 *
 * A KIINDULÓ HELYZET (mérve 2026-09-23, élő /api/forms és a kód):
 *  - A weboldal a két használt űrlapot a PONTOS címéből keresi
 *    (src/lib/appointment/form.ts `findAppointmentFormId`,
 *    src/lib/newsletter/form.ts `findNewsletterFormId`), a „Kapcsolat”
 *    űrlapot pedig csak az induláskori `ensureContactForm` hozza létre, a
 *    weboldalon semmi nem keresi. Átnevezés után a Hírlevél eltűnik a
 *    láblécből, az időpontkérő szekció űrlapja letiltva jelenik meg, a
 *    következő induláskor pedig mindhárom név alatt új űrlap jön létre, így a
 *    beküldések kettéválnak.
 *  - Egy MÁSODIK azonos nevű űrlap ugyanígy elviszi a kötést, csak csendben.
 *    A két kereső `limit: 1`-gyel, rendezés nélkül olvas, a Postgres-adapter
 *    alaprendezése pedig '-createdAt' (@payloadcms/drizzle/dist/queries/
 *    buildOrderBy.js), vagyis a LEGÚJABB azonos nevű űrlap nyer. Második
 *    példány háromféleképpen keletkezhet: a „Duplikálás” gombbal (a Payload
 *    duplikálása egy create, amelynek originalDoc-ja a forrás, így a
 *    validátor `previousValue`-ja a forrás címe: payload/dist/collections/
 *    operations/duplicate.js, create.js), új űrlap létrehozásával és egy
 *    másik űrlap átnevezésével a kötött névre.
 *  - A plugin megjelenítési mezőit (gomb felirata, megerősítés típusa,
 *    megerősítő üzenet, átirányítás, mezőlista) a weboldal nem olvassa: a
 *    React-űrlapok a feliratot, a kérdéseket és a köszönő szöveget a kódból
 *    vagy az Időpontkérés szekcióból veszik. A plugin dokumentációja is ezt
 *    mondja: „Render forms on your front-end using your own UI components”
 *    (https://payloadcms.com/docs/plugins/form-builder).
 *  - Az E-mailek lista minden sora minden beküldésnél levelet küld (a plugin
 *    afterChange hookja, @payloadcms/plugin-form-builder/dist/collections/
 *    FormSubmissions/hooks/sendEmail.js), a kódbeli stáb-értesítő mellé. Az
 *    időpontkérés egészségügyi adatot hordoz, amelynek kezelése a GDPR 9.
 *    cikk (1) bekezdése szerint alapból tilos („data concerning health …
 *    shall be prohibited”, https://gdpr-info.eu/art-9-gdpr/), tehát egy
 *    véletlenül felvett címzett különleges adatot kapna. Élőben mindhárom
 *    űrlapon 0 sor van.
 *
 * A MEGOLDÁS ADMIN-KULCS, VALIDÁTOR ÉS EGY MEZŐHOOK. A mezők neve, típusa,
 * kötelezősége és a fa szerkezete változatlan (séma-semleges, a G2 és a
 * src/__tests__/urlap-admin-mezok.test.ts őrzi). Access-t és auth-hookot nem
 * érint (az `emails` mező plugin-szintű `access.read`-je is megmarad).
 *  - A cím mező `validate`-je a kötött nevek átnevezését magyar üzenettel
 *    utasítja el, és egy kötött nevet csak egy űrlap viselhet. NN/g,
 *    Preventing User Errors: Avoiding Unconscious Slips: „in cases where there
 *    are clear rules that define acceptable options, it can be a good strategy
 *    to constrain the types of input users can make”
 *    (https://www.nngroup.com/articles/slips/). A statikus `admin.readOnly`
 *    erre nem jó, mert új űrlapnál is zárná a mezőt. Az üzenet rövid (mi
 *    találja meg az űrlapot a nevéről, és a teendő), mert a Payload mezőhibája
 *    egysoros, levágott tooltip (lásd `kotottCimHiba`); a szabály indoka a cím
 *    súgójában (`CIM_SUGO`) áll.
 *  - A cím mező `hooks.beforeDuplicate`-je a kötött nevű űrlap másolatának
 *    „ (másolat)” utótagot ad, így a „Duplikálás” sikerül, és a másolat nem
 *    veszi át a kötést.
 *  - Az `emails` mező `admin.hidden`. A Payload szerint „Its value will still
 *    submit with requests in the Admin Panel, but the field itself will not be
 *    visible to editors” (https://payloadcms.com/docs/fields/overview); az
 *    adat mentés utáni megmaradását a helyi szerveren mértük (A2-2-4 jelentés).
 *  - `admin.readOnly` CSAK nem kötelező mezőn: a readOnly kötelező mezőn új
 *    űrlapnál a mentést akadályozná, mert a szerkesztő nem tudná kitölteni. A
 *    `confirmationMessage` (feltételesen kötelező) és a `redirect` (kötelező
 *    `url` gyermekkel) ezért csak igaz súgót kap.
 */

/**
 * A „Kapcsolat” űrlap címe. Itt él, hogy a kötött nevek egy helyen legyenek;
 * a src/payload.config.ts `ensureContactForm`-ja innen importálja.
 */
export const CONTACT_FORM_TITLE = 'Kapcsolat'

/** A weboldal által a nevükről keresett (vagy induláskor létrehozott) űrlapok. */
export const KOTOTT_URLAP_CIMEK = [
  APPOINTMENT_FORM_TITLE,
  NEWSLETTER_FORM_TITLE,
  CONTACT_FORM_TITLE,
] as const

export type KotottUrlapCim = (typeof KOTOTT_URLAP_CIMEK)[number]

/** Kötött űrlapcím-e az érték (pontos egyezés: a kód is `equals`-szal keres). */
export function isKotottUrlapCim(value: unknown): value is KotottUrlapCim {
  return typeof value === 'string' && (KOTOTT_URLAP_CIMEK as readonly string[]).includes(value)
}

type Rekord = Readonly<Record<string, unknown>>

function isRekord(value: unknown): value is Rekord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Egy blokkmező szöveges címkéje a blokk configjából (a súgó így betűre egyezik az adminnal). */
function blokkMezoCimke(mezok: readonly unknown[], nev: string, tartalek: string): string {
  const mezo = mezok.find((elem) => isRekord(elem) && elem.name === nev)
  return isRekord(mezo) && typeof mezo.label === 'string' ? mezo.label : tartalek
}

/** Az Időpontkérés szekció neve, ahogy a szekció-választó és a sorcímke mutatja. */
export const IDOPONT_SZEKCIO_NEV =
  typeof appointment.labels?.singular === 'string' ? appointment.labels.singular : 'Időpontkérés'

/** A határozott névelő a szó első betűje szerint (magánhangzó előtt „az”). */
export function nevelo(szo: string): 'a' | 'az' {
  return /^[aáeéiíoóöőuúüű]/i.test(szo.trim()) ? 'az' : 'a'
}

/** Az Időpontkérés szekció beküldés utáni címének mezőfelirata (src/blocks/appointment.ts). */
export const IDOPONT_KOSZONO_CIM_MEZO = blokkMezoCimke(
  appointment.fields,
  'sikerCim',
  'A sikeres beküldés címe',
)

/** Az Időpontkérés szekció köszönő szövegének mezőfelirata (src/blocks/appointment.ts). */
export const IDOPONT_KOSZONO_MEZO = blokkMezoCimke(
  appointment.fields,
  'sikerSzoveg',
  'A sikeres beküldés szövege',
)

/** Az Időpontkérés szekció űrlap-kapcsolójának felirata (src/blocks/appointment.ts). */
export const IDOPONT_URLAP_KAPCSOLO = blokkMezoCimke(
  appointment.fields,
  'urlapMutatasa',
  'Legyen űrlap a szekcióban',
)

/** Mondat eleji alak: az első betű nagy (pl. a névelő „az” → „Az”). */
function nagyKezdobetuvel(szo: string): string {
  return szo.charAt(0).toLocaleUpperCase('hu') + szo.slice(1)
}

/**
 * Mi találja meg a kötött űrlapot a weboldalon a nevéről (mérve a kódban):
 * a Hírlevelet a lábléc feliratkozó sora (src/components/layout/
 * NewsletterSignup.tsx → `findNewsletterFormId`), az Időpontkérést az
 * Időpontkérés szekció (src/lib/appointment/section.ts →
 * `findAppointmentFormId`). A „Kapcsolat” nevű űrlapot a weboldal nem keresi
 * (null), csak az induláskori `ensureContactForm` ellenőrzi. Mondat eleji
 * alakban áll, mert a hibaüzenet ezzel kezdődik.
 */
const MI_TALALJA_MEG: Readonly<Record<KotottUrlapCim, string | null>> = {
  [APPOINTMENT_FORM_TITLE]: `${nagyKezdobetuvel(nevelo(IDOPONT_SZEKCIO_NEV))} ${IDOPONT_SZEKCIO_NEV} szekció`,
  [NEWSLETTER_FORM_TITLE]: 'A lábléc feliratkozó sora',
  [CONTACT_FORM_TITLE]: null,
}

/** Használja-e a weboldal a kötött űrlapot (a „Kapcsolat”-ot most nem). */
function weboldalHasznalja(cim: KotottUrlapCim): boolean {
  return MI_TALALJA_MEG[cim] !== null
}

/**
 * Az átnevezés hibaüzenete: mi találja meg az űrlapot a nevéről, és a teendő
 * (a név betűre). WCAG 2.2 SC 3.3.1 (a hiba szövegben leírva) és SC 3.3.3 (a
 * javítás módja). A GOV.UK Design System szerint: „Describe what has happened
 * and tell them how to fix it.” és „The message must be in plain English, use
 * positive language and get to the point.”
 * (https://design-system.service.gov.uk/components/error-message/). Az
 * átnevezés következménye kimarad, mert a validátor úgyis megakadályozza; a
 * szabály indoka a cím súgójában (`CIM_SUGO`) áll.
 *
 * MIÉRT RÖVID: a Payload mezőhibája egysoros tooltip. A
 * @payloadcms/ui/dist/elements/Tooltip/index.scss szerint `white-space:
 * nowrap`, a `.tooltip-content` `text-overflow: ellipsis`, és legfeljebb
 * 1024 px széles ablakon (`@include mid-break`) `display: none`; a
 * fields/FieldError/index.scss a hibát `max-width: 75%`-ra szűkíti. A mért keret (scratchpad
 * leadA/A2-2-4-atvetel2/hossz-meres.json, 13 px-es betű) 1025 px-es ablakon
 * 663 px szövegszélesség, ez kb. 110 karakter; a hosszabb üzenet vége, épp a
 * teendő, levágva maradna el. Mindhárom üzenet 110 karakteren belül van, és
 * a teendővel zárul (src/__tests__/urlap-cim-validate.test.ts).
 */
export function kotottCimHiba(cim: KotottUrlapCim): string {
  const visszairas = `Írd vissza a nevét: „${cim}”.`
  const kereso = MI_TALALJA_MEG[cim]
  if (kereso === null) {
    return `A rendszer induláskor erről a névről ellenőrzi, hogy ez az űrlap megvan-e. ${visszairas}`
  }
  return `${kereso} erről a névről találja meg ezt az űrlapot. ${visszairas}`
}

/**
 * A foglalt kötött név hibaüzenete (új űrlap, duplikálás, vagy egy másik
 * űrlap átnevezése a kötött névre). Ugyanaz a GOV.UK-minta: mi a baj, és mit
 * tegyél.
 */
export function kotottCimFoglaltHiba(cim: KotottUrlapCim): string {
  const hasznalat = weboldalHasznalja(cim) ? ', a weboldal azt használja' : ''
  return `Már van „${cim}” nevű űrlap${hasznalat}. Ennek az űrlapnak adj más nevet.`
}

/**
 * Van-e MÁS űrlap ezzel a kötött névvel. A saját azonosító kizárása
 * védőkorlát: egy meglévő űrlap a saját nevével soha ne ütközzön.
 *
 * Hibánál nem dob, hanem naplóz, és „nincs”-et ad (a validátor így átenged).
 * A dobott hiba a form-state-ben angol, általános „Error validating field at
 * path” üzenetté válna (@payloadcms/ui/dist/forms/fieldSchemasToFormState/
 * addFieldStatePromise.js), a szerveren pedig az egész mentést hibaként
 * zárná; ha az adatbázis nem válaszol, a mentés úgyis ugyanezen a hibán akad
 * meg, a validátornak nem kell helyette döntenie.
 */
async function kotottCimFoglalt(
  cim: KotottUrlapCim,
  id: number | string | null | undefined,
  req: PayloadRequest,
): Promise<boolean> {
  const feltetelek: Where[] = [{ title: { equals: cim } }]
  if (id !== undefined && id !== null) {
    feltetelek.push({ id: { not_equals: id } })
  }
  try {
    const { docs } = await req.payload.find({
      collection: 'forms',
      where: { and: feltetelek },
      limit: 1,
      depth: 0,
      pagination: false,
      req,
      select: { title: true },
    })
    return docs.length > 0
  } catch (error) {
    logger.warn('űrlapcím-validátor: a kötött név egyedisége nem ellenőrizhető', {
      cim,
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}

/**
 * A cím mező validátora. A saját `validate` a Payload beépítettjét lecseréli
 * („Payload will use yours in place of the default”,
 * https://payloadcms.com/docs/fields/overview), ezért a sorrend:
 *  1. a Payload alap szöveg-validátora: a kötelezőség és a hosszkorlát
 *     változatlan, az üres cím a megszokott kötelező-hibát adja;
 *  2. az átnevezés: ha a `previousValue` (a mentett cím) kötött, és az új
 *     érték más, hiba;
 *  3. az egyediség: ha az új érték kötött név, és létrehozás történik (ide
 *     tartozik a duplikálás is, ahol a `previousValue` a forrás címe) vagy a
 *     név változik, a gyűjteményben nem lehet másik ilyen nevű űrlap.
 *     Változatlan kötött névnél mentéskor nincs lekérdezés.
 *
 * A Payload dokumentációja az adatbázist kérdező validálást csak beküldéskor
 * javasolja („consider using the `event` property … to only run that
 * particular validation on form submission”). Itt mindkét eseménynél fut,
 * mert a mentés utáni gépeléskor egy csak-beküldéses ellenőrzés `true`-ja
 * letörölné a még fennálló hibát (a form-state a mező állapotát minden
 * validáláskor újraépíti, és hibát csak szöveges eredménynél tesz bele:
 * @payloadcms/ui/dist/forms/fieldSchemasToFormState/addFieldStatePromise.js);
 * a lekérdezés csak a három kötött név valamelyikénél indul, `limit: 1`,
 * darabszámlálás nélkül.
 *
 * MIKOR LÁTSZIK A HIBA (a forrásban ellenőrizve): a szerkesztő első
 * form-state építése validálás nélkül fut (@payloadcms/next/dist/views/
 * Document/index.js:190, `skipValidation: true`); gépelés közben a Payload
 * csak az első mentési kísérlet után validál (@payloadcms/ui/dist/views/
 * Edit/index.js:399, `skipValidation: !submitted`); mentéskor a szerver
 * mindig validál, ekkor a `previousValue` a tárolt cím.
 */
export const validateUrlapCim: TextFieldSingleValidation = async (value, options) => {
  const alap = alapSzovegValidalas(value, options)
  if (alap !== true) {
    return alap
  }
  const { id, operation, previousValue, req } = options
  if (isKotottUrlapCim(previousValue) && value !== previousValue) {
    return kotottCimHiba(previousValue)
  }
  if (isKotottUrlapCim(value) && (operation === 'create' || value !== previousValue)) {
    return (await kotottCimFoglalt(value, id, req)) ? kotottCimFoglaltHiba(value) : true
  }
  return true
}

/** A kötött nevű űrlap másolatának utótagja. */
export const MASOLAT_UTOTAG = ' (másolat)'

/**
 * A cím mező `beforeDuplicate` hookja. A Payload szerint ez a hook
 * duplikáláskor fut, a `beforeValidate` és a `beforeChange` előtt, arra az
 * esetre, amikor „documents having the exact same properties may cause
 * issue” (https://payloadcms.com/docs/hooks/fields, beforeDuplicate). A
 * beépített „ - Copy” utótagot a Payload csak a `unique` mezőkre teszi
 * (payload/dist/fields/setDefaultBeforeDuplicate.js), a cím pedig nem
 * `unique`, ezért nélküle a másolat pontosan a kötött nevet kapná, és a
 * validátor foglalt-hibája a duplikálást elutasítaná. Ezt a hibát a
 * „Duplikálás” gomb csak egy általános felugró üzenetben mutatná
 * (@payloadcms/ui/dist/elements/DuplicateDocument/index.js, errors[0]).
 *
 * Kötött névnél utótagot ad, minden más értéket változatlanul visszaad. Mezőhook,
 * nem access és nem auth-hook; adatbázis-oszlopot nem érint.
 */
export const urlapCimMasolatNeve: FieldHook<Form, string | null | undefined> = ({ value }) =>
  isKotottUrlapCim(value) ? `${value}${MASOLAT_UTOTAG}` : value

/**
 * A gyűjtemény leírása (az Űrlapok lista fejlécében). Csak igazat mond: hol
 * látszik a két használt űrlap, és hogy a harmadikat a weboldal nem használja.
 * A Hírlevél a (frontend) minden lapjának láblécében látszik, a notFound()
 * 404-es lapjain is; csak az illeszkedő útvonal nélküli URL (pl. /a/b/c)
 * kapja a global-not-found egyszerűsített láblécét (mérve böngészőben,
 * hidratálás után).
 */
export const URLAP_GYUJTEMENY_LEIRAS = `Az Időpontkérés űrlap ${nevelo(IDOPONT_SZEKCIO_NEV)} ${IDOPONT_SZEKCIO_NEV} szekcióban (most a Kapcsolat oldalon), a Hírlevél minden oldal láblécében látszik. A Kapcsolat nevű űrlapot a weboldal most nem használja. A kérdéseket és a gombfeliratokat a weboldal kódja adja, a beküldéseket az Űrlapbeküldések között találod.`

/** A cím mező súgója. */
export const CIM_SUGO =
  'Az Időpontkérés és a Hírlevél űrlapot a weboldal erről a névről találja meg, a Kapcsolat űrlapot a rendszer induláskor erről ellenőrzi. Ezt a hármat nem nevezheted át, és más űrlap nem kaphatja meg a nevüket.'

/** A mezőlista súgója: a React-űrlapok a kérdéseket a kódból veszik. */
export const MEZOK_SUGO = 'A weboldal ezt a listát nem olvassa, az űrlapok kérdéseit a kódja adja.'

/** A gomb feliratának súgója (Hírlevél: „Feliratkozom”, Időpontkérés: `ctaLabel('appointment-submit')`). */
export const GOMB_SUGO = 'A weboldal ezt nem használja, a gombok feliratát a kódja adja.'

/** A megerősítés típusának súgója: mindkét űrlap helyben mutatja a köszönő szöveget. */
export const MEGEROSITES_TIPUS_SUGO =
  'A weboldal ezt nem használja: beküldés után a látogató mindig ugyanazon az oldalon marad, és ott kapja a köszönő szöveget.'

/**
 * A megerősítő üzenet súgója. A Hírlevél köszönő szövege a kódban van
 * (src/lib/newsletter/submit.ts `NEWSLETTER_SUCCESS_MESSAGE`), az
 * időpontkérés beküldés utáni címe és szövege az Időpontkérés szekció két
 * mezője (AppointmentForm.tsx: `sikerCim`, `sikerSzoveg`, üresen kódtartalék).
 */
export const KOSZONO_SZOVEG_SUGO = `A weboldal ezt a szöveget nem mutatja: az időpontkérés után megjelenő címet és szöveget ${nevelo(IDOPONT_SZEKCIO_NEV)} ${IDOPONT_SZEKCIO_NEV} szekció „${IDOPONT_KOSZONO_CIM_MEZO}” és „${IDOPONT_KOSZONO_MEZO}” mezőjében írod át (Oldalak > Kapcsolat), a hírlevél köszönő szövegét a weboldal kódja adja.`

/** Az átirányítás súgója. */
export const ATIRANYITAS_SUGO =
  'A weboldal ezt nem használja: beküldés után a látogató ugyanazon az oldalon marad.'

/** A tájékoztató UI-mező neve (adatbázis-oszlopa nincs, `type: 'ui'`). */
export const URLAP_KOTES_MEZO_NEV = 'urlapHelyeJelzes'

/** A tájékoztató komponens útvonala az importMap számára. */
export const FORM_BINDING_NOTICE_PATH = '/components/admin/FormBindingNotice#FormBindingNotice'

/** Legelöl álló tájékoztató: hol látszik az űrlap a weboldalon (FormBindingNotice). */
export const urlapKotesMezo: UIField = {
  name: URLAP_KOTES_MEZO_NEV,
  type: 'ui',
  label: 'Hol látszik a weboldalon',
  admin: {
    disableListColumn: true,
    components: {
      Field: FORM_BINDING_NOTICE_PATH,
    },
  },
}

/** Egy mező admin-kulcsainak bővítése; a név, a típus és minden más kulcs érintetlen. */
function adminnal<T extends Field>(mezo: T, admin: NonNullable<Field['admin']>): T {
  return { ...mezo, admin: { ...mezo.admin, ...admin } }
}

function mezoAdminnal(mezo: Field): Field {
  if (!('name' in mezo)) {
    return mezo
  }
  switch (mezo.name) {
    case 'title':
      if (mezo.type === 'text' && mezo.hasMany !== true) {
        return {
          ...adminnal(mezo, { description: CIM_SUGO }),
          validate: validateUrlapCim,
          // A plugin esetleges saját hookjai megmaradnak, a miénk a végén fut.
          hooks: {
            ...mezo.hooks,
            beforeDuplicate: [...(mezo.hooks?.beforeDuplicate ?? []), urlapCimMasolatNeve],
          },
        }
      }
      return mezo
    case 'fields':
      return adminnal(mezo, { readOnly: true, description: MEZOK_SUGO })
    case 'submitButtonLabel':
      return adminnal(mezo, { readOnly: true, description: GOMB_SUGO })
    case 'confirmationType':
      return adminnal(mezo, { readOnly: true, description: MEGEROSITES_TIPUS_SUGO })
    case 'confirmationMessage':
      // Feltételesen kötelező (required + condition): csak súgó, readOnly nem.
      return adminnal(mezo, { description: KOSZONO_SZOVEG_SUGO })
    case 'redirect':
      // A csoport `url` gyermeke kötelező: csak súgó, readOnly nem.
      return adminnal(mezo, { description: ATIRANYITAS_SUGO })
    case 'emails':
      // GDPR 9. cikk: a sorok minden beküldésnél levelet küldenének.
      return adminnal(mezo, { hidden: true })
    default:
      return mezo
  }
}

/**
 * A plugin `formOverrides.fields` függvényéhez: a tájékoztató UI-mező
 * legelöl, utána a plugin mezői a fenti admin-kulcsokkal. A bemenetet nem
 * módosítja (a módosított mezők új objektumok, a többi ugyanaz marad).
 */
export function urlapMezokAdminnal(defaultFields: readonly Field[]): Field[] {
  return [urlapKotesMezo, ...defaultFields.map(mezoAdminnal)]
}
