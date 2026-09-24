import { postgresAdapter } from '@payloadcms/db-postgres'
import { formBuilderPlugin } from '@payloadcms/plugin-form-builder'
import { FixedToolbarFeature, lexicalEditor } from '@payloadcms/richtext-lexical'
import { hu } from '@payloadcms/translations/languages/hu'
import path from 'node:path'
import {
  APIError,
  buildConfig,
  type CollectionBeforeValidateHook,
  type Payload,
  type Plugin,
} from 'payload'
import sharp from 'sharp'
import { fileURLToPath } from 'node:url'

import { isAdmin } from './access'
import { ADMIN_UTAK } from './components/admin/KezdolapCel'
import { AuditLogs } from './collections/AuditLogs'
import { RefundIntents } from './collections/RefundIntents'
import {
  ensureHomeImages,
  ensureHomeLayoutFrissTelepitesen,
  ensureHomeTestimonialsFrissTelepitesen,
} from './lib/home-seed'
import { ensureMediaFiles } from './lib/media-restore'
import { guardDestructiveMigrationCommands } from './lib/migrations/destructive-migration-guard'
import { Categories } from './collections/Categories'
import { CourseProgress } from './collections/CourseProgress'
import { CourseFiles } from './collections/CourseFiles'
import { Media } from './collections/Media'
import { Menus } from './collections/Menus'
import { Pages } from './collections/Pages'
import { Posts } from './collections/Posts'
import { Testimonials } from './collections/Testimonials'
import { Users } from './collections/Users'
import { WebhookEvents } from './collections/WebhookEvents'
import { buildOriginAllowlist } from './env'
import { jobsConfig } from './jobs'
import { restrictJobStatsGlobalAccess } from './jobs/jobs-stats-access'
import { restrictLockedDocumentsAccess } from './lib/security/locked-documents-access'
import { restrictResetTokenFieldAccess } from './lib/security/reset-token-field-access'
import { registerBarionWebhookProcessor } from './lib/barion-callback/process-callback'
import { APPOINTMENT_FORM_TITLE, ensureAppointmentForm } from './lib/appointment/form'
import {
  APPOINTMENT_AVAILABILITY_FIELD,
  APPOINTMENT_EMAIL_FIELD,
  APPOINTMENT_NAME_FIELD,
  APPOINTMENT_PHONE_FIELD,
  APPOINTMENT_REASON_FIELD,
  validateAppointmentSubmissionData,
} from './lib/appointment/validation'
import { validateContactSubmissionData } from './lib/contact-submission'
import { budapestDateTimeString } from './lib/date/budapest'
import {
  appointmentCustomerEmail,
  appointmentStaffEmail,
  contactStaffEmail,
  kineticareEmailAdapter,
  sendMail,
  usersAuthEmails,
} from './lib/email'
import { NEWSLETTER_FORM_TITLE, ensureNewsletterForm } from './lib/newsletter/form'
import { validateNewsletterSubmissionData } from './lib/newsletter/validation'
import { huAdminForditasPlugin } from './lib/admin/hu-forditas'
import {
  CONTACT_FORM_TITLE,
  URLAP_GYUJTEMENY_LEIRAS,
  urlapMezokAdminnal,
} from './lib/admin/urlap-admin'
import { logger } from './lib/logger'
import { adminGroups } from './plugins/admin-groups'
import { audit } from './plugins/audit'
import { ecommerce } from './plugins/ecommerce'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

/**
 * A CORS/CSRF-engedélylista a publikus szerver-URL EREDETÉBŐL (src/env.ts —
 * ugyanaz a normalizálás hajtja a storefront `metadataBase`-ét és az
 * SEO-segédeket is, tehát a védett és a hirdetett cím nem csúszhat szét).
 * A második argumentum az `EXTRA_ALLOWED_ORIGINS`: DNS-cutover alatt, amíg a
 * primer URL még a Railway, ide kell a kineticare.hu + www pár.
 *
 * A `cors` és a `csrf` KÜLÖN hívást kap, mert a Payload szanitálása a `csrf`
 * tömbbe beleírhat (node_modules/payload/dist/config/sanitize.js:340-342) —
 * közös tömb-referencia mellett ez a `cors`-t is átírná.
 */
const corsAllowlist = buildOriginAllowlist(
  process.env.NEXT_PUBLIC_SERVER_URL,
  process.env.EXTRA_ALLOWED_ORIGINS,
)
const csrfAllowlist = buildOriginAllowlist(
  process.env.NEXT_PUBLIC_SERVER_URL,
  process.env.EXTRA_ALLOWED_ORIGINS,
)

// ---------------------------------------------------------------------------
// T-016: kapcsolat űrlap — beküldés-kezelés (spam-védelem + staff-értesítő)
// ---------------------------------------------------------------------------

const TURNSTILE_SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
const TURNSTILE_TIMEOUT_MS = 8_000
const TURNSTILE_UNAVAILABLE_MESSAGE =
  'A spam-ellenőrzés most nem érhető el. Próbáld újra néhány perc múlva, vagy hívj minket telefonon.'

/**
 * A Cloudflare siteverify hívása. Hálózati hiba, időtúllépés, nem 2xx vagy nem
 * JSON válasz esetén 503-as APIError, magyar üzenettel: kezeletlen hibánál a
 * Payload a nem nyilvános 500-ast „Something went wrong." szövegre cserélné.
 * A naplóba sem a token, sem személyes adat nem kerül.
 */
async function callTurnstileSiteverify(
  secret: string,
  token: string,
): Promise<{ success?: boolean }> {
  let response: Response
  try {
    response = await fetch(TURNSTILE_SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret, response: token }),
      signal: AbortSignal.timeout(TURNSTILE_TIMEOUT_MS),
    })
  } catch (error) {
    logger.warn('Turnstile siteverify nem érhető el', {
      reason: error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'network',
      errorName: error instanceof Error ? error.name : typeof error,
    })
    throw new APIError(TURNSTILE_UNAVAILABLE_MESSAGE, 503)
  }
  if (!response.ok) {
    logger.warn('Turnstile siteverify nem érhető el', {
      reason: 'http-status',
      status: response.status,
    })
    throw new APIError(TURNSTILE_UNAVAILABLE_MESSAGE, 503)
  }
  let body: unknown
  try {
    body = await response.json()
  } catch {
    body = undefined
  }
  // A szabályos válasz objektum, logikai `success` mezővel. Minden más (`{}`,
  // `[]`, hiányzó mező) szolgáltatói hiba, nem „rossz token" (503, nem 400).
  const success =
    typeof body === 'object' && body !== null && !Array.isArray(body)
      ? (body as { success?: unknown }).success
      : undefined
  if (typeof success !== 'boolean') {
    logger.warn('Turnstile siteverify nem érhető el', { reason: 'invalid-body' })
    throw new APIError(TURNSTILE_UNAVAILABLE_MESSAGE, 503)
  }
  return { success }
}

/**
 * Turnstile-előkészítés: a form-submissions rekord opcionális turnstileToken
 * mezőjét a TURNSTILE_SECRET_KEY jelenléte kapcsolja be — env nélkül a
 * spam-ellenőrzés KI van kapcsolva, a beküldés akadálytalan. (A kliensoldali
 * widget a TURNSTILE_SITE_KEY-val kerül a frontendre.)
 *
 * Ez a „nincs kulcs → nincs ellenőrzés" ág addig él, amíg a Turnstile nincs
 * élesítve. Production-ben az induláskori assert (`turnstileEnvPair`,
 * src/env.ts) a kulcsPÁR konzisztenciáját követeli meg: fél-lábas
 * konfigurációval (csak site key VAGY csak secret) az app el sem indul,
 * teljes hiánynál pedig induláskori warn jelzi, hogy a védelem kikapcsolt —
 * csendben fél-védett állapot tehát élesben nem létezhet.
 *
 * Csak CREATE-en fut. A token egyszer használatos (a Cloudflare a második
 * ellenőrzést elutasítja), így ha update-en is futna, a stáb minden admin-
 * módosítása a tárolt, már elhasznált tokenen bukna el. A nyilvános felület
 * kizárólag a create; az update staff+owner jogosultságú.
 *
 * Ha a siteverify nem érhető el, 503-as APIError megy a kliensnek magyar
 * üzenettel (lásd `callTurnstileSiteverify`).
 */
const verifyTurnstile = async (data: unknown, operation: string): Promise<unknown> => {
  if (operation !== 'create') {
    return data
  }
  const secret = process.env.TURNSTILE_SECRET_KEY
  if (!secret) {
    return data
  }
  const token =
    typeof data === 'object' && data !== null
      ? (data as Record<string, unknown>).turnstileToken
      : undefined
  if (typeof token !== 'string' || token.length === 0) {
    throw new APIError(
      'A spam-ellenőrzés nem futott le. Frissítsd az oldalt, és küldd el újra az űrlapot.',
      400,
    )
  }
  const result = await callTurnstileSiteverify(secret, token)
  if (result.success !== true) {
    throw new APIError(
      'A spam-ellenőrzés nem sikerült. Frissítsd az oldalt, és küldd el újra az űrlapot.',
      400,
    )
  }
  return data
}

/**
 * A nyilvános űrlapok HÁROM sémája (C9). A `form-submissions` collection
 * egyetlen hookláncot futtat, de a beküldés sémája űrlaponként más:
 *  - `contact` — a „Kapcsolat" űrlap (név, e-mail, tárgy, üzenet, consentPrivacy);
 *  - `newsletter` — a lábléc „Hírlevél" űrlapja (e-mail, consentNewsletter);
 *  - `appointment` — az „Időpontkérés" űrlap (név, telefon, e-mail, panasz,
 *    időpont-sávok, consentHealth), az időpontkérő szekcióból.
 *
 * Enélkül a hírlevél- és az időpontkérés-beküldés a kapcsolat-szerződésen bukna
 * el („Add meg az üzenet tárgyát.") — a `src/lib/contact-submission.ts` fejléce
 * pontosan ezt az esetet jelzi előre: több nyilvános űrlapnál a szerződést szét
 * kell bontani.
 */
type FormSubmissionKind = 'contact' | 'newsletter' | 'appointment'

/** A besorolás átadása a beforeValidate → afterChange úton (Payload req.context). */
const FORM_KIND_CONTEXT_KEY = 'kineticareFormKind'

type HookRequest = Parameters<CollectionBeforeValidateHook>[0]['req']

/**
 * A beküldéshez tartozó űrlap AZONOSÍTÁSA — az űrlap CÍME alapján, a
 * `data.form` azonosítóból feloldva.
 *
 * Miért nem a beküldött mezők alakjából: azt a hívó szabadon alakítja, tehát a
 * szerveroldali szerződést a kliens választhatná meg (elég lenne a `message`
 * mezőt elhagyni a lazább szabályokhoz). A form-id viszont a rekord része, a
 * címet pedig az adatbázis mondja meg.
 *
 * Egy indexelt, egysoros olvasás, a hívó tranzakciójában (`req`). Ha nem oldható
 * fel (hiányzó/ismeretlen form, olvasási hiba), a SZIGORÚBB `contact`
 * szerződés marad érvényben — azaz a mai viselkedés, a hírlevél-ág pedig ilyen
 * esetben hangosan (magyar hibaüzenettel) elutasít, nem csendben enged át.
 */
async function resolveFormKind(
  req: HookRequest | undefined,
  form: unknown,
): Promise<FormSubmissionKind> {
  if (typeof form !== 'string' && typeof form !== 'number') {
    return 'contact'
  }
  // A hook közvetlen (teszt-)hívásakor nincs valódi `req` — ilyenkor sem
  // dobhatunk: a szigorúbb, kapcsolat-szerződés marad.
  if (typeof req?.payload?.findByID !== 'function') {
    return 'contact'
  }
  try {
    const doc = await req.payload.findByID({
      // A forms collection a form-builder pluginből jön — a payload-types nem
      // tartalmazza, ezért a slug castolt (ugyanaz a minta, mint lentebb).
      collection: 'forms' as 'pages',
      id: form,
      depth: 0,
      overrideAccess: true,
      req,
    })
    const title = (doc as unknown as { title?: unknown }).title
    if (title === NEWSLETTER_FORM_TITLE) {
      return 'newsletter'
    }
    if (title === APPOINTMENT_FORM_TITLE) {
      return 'appointment'
    }
    return 'contact'
  } catch (error) {
    logger.warn('az űrlap-beküldéshez tartozó űrlap nem azonosítható — a szigorúbb szerződés fut', {
      error: error instanceof Error ? error.message : String(error),
    })
    return 'contact'
  }
}

/**
 * K2: a kapcsolat-űrlap beküldésének SZERVER-oldali mező- és consent-
 * ellenőrzése. A form-builder plugin a submissionData sorokat ellenőrzés
 * nélkül tárolja, ezért a kötelező mezőket és a consentPrivacy
 * hozzájárulást itt érvényesítjük — a szabályok és a magyar hibaüzenetek a
 * kliensoldali validáció tükre (src/lib/contact-submission.ts). A hibák
 * APIError-ként ugyanúgy magyarul érkeznek a klienshez, mint a
 * Turnstile-hibák (a frontend errors[0].message-et jelenít meg).
 *
 * Csak CREATE-en fut: update-nél a `data` csak a küldött mezőket hordozza,
 * így egy submissionData-t nem érintő staff-módosítást az ellenőrzés
 * tévesen utasítana el. A nyilvános támadási felület (és a consent-mentes
 * beküldés lehetősége) kizárólag a create — az update/delete staff+owner
 * jogosultságú.
 *
 * A Turnstile-ellenőrzés ELŐTT fut: a mezőhiba olcsó és helyi, a
 * siteverify pedig külső hívás — a formailag hibás beküldésre felesleges
 * Turnstile-kérést nem indítunk.
 */
const validateContactSubmission: CollectionBeforeValidateHook = async ({
  data,
  operation,
  req,
}) => {
  if (operation !== 'create') {
    return data
  }
  const record = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {}
  const request = req as HookRequest | undefined
  const kind = await resolveFormKind(request, record.form)
  // A staff-értesítő (afterChange) ugyanezt a besorolást használja — a
  // req.context-ben adjuk tovább, hogy ne kelljen még egyszer lekérdezni.
  if (request?.context) {
    request.context[FORM_KIND_CONTEXT_KEY] = kind
  }
  const errors =
    kind === 'newsletter'
      ? validateNewsletterSubmissionData(record.submissionData)
      : kind === 'appointment'
        ? validateAppointmentSubmissionData(record.submissionData)
        : validateContactSubmissionData(record.submissionData)
  if (errors.length > 0) {
    throw new APIError(errors.join(' '), 400)
  }
  return data
}

/**
 * A Reply-To cím formai ellenőrzése: az űrlap-validátorok
 * (contact-submission, appointment/validation) mintája. Szóközt és sortörést
 * nem enged, így fejléc-injektálásra sem alkalmas.
 */
const STAFF_REPLY_TO_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Staff-értesítő űrlap-beküldéskor (T-018 sablonok).
 * A címzettlista a CONTACT_STAFF_EMAILS env-ből jön (vessző-szeparált); üres
 * env = nincs értesítés, a beküldés ettől függetlenül mentődik. Best-effort:
 * az e-mail-hiba sosem rontja el a beküldést.
 *
 * C9: a HÍRLEVÉL-feliratkozás NEM küld staff-értesítőt. A `contact-staff`
 * sablon a kapcsolat-üzenetre van szabva (név + üzenettörzs), feliratkozásnál
 * üres mezőkkel menne ki, és minden feliratkozás levelet gyártana. A
 * feliratkozások az adminban, az Űrlapbeküldések listán látszanak
 * (docs/hirlevel.md). A besorolás a beforeValidate-ből érkezik a
 * `req.context`-en — hiánya (elvi ág) a mai viselkedést, a küldést jelenti.
 *
 * Az IDŐPONTKÉRÉS viszont KÜLÖN sablont kap (`appointmentStaffEmail`): ott a
 * munkafolyamat a visszahívás, tehát a tárgyban és a levél élén a
 * TELEFONSZÁMNAK kell állnia. A kapcsolat-sablonnal küldve a levél „Új
 * kapcsolatfelvétel" tárggyal, üres üzenettörzzsel érkezne, és a stáb nem
 * látná, kit kell hívnia.
 */
const notifyStaffOnSubmission = async ({
  doc,
  operation,
  formKind,
}: {
  doc: unknown
  operation: string
  formKind: unknown
}): Promise<unknown> => {
  if (operation !== 'create') {
    return doc
  }
  if (formKind === 'newsletter') {
    logger.debug('hírlevél-feliratkozás — staff-értesítő kihagyva')
    return doc
  }
  const recipients = (process.env.CONTACT_STAFF_EMAILS ?? '')
    .split(',')
    .map((email) => email.trim())
    .filter((email) => email.length > 0)
  if (recipients.length === 0) {
    // Élesben ez elveszett megkeresést jelent (a stáb nem tud a beküldésről),
    // ezért warn; fejlesztésben a hiányzó címlista megszokott, ott debug.
    // Személyes adat (név, e-mail, telefon) nem kerül a naplóba.
    if (process.env.NODE_ENV === 'production') {
      logger.warn('CONTACT_STAFF_EMAILS üres — staff-értesítő kihagyva, a beküldés mentve', {
        formKind: typeof formKind === 'string' ? formKind : 'ismeretlen',
      })
    } else {
      logger.debug('CONTACT_STAFF_EMAILS üres — staff-értesítő kihagyva')
    }
    return doc
  }
  try {
    const submissionData =
      typeof doc === 'object' && doc !== null
        ? ((doc as Record<string, unknown>).submissionData as
            Array<{ field?: string; value?: string }> | undefined)
        : undefined
    const fieldValue = (name: string): string =>
      submissionData?.find((entry) => entry.field === name)?.value ?? ''
    // Az éles szerver UTC-ben fut: a stáb a budapesti időt várja.
    const submittedAt = budapestDateTimeString(new Date())
    // Reply-To a beküldő címére, hogy a stáb a „Válasz" gombbal neki írjon.
    // Csak formailag érvényes, egysoros címet teszünk a fejlécbe.
    const submitterEmail = (
      formKind === 'appointment' ? fieldValue(APPOINTMENT_EMAIL_FIELD) : fieldValue('email')
    ).trim()
    const replyTo = STAFF_REPLY_TO_EMAIL_PATTERN.test(submitterEmail) ? submitterEmail : undefined
    const template =
      formKind === 'appointment'
        ? appointmentStaffEmail({
            name: fieldValue(APPOINTMENT_NAME_FIELD) || 'Ismeretlen beküldő',
            phone: fieldValue(APPOINTMENT_PHONE_FIELD),
            email: fieldValue(APPOINTMENT_EMAIL_FIELD),
            availability: fieldValue(APPOINTMENT_AVAILABILITY_FIELD),
            reason: fieldValue(APPOINTMENT_REASON_FIELD),
            submittedAt,
          })
        : contactStaffEmail({
            name: fieldValue('name') || 'Ismeretlen beküldő',
            email: fieldValue('email') || '-',
            message: fieldValue('message'),
            submittedAt,
          })
    const result = await sendMail({ to: recipients, ...template, ...(replyTo ? { replyTo } : {}) })
    if (!result.ok) {
      logger.warn('staff-értesítő küldése sikertelen', {
        retryable: result.retryable,
        error: result.error,
      })
    }

    /**
     * VISSZAIGAZOLÁS A BEKÜLDŐNEK — időpontkérésnél, ha megadott e-mail-címet.
     *
     * Az űrlap e-mail-mezője alatt ez áll: „Ide küldünk visszaigazolást, ha
     * telefonon nem érünk el." Ez eddig nem teljesült: csak a stáb kapott
     * levelet. A mező OPCIONÁLIS, ezért cím nélkül nincs mit küldeni — az nem
     * hiba, csak nincs teendő.
     *
     * Best-effort, a stáb-értesítő UTÁN: ha a visszaigazolás elakadna, a
     * visszahíváshoz szükséges stáb-levél már kiment.
     */
    const beküldőEmail = fieldValue(APPOINTMENT_EMAIL_FIELD).trim()
    if (formKind === 'appointment' && beküldőEmail.length > 0) {
      const serverUrl = (process.env.NEXT_PUBLIC_SERVER_URL ?? '').replace(/\/+$/, '')
      const visszaigazolas = appointmentCustomerEmail({
        name: fieldValue(APPOINTMENT_NAME_FIELD),
        phone: fieldValue(APPOINTMENT_PHONE_FIELD),
        availability: fieldValue(APPOINTMENT_AVAILABILITY_FIELD),
        ...(serverUrl ? { contactUrl: `${serverUrl}/kapcsolat` } : {}),
      })
      const vissza = await sendMail({ to: beküldőEmail, ...visszaigazolas })
      if (!vissza.ok) {
        logger.warn('időpontkérés-visszaigazoló küldése sikertelen (best-effort)', {
          retryable: vissza.retryable,
          error: vissza.error,
        })
      }
    }
  } catch (error) {
    logger.warn('staff-értesítő feldolgozása sikertelen (best-effort)', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
  return doc
}

// ---------------------------------------------------------------------------
// T-016: „Kapcsolat" űrlap idempotens létrehozása (a plugin formja DB-tartalom,
// nincs rá migráció — az onInit gondoskodik róla, best-effort).
// ---------------------------------------------------------------------------

function contactFormData(): Record<string, unknown> {
  const confirmationText = 'Köszönjük az üzenetét! Munkatársunk hamarosan jelentkezik.'
  return {
    title: CONTACT_FORM_TITLE,
    submitButtonLabel: 'Üzenet küldése',
    confirmationType: 'message',
    confirmationMessage: {
      root: {
        type: 'root',
        version: 1,
        direction: 'ltr',
        format: '',
        indent: 0,
        children: [
          {
            type: 'paragraph',
            version: 1,
            direction: 'ltr',
            format: '',
            indent: 0,
            children: [
              {
                type: 'text',
                version: 1,
                detail: 0,
                format: 0,
                mode: 'normal',
                style: '',
                text: confirmationText,
              },
            ],
          },
        ],
      },
    },
    fields: [
      { blockType: 'text', name: 'name', label: 'Név', required: true },
      { blockType: 'email', name: 'email', label: 'E-mail cím', required: true },
      { blockType: 'textarea', name: 'message', label: 'Üzenet', required: true },
    ],
    emails: [],
  }
}

/**
 * A `pg` pool tétlen kapcsolatain érkező hibák lekezelése.
 *
 * A Railway privát hálózata elvágja a tétlen TCP-kapcsolatokat. A pool ilyenkor
 * `error` eseményt bocsát ki a tétlen kliensen; ha ezt senki nem kezeli le, a
 * Node `uncaughtException`-ként dobja tovább, és a teljes szerverfolyamat
 * instabillá válik (a production-logban ez a
 * „⨯ uncaughtException: Connection terminated unexpectedly" sor).
 * A pool a hibás klienst magától eldobja és újat nyit, tehát a naplózás elég.
 */
function registerPoolErrorHandler(payload: Payload): void {
  const { pool } = payload.db
  if (typeof pool?.on !== 'function') {
    return
  }
  pool.on('error', (error: Error) => {
    logger.warn('Postgres pool hiba tétlen kapcsolaton (a pool újranyitja)', {
      error: error.message,
    })
  })
}

/**
 * A Barion webhook-feldolgozó onInit-ben: a retry csak regisztrált processzort
 * futtat. A callback-route lazy, a cron előbb futhat — onInit nélkül némán
 * kimaradnának. Map.set, idempotens.
 */
function registerWebhookProcessors(payload: Payload): void {
  registerBarionWebhookProcessor(async () => payload)
  logger.debug('Barion webhook-feldolgozó regisztrálva (onInit)')
}

/**
 * Kezdőlap-alapállapot indulásnál: a hiányzó képFÁJLOK visszatöltése, majd a
 * landing tartalmi képei, a `kezdolap` alap-szekciósora és a három induló
 * vélemény (src/lib/home-seed.ts). Minden bootnál lefut, best-effort: hibája
 * nem állíthatja meg az appot.
 *
 * A kezdőlap és a vélemények lépése CSAK FRISS TELEPÍTÉSEN ír (H40, H48 A17):
 * kezdőlapot csak teljesen üres Oldalak-gyűjteménynél hoz létre, véleményt
 * csak üres Vélemények-gyűjteménynél. Beállt rendszeren a két lépés egy-egy
 * `count` olvasás, írás nélkül: a webcímcsere, a kiürített szekciósor, a
 * törölt vagy átnevezett vélemény a következő deploy után is a szerkesztő
 * döntése marad. (A kézi `npm run seed` a webcím- és név-alapú változatot
 * hívja, az ott célzott pótlás.)
 *
 * A SORREND KÖTÖTT: az `ensureMediaFiles` FÁJL-szinten ellenőriz és javít, az
 * `ensureHomeImages` viszont csak a DB-rekord létét nézi (fájlnév-dedup) — ha
 * utóbbi futna előbb, a meglévő rekordok miatt „minden rendben"-t jelentene,
 * miközben a fájlok hiányoznak. Lásd src/lib/media-restore.ts.
 */
async function ensureHomeBaseline(payload: Payload): Promise<void> {
  try {
    await ensureMediaFiles(payload)
    const mediaIds = await ensureHomeImages(payload)
    await ensureHomeLayoutFrissTelepitesen(payload, mediaIds)
    await ensureHomeTestimonialsFrissTelepitesen(payload)
  } catch (error) {
    logger.warn('Kezdőlap-alapállapot ellenőrzése/betöltése sikertelen (best-effort)', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

async function ensureContactForm(payload: Payload): Promise<void> {
  try {
    const existing = await payload.find({
      // A forms collection a form-builder pluginből jön — a payload-types a
      // konsolidációs loop végéig még nem tartalmazza, ezért a slug itt castolt.
      collection: 'forms' as 'pages',
      where: { title: { equals: CONTACT_FORM_TITLE } },
      limit: 1,
      overrideAccess: true,
    })
    if (existing.totalDocs > 0) {
      return
    }
    await payload.create({
      collection: 'forms' as 'pages',
      data: contactFormData() as never,
      overrideAccess: true,
    })
    logger.info('„Kapcsolat" űrlap létrehozva (idempotens onInit)')
  } catch (error) {
    // Best-effort: hiányzó DB/tábla (pl. első migráció előtt) ne állítsa meg az appot.
    logger.warn('„Kapcsolat" űrlap ellenőrzése/létrehozása sikertelen (best-effort)', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Induláskori lépések.
 *
 * A pool-error handler regisztrációja az ELSŐ lépés, és szándékosan önálló:
 * korábban az `ensureContactForm` (űrlap-seedelő) belsejében történt,
 * mellékhatásként — ha azt a form-seedeléssel együtt valaha eltávolítjuk, a
 * handler is némán eltűnt volna, és visszatért volna a CLAUDE.md 7.
 * üzemeltetési tanulságában leírt éles hiba: a Railway privát hálóján elvágott
 * tétlen kapcsolat kezeletlen `error` eseménye `uncaughtException`-ként viszi
 * el a Next.js szerverfolyamatot. A három lépésnek nincs köze egymáshoz, ezért
 * itt látszik is, hogy külön dolog: pool-handler, webhook-feldolgozók,
 * kezdőlap-alapállapot (képek; a szekciósor és a kiemelt vélemények csak friss
 * telepítésen), majd a „Kapcsolat" űrlap.
 *
 * A két memóriabeli regisztráció (pool-handler, webhook-feldolgozók) MEGELŐZI a
 * DB-t érintő, best-effort seedelést: azok hibája (pl. migráció előtti adatbázis)
 * így nem viheti magával a regisztrációkat.
 */
async function onInit(payload: Payload): Promise<void> {
  registerPoolErrorHandler(payload)
  registerWebhookProcessors(payload)
  await ensureHomeBaseline(payload)
  await ensureContactForm(payload)
  // C9: a lábléc hírlevél-űrlapja UGYANOLYAN telepítési előfeltétel, mint a
  // Kapcsolat űrlap — a lábléc minden oldalon ott van, és seedeletlen
  // környezetben a blokk némán kimaradna. Idempotens, meglévőt sosem ír felül.
  // BEST-EFFORT, mint minden onInit-seedelés: a DB-hiba (pl. migráció előtti
  // adatbázis) nem viheti el az indulást és a fenti regisztrációkat — a blokk
  // ilyenkor kimarad, és a lábléc űrlap nélkül renderel (ez a szerződése).
  try {
    await ensureNewsletterForm(payload)
  } catch (error) {
    logger.warn('a „Hírlevél" űrlap onInit-seedelése nem sikerült — a lábléc-blokk kimarad', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
  // Az időpontkérő szekció űrlapja ugyanilyen telepítési előfeltétel: a blokkot
  // a szerkesztő bármelyik lapra kiteheti, és űrlap nélkül a szekció csak a
  // telefonos utat tudná felkínálni. Idempotens, meglévőt sosem ír felül;
  // best-effort, mint minden onInit-seedelés.
  try {
    await ensureAppointmentForm(payload)
  } catch (error) {
    logger.warn(
      'az „Időpontkérés" űrlap onInit-seedelése nem sikerült — a szekció űrlapja letiltva renderel',
      { error: error instanceof Error ? error.message : String(error) },
    )
  }
}

/**
 * A saját admin-nézetek címe (böngészőfül és megosztási előnézet). A Payload a
 * saját nézetek og:title-jét „Payload”-ra állítja, ha a nézet nem ad sajátot
 * (@payloadcms/next/dist/views/Root/generateCustomViewMetadata.js), ezért az
 * og:title is a nézet neve, ugyanúgy, mint az Irányítópulton.
 */
function nezetMeta(cim: string): { title: string; openGraph: { title: string } } {
  return { title: cim, openGraph: { title: cim } }
}

/**
 * A gyűjtemények kulcsszó-meta címkéje. A Payload a szerkesztőnézetbe
 * „<gyűjtemény>, Payload, CMS” kulcsszót ír (@payloadcms/next/dist/views/Edit/
 * metadata.js), a listába üreset; mindkettőt csak a gyűjtemény saját
 * admin.meta-ja írja felül, a globális admin.meta előttük áll. A null a
 * címkét kiveszi, ahogy a globális admin.meta-ban is. Csak megjelenítés: a
 * gyűjtemény mezői, access-e és hookjai érintetlenek. A plugin-lánc vége felé
 * fut, hogy a pluginok gyűjteményeit (webshop, űrlapok) is elérje.
 */
const adminKulcsszoNelkul: Plugin = (config) => ({
  ...config,
  collections: (config.collections ?? []).map((gyujtemeny) => ({
    ...gyujtemeny,
    admin: { ...gyujtemeny.admin, meta: { ...gyujtemeny.admin?.meta, keywords: null } },
  })),
})

export default buildConfig({
  admin: {
    user: Users.slug,
    importMap: {
      baseDir: path.resolve(dirname),
    },
    // Az admin-lapok <head>-je a Payload alapértékei helyett (a forrás:
    // @payloadcms/next/dist/utilities/meta.js és a views/*/metadata.js).
    // - Cím: „<oldal> | Kineticare admin”. A Payload `${cím} ${utótag}`
    //   alakban fűz, ezért az utótag szóközzel NEM kezdődhet (a régi
    //   „ – Kineticare admin” dupla szóközt adott). Az elválasztó a frontend
    //   `%s | Kineticare` mintája; a szóközös nagykötőjel elválasztóként
    //   gondolatjel volna, ezt a docs/ui-sztenderdek.md 3.1.2 és 8.3 tiltja.
    // - Leírás és megosztási előnézet (og:site_name, og:description; a
    //   twitter:description ebből öröklődik): a Payload angol alapszövege
    //   („Payload is a headless CMS…”, „Payload App”) helyett magyarul.
    // - Kép: nincs. A 'dynamic' alapérték /api/og képet adott a Payload
    //   leírásával, abszolút címe pedig a serverURL híján localhostra mutatott.
    //   Az 'off' a /api/og végpontot is kikapcsolja (routes/rest/og/index.js).
    // - Kulcsszó: nincs. A saját nézetek alapja „Payload” volt
    //   (views/Root/generateCustomViewMetadata.js), a gyűjtemény-nézeteké
    //   „<gyűjtemény>, Payload, CMS”: azt az adminKulcsszoNelkul veszi ki.
    //   A saját nézetek og:title-je a nezetMeta-ból jön (a buildConfig előtt).
    // - Ikon: a weboldal meglévő ikonjai (src/app/icon.svg, apple-icon.png) a
    //   Payload saját favikonja helyett; a favicon.ico-t a Next maga teszi ki.
    // - Robots: noindex, nofollow, mint eddig (a Payload alapértéke is ez).
    meta: {
      titleSuffix: '| Kineticare admin',
      description: 'A Kineticare weboldal adminisztrációs felülete.',
      keywords: null,
      robots: 'noindex, nofollow',
      defaultOGImageType: 'off',
      openGraph: {
        siteName: 'Kineticare admin',
        description: 'A Kineticare weboldal adminisztrációs felülete.',
        locale: 'hu_HU',
      },
      icons: [
        { rel: 'icon', type: 'image/svg+xml', sizes: 'any', url: '/icon.svg' },
        { rel: 'apple-touch-icon', type: 'image/png', sizes: '180x180', url: '/apple-icon.png' },
      ],
    },
    // K16 (admin-audit): a Payload alapértéke a Gravatar, amelyet a saját CSP
    // (img-src) jogosan blokkol: minden nézeten törött kép és harmadik félnek
    // szóló kérés volt. A beépített, helyben rajzolt fiókikon nem kér semmit.
    avatar: 'default',
    // K25: magyar dátumalak a listákban és a dokumentumsávban, 24 órás idővel
    // (pl. „2026. 09. 22. 19:10”); a Payload alapértéke 12 órás, angol sorrendű
    // (payload/dist/config/defaults.js). A nap-pontosságú mezők a saját
    // displayFormat-jukat tartják (CourseProgress, Pages, ecommerce).
    dateFormat: 'yyyy. MM. dd. HH:mm',
    components: {
      // A kezdőlap és a videó szövegeinek menüpontja, valamint a saját
      // nézetek linkjei az oldalsáv TETEJÉN, két csoportban (admin-audit K32,
      // K33). A Payload a saját nézeteket nem teszi be a navigációba.
      beforeNavLinks: ['/components/admin/AdminNavLinks#AdminNavLinks'],
      // Ugyanez a videószöveg-link a fejlécben, minden nézeten: 1440 CSS px-ig a
      // Payload betöltéskor becsukja az oldalsávot (részletek az
      // AdminNavLinks.tsx KezdolapVideoFejlecLink kommentjében).
      actions: ['/components/admin/AdminNavLinks#KezdolapVideoFejlecLink'],
      // „Gyakori teendők”: feladat-belépési pontok az Irányítópult tetején (K32).
      beforeDashboard: ['/components/admin/GyakoriTeendok#GyakoriTeendok'],
      // A `?szekcio=<blokk-azonosító>` mélylink kezelője a teljes admin körül:
      // kinyitja a szekciót, odagörget, és az első mezőre teszi a fókuszt
      // (src/components/editor/admin/SzekcioMegnyito.tsx).
      providers: ['/components/editor/admin/SzekcioMegnyito#SzekcioMegnyito'],
      views: {
        // T-013: havi bevétel otthoni/szakmai bontásban. A Payload 3.88.0 a
        // custom view-t NYILVÁNOS admin-route-ként kezeli, ezért a
        // szerepkör-kapu a nézetben van (`canAccessStatistics`), nem itt.
        statisztika: {
          Component: '/components/admin/StatisticsView#StatisticsView',
          path: ADMIN_UTAK.statisztika.utvonal,
          exact: true,
          meta: nezetMeta(ADMIN_UTAK.statisztika.felirat),
        },
        videok: {
          Component: '/components/admin/BunnyLibraryView#BunnyLibraryView',
          path: ADMIN_UTAK.videotar.utvonal,
          exact: true,
          meta: nezetMeta(ADMIN_UTAK.videotar.felirat),
        },
        // A látogatói viselkedés (PostHog beágyazott dashboard) és a külső
        // elemző-felületek linkjei egy helyen; a kapu itt is a nézetben van
        // (hasStaffOrOwnerRole), mert a route nyilvános.
        webanalitika: {
          Component: '/components/admin/WebAnalyticsView#WebAnalyticsView',
          path: ADMIN_UTAK.webanalitika.utvonal,
          exact: true,
          meta: nezetMeta(ADMIN_UTAK.webanalitika.felirat),
        },
        // Stabil, beszédes cím a kezdőlap szerkesztőjéhez: slug alapján
        // keresi meg az oldalt és átirányít. A kapu a nézetben van.
        kezdolap: {
          Component: '/components/admin/KezdolapNezet#KezdolapNezet',
          path: ADMIN_UTAK.kezdolap.utvonal,
          exact: true,
          meta: nezetMeta(ADMIN_UTAK.kezdolap.felirat),
        },
        // A tulajdonos kérése: menüpont a videón lévő szövegekhez. A kezdőlap
        // szerkesztőjébe visz, a nyitó videó szekció mélylinkjével.
        kezdolapVideo: {
          Component: '/components/admin/VideoSzovegeiNezet#VideoSzovegeiNezet',
          path: ADMIN_UTAK.videoSzovegei.utvonal,
          exact: true,
          meta: nezetMeta(ADMIN_UTAK.videoSzovegei.felirat),
        },
      },
    },
  },
  // Az admin CSAK magyar (vezetői döntés, admin-audit K25). Korábban az `en`
  // is választható volt, és angol böngészőnyelvnél a Payload a felület
  // nyelvét az Accept-Language fejlécből angolra váltotta, miközben a saját
  // feliratok magyarok maradtak: vegyes nyelvű admin lett belőle. Egyetlen
  // támogatott nyelvnél a Payload mindig ezt választja; a javított magyar
  // szövegeket a plugin-lánc végén a huAdminForditasPlugin fésüli be.
  i18n: {
    supportedLanguages: { hu },
    fallbackLanguage: 'hu',
  },
  collections: [
    Users,
    Media,
    Pages,
    Posts,
    Menus,
    Categories,
    Testimonials,
    CourseProgress,
    WebhookEvents,
    AuditLogs,
    RefundIntents,
    CourseFiles,
  ],
  // FixedToolbarFeature: a szerkesztő fölött állandóan látszó eszköztár —
  // laikus szerkesztőnek sokkal felfedezhetőbb, mint a lebegő (kijelölésre
  // előbukkanó) alapértelmezett toolbar.
  editor: lexicalEditor({
    features: ({ defaultFeatures }) => [...defaultFeatures, FixedToolbarFeature()],
  }),
  // T-018: a Payload auth e-mailjei (forgot-password) is a saját provider-rétegen
  // mennek ki (Resend/SMTP/noop — env nélkül sosem crashel).
  email: kineticareEmailAdapter,
  // T-014: a webhook-retry task és az ENABLE_JOB_WORKERS env mögötti autoRun.
  jobs: jobsConfig,
  // GraphQL ki: a beépített reset/forgot mutációk megkerülnék a jelszó-politikát
  // és a REST rate-limitet. Visszakapcsolás előtt őr kell mindkettőre.
  graphQL: {
    disable: true,
  },
  // A titok kötelező — az induláskori ENV-assert (src/env.ts + src/instrumentation.ts)
  // gondoskodik róla, hogy hiányában az app ne induljon el.
  secret: process.env.PAYLOAD_SECRET || '',
  // `serverURL` szándékosan üres: beállítva a Media afterRead abszolút URL-t
  // ad, a next/image pedig remotePatterns híján 400-at. CSRF/CORS a saját
  // listájukat nézi, nem ezt. Üres csrf-listánál az extractJWT MINDEN eredetről
  // elfogadná a sütit — a lista a látogatói originhez kell. Rossz
  // NEXT_PUBLIC_SERVER_URL → pénztár, lejátszás, haladás, admin mind 401.
  cors: corsAllowlist,
  csrf: csrfAllowlist,
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  // A pool-beállítások a Railway privát hálózatához vannak hangolva: az
  // elvágott, tétlen TCP-kapcsolatokon a `pg` egyébként ~45 mp-ig (a TCP
  // retransmission-timeoutig) vár, majd „Connection terminated unexpectedly"
  // hibával dől el — emiatt akadt el korábban az admin user létrehozása is.
  db: guardDestructiveMigrationCommands(
    postgresAdapter({
      // A first-register lock utáni recountnak friss commitot kell látnia.
      transactionOptions: { isolationLevel: 'read committed' },
      pool: {
        connectionString: process.env.DATABASE_URI || '',
        // TCP keepalive: életben tartja a kapcsolatot, és a megszakadást
        // másodpercek alatt észreveszi a percek helyett.
        keepAlive: true,
        keepAliveInitialDelayMillis: 10_000,
        // A pool a hálózat előtt dobja el a tétlen kapcsolatot, hogy sose
        // használjon újra olyan socketet, amit a privát háló már elvágott.
        idleTimeoutMillis: 30_000,
        // Fail-fast: ha 10 mp alatt nincs kapcsolat, hiba jöjjön, ne fagyás.
        connectionTimeoutMillis: 10_000,
        // Egyetlen kérés se álljon percekig egy beragadt lekérdezésen.
        statement_timeout: 30_000,
        query_timeout: 30_000,
        // Sorzár-incidens: tétlen nyitott tranzakció zárolta a users sort.
        // A statement_timeout a futó lekérdezést öli; ez a tétlen sessiont.
        // Aktív hosszú migrate/seed nem esik bele.
        idle_in_transaction_session_timeout: 60_000,
        // W3 (2026-08-22): `pool.max` SZÁNDÉKOSAN nincs beállítva. A default 10
        // a `pg` értéke. Railway `max_connections` × replikaszám nélkül a cap
        // vagy kimeríti a DB-t, vagy hamis biztonságot ad. A beágyazott zár
        // (rendelés → e-mail) a sorrenden múlik, nem a pool méretén.
      },
      // Dev drizzle-push ki: interaktív TÁBLATÖRLÉS-prompt, amin a nem-interaktív
      // futás örökre megakad; rossz DATABASE_URI mellett adatot törölne.
      // Séma csak migrációs lánccal. A `push: false` őr-teszt védi.
      push: false,
    }),
  ),
  sharp,
  // T-019 lezárás: a feltölthető fájlok mérete globálisan max. 10 MB (bájtban).
  // Collection-szintű fileSize-limit a pinned 3.88.0-ban nem elérhető, ezért a
  // korlát a globális upload.limits.fileSize mezőn kerül beállításra.
  upload: {
    limits: {
      fileSize: 10485760,
    },
    // K1: abortOnLimit nélkül a multipart-parser a túlméretes fájlt NÉMÁN
    // CSONKOLNÁ (truncated: true), és a feltöltés sikeresnek látszana egy
    // hibás fájllal. Bekapcsolva a parser a limit elérésekor 413-at dob a
    // responseOnLimit üzenettel (payload/dist/uploads/fetchAPI-multipart/
    // processMultipart.js — a config upload-blokkja 1:1-ben a parser
    // opcióira megy, utilities/addDataAndFileToRequest.js).
    abortOnLimit: true,
    responseOnLimit: 'A fájl mérete meghaladja a megengedett 10 MB-os korlátot.',
  },
  onInit,
  plugins: [
    // ecommerce plugin pinned — frissítés csak changelog + staging-E2E után.
    // A részletes konfiguráció (HUF, customers=users, variants/addresses/guest cart
    // kikapcsolva, products/orders override-ok) az src/plugins/ecommerce.ts-ben él.
    ecommerce,
    // T-015: config-szintű audit-hook injekció — az ecommerce UTÁN kell futnia,
    // hogy a products/orders collectionök már létezzenek az injekciókor.
    audit,
    // T-018: users auth e-mail sablonok (forgot-password) config-injekcióval.
    usersAuthEmails,
    // T-016: form-builder plugin pinned 3.88.0 — a nyilvános beküldés a plugin
    // form-submissions endpointján megy (külön POST /api/contact route nincs).
    formBuilderPlugin({
      // Az űrlapok és a beküldések saját admin-csoportot kapnak, magyar
      // megnevezéssel — a tartalom és a webshop mellé, jól elkülönítve.
      formOverrides: {
        labels: {
          singular: 'Űrlap',
          plural: 'Űrlapok',
        },
        fields: ({ defaultFields }) => urlapMezokAdminnal(defaultFields),
        admin: {
          group: 'Űrlapok',
          description: URLAP_GYUJTEMENY_LEIRAS,
        },
        access: {
          // M2: az űrlapok SZERKESZTÉSE staff+owner-jog. A plugin csak a
          // read-et tölti ki (nyilvános — az marad, a nyilvános űrlap-render
          // kéri); a create/update/delete-re a szanitizálás a „bármely
          // bejelentkezett felhasználó" defaultAccess-t tenné
          // (payload/auth/defaultAccess.js), így egy customer átírhatná a
          // kapcsolat-űrlap mezőit és a beküldési e-mail-címet
          // (PII-szivárgás). Az isAdmin = owner/staff (src/access).
          create: isAdmin,
          update: isAdmin,
          delete: isAdmin,
        },
      },
      formSubmissionOverrides: {
        labels: {
          singular: 'Űrlapbeküldés',
          plural: 'Űrlapbeküldések',
        },
        admin: {
          group: 'Űrlapok',
          description: 'A látogatók által beküldött üzenetek. Csak olvasásra való.',
          // A plugin nem ad defaultColumns-t, ezért a Payload automatikus
          // választása szerepelt: azonosító és Turnstile-token — a szerkesztőnek
          // egyik sem mond semmit. Az űrlap neve + a beérkezés ideje kell.
          defaultColumns: ['form', 'createdAt', 'id'],
        },
        access: {
          // Admin oldalon staff+owner olvashatja/kezelheti a beküldéseket;
          // a create a plugin defaultja marad (nyilvános űrlap-beküldés).
          read: isAdmin,
          update: isAdmin,
          delete: isAdmin,
        },
        fields: ({ defaultFields }) => [
          ...defaultFields,
          {
            name: 'turnstileToken',
            type: 'text',
            admin: {
              // K45: a szerkesztőnek nem mond semmit, ezért rejtett; a mező, a
              // hookok és az adatbázis-oszlop változatlan (séma-semleges).
              hidden: true,
              readOnly: true,
              description: 'A beküldés spam-ellenőrzésének jele. A rendszer tölti ki és ellenőrzi.',
            },
          },
        ],
        hooks: {
          // A sorrend számít: előbb a helyi mező-/consent-ellenőrzés (K2),
          // utána a külső Turnstile-hívás.
          beforeValidate: [
            validateContactSubmission,
            async ({ data, operation }) => verifyTurnstile(data, operation),
          ],
          afterChange: [
            async ({ doc, operation, req }) =>
              notifyStaffOnSubmission({
                doc,
                operation,
                formKind: req.context[FORM_KIND_CONTEXT_KEY],
              }),
          ],
        },
      },
    }),
    // A gyűjtemény-nézetek kulcsszó-címkéje „Payload” nélkül (a leírás a
    // függvénynél); a webshop és az űrlapok pluginja után kell futnia.
    adminKulcsszoNelkul,
    // Az admin oldalsáv csoport-sorrendje — a lánc VÉGÉN kell futnia, hogy a
    // plugin-collectionöket (webshop, űrlapok) is besorolja.
    adminGroups,
    // A javított magyar admin-szövegek (K15, K24). A lánc LEGVÉGÉN kell
    // állnia: az ecommerce plugin a saját fordítási névterét felülírja, így
    // ami előtte kerül a configba, elveszik (részletek:
    // src/lib/admin/hu-forditas.ts fejkommentje).
    huAdminForditasPlugin,
  ],
  // A SZANITIZÁLÁS UTÁNI lépés (S2/c). A `jobs.scheduling` bekapcsolásával a
  // Payload maga tol be egy `payload-jobs-stats` globalt, access nélkül —
  // amire a szanitizálás a „bármely bejelentkezett felhasználó" defaultot teszi,
  // olvasásra ÉS ÍRÁSRA. Mivel a global csak a szanitizálás közben jön létre,
  // előre nem konfigurálható: a zár a `buildConfig` EREDMÉNYÉRE kerül.
  // A részletes indoklás (miért nem végpont-szűrő, és miért nem töri el a saját
  // ütemezést) az src/jobs/jobs-stats-access.ts fejlécében.
})
  .then(restrictJobStatsGlobalAccess)
  // Ugyanígy generált és alapértelmezetten nyitott a `payload-locked-documents`
  // collection is (defaultAccess = bármely bejelentkezett user) — a zárak
  // hamisítását zárja a restrictLockedDocumentsAccess.
  .then(restrictLockedDocumentsAccess)
  // A Payload auth-alapmezői (resetPasswordToken, resetPasswordExpiration)
  // olvasás-zár nélkül where-szűrhetők: a staff prefix-szűréssel kitalálhatná
  // az owner élő tokenjét. A zár indoklása a restrictResetTokenFieldAccess fejlécében.
  .then(restrictResetTokenFieldAccess)
