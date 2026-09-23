import type { Payload, TypedUser } from 'payload'
import type { JSX } from 'react'

import { pageBlocks } from '../../blocks'
import {
  CONTACT_FORM_TITLE,
  IDOPONT_KOSZONO_CIM_MEZO,
  IDOPONT_KOSZONO_MEZO,
  IDOPONT_SZEKCIO_NEV,
  IDOPONT_URLAP_KAPCSOLO,
} from '../../lib/admin/urlap-admin'
import { APPOINTMENT_BLOCK_TYPE, appointmentShowsForm } from '../../lib/appointment/context'
import { APPOINTMENT_FORM_TITLE } from '../../lib/appointment/form'
import { logger } from '../../lib/logger'
import { NEWSLETTER_FORM_TITLE } from '../../lib/newsletter/form'
import { UGRAS_FELIRAT } from '../../lib/section-row-label'
import { szerkesztoReteg } from '../editor/frontend/szerkeszto-szalag'

/**
 * „Hol látszik a weboldalon” tájékoztató az űrlap szerkesztőjének tetején
 * (modul-térkép H17, UI-mező, nem tárol adatot).
 *
 * MIT MOND KI, mérve 2026-09-23 (kód és élő /api/forms, /api/pages):
 *  - Hírlevél: a lábléc feliratkozó sora (src/components/layout/Footer.tsx →
 *    NewsletterSignup, a (frontend) layout minden oldalán). A (frontend)
 *    notFound() 404-es lapjai (pl. /nincs-ilyen, /blog/x, /kurzusok/x) is a
 *    teljes láblécet hozzák a feliratkozó sorral; csak az illeszkedő útvonal
 *    nélküli URL (pl. /a/b/c) kapja a src/app/global-not-found.tsx
 *    egyszerűsített, feliratkozás nélküli láblécét. Mérve böngészőben,
 *    hidratálás után (3100, 404-es válasz: 12 `kc-newsletter` elem és a
 *    „Feliratkoz…” szöveg a láblécben; /a/b/c: 0). A dev szerver 404-es
 *    válaszának curl-HTML-je (`<html id="__next_error__">` váz) a
 *    kliens-komponensek kimenetét nem tartalmazza, ezért az ilyen mérés 0-t ad
 *    akkor is, ha a sor a lapon látszik;
 *  - Időpontkérés: az a közzétett oldal, amelynek látható Időpontkérés
 *    szekciója űrlapot mutat (src/lib/appointment/section.ts); élőben és
 *    helyben is a Kapcsolat oldal 1. szekciója. A lapot és a blokkot a
 *    szerver oldja fel, a link a szekcio-melylink kimenete, amely a szekciót
 *    kinyitja (src/components/editor/szekcio-melylink.ts);
 *  - Kapcsolat: a weboldal most sehol nem használja. Greppel igazolva: a
 *    címére csak az induláskori `ensureContactForm` keres, a
 *    /kapcsolat/_components/ContactForm.tsx-et csak tesztek importálják.
 *  - Minden más űrlap: a weboldal nem mutatja. Ide tartozik a kötött nevű
 *    űrlap másolata is („Hírlevél (másolat)”, lásd urlapCimMasolatNeve).
 *
 * A SORCÍMKE UGYANAZ, MINT A SZERKESZTŐBEN (WCAG 2.2 SC 3.2.4). A szekció
 * nevét nem másoljuk: a frontend „Szerkesztem” réteg `szerkesztoReteg`
 * kimenetét olvassuk, amely a B sorcímkéjének (SectionRowLabel) forrásából
 * dolgozik, így a link szövege betűre az a sorfejléc, ahová visz. A link
 * felirata a B tájékoztatójának „Ugrás oda, ahol szerkeszted” szava.
 *
 * Források: NN/g, Visibility of System Status: „Systems should always keep
 * users informed about what is going on”
 * (https://www.nngroup.com/articles/visibility-system-status/); GOV.UK Design
 * System, Inset text a kiegészítő tájékoztatásra
 * (https://design-system.service.gov.uk/components/inset-text/), a B1
 * `.kc-admin-notice` szerződésével (src/app/(payload)/custom.scss).
 *
 * SZERVERKOMPONENS: a Payload a mezőt a szerkesztő betöltésekor rendereli, és
 * átadja a `payload` példányt, a dokumentum adatait és a belépett
 * felhasználót. A lekérdezés a Local API, `overrideAccess: false`-szal, a
 * szerkesztő jogosultságával. Nincs élő régió: a doboz betöltéskor már ott
 * áll, és menet közben nem változik (SC 4.1.3 a változó tartalomra szól).
 */

/** Az űrlap fajtája a mentett címe szerint. */
export type UrlapFajta = 'hirlevel' | 'idopont' | 'kapcsolat' | 'egyeb'

export function urlapFajta(cim: unknown): UrlapFajta {
  if (cim === NEWSLETTER_FORM_TITLE) return 'hirlevel'
  if (cim === APPOINTMENT_FORM_TITLE) return 'idopont'
  if (cim === CONTACT_FORM_TITLE) return 'kapcsolat'
  return 'egyeb'
}

/** Egy hely, ahol az időpontkérő űrlap látszik. */
export interface IdopontHely {
  /** Az oldal címe (az Oldalak listában is ez áll). */
  lapCim: string
  /** A szekció sorcímkéje, betűre az adminé, pl. „01 · Időpontkérés: Kérj időpontot a rendelőbe”. */
  cimke: string
  /** A szekciót megnyitó szerkesztő-cím (szekcioMelylink). */
  href: string
}

export type UrlapKotesModel =
  | { fajta: 'hirlevel' }
  | { fajta: 'idopont'; helyek: readonly IdopontHely[] | null }
  | { fajta: 'kapcsolat' }
  | { fajta: 'egyeb' }

type Rekord = Readonly<Record<string, unknown>>

function isRekord(value: unknown): value is Rekord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * A közzétett oldalakból azok a szekciók, ahol az időpontkérő űrlap látszik:
 * Időpontkérés blokk, bekapcsolt űrlap-kapcsoló és nem rejtett szekció.
 * Tiszta függvény; a lapok és a blokk-katalógus a hívótól jön.
 */
export function idopontHelyek(
  lapok: readonly unknown[],
  blokkok: readonly unknown[],
  adminRoute = '/admin',
): IdopontHely[] {
  const helyek: IdopontHely[] = []
  for (const lap of lapok) {
    if (!isRekord(lap) || (typeof lap.id !== 'number' && typeof lap.id !== 'string')) {
      continue
    }
    const layout = Array.isArray(lap.layout) ? lap.layout : []
    const lapCim = typeof lap.title === 'string' ? lap.title.trim() : ''
    const reteg = szerkesztoReteg({
      lap: {
        id: lap.id,
        slug: typeof lap.slug === 'string' ? lap.slug : null,
        title: lapCim,
        layout,
      },
      blokkok,
      adminRoute,
    })
    for (const blokk of layout) {
      if (
        !isRekord(blokk) ||
        blokk.blockType !== APPOINTMENT_BLOCK_TYPE ||
        !appointmentShowsForm(blokk) ||
        typeof blokk.id !== 'string'
      ) {
        continue
      }
      const szalag = reteg.szekciok[blokk.id]
      if (szalag === undefined || szalag.rejtett) {
        continue
      }
      helyek.push({ lapCim, cimke: szalag.cimke, href: szalag.href })
    }
  }
  return helyek
}

export interface FormBindingNoticeProps {
  /** A szerkesztett űrlap adatai (a Payload adja). */
  data?: unknown
  payload?: Pick<Payload, 'find'> & { config?: { routes?: { admin?: string } } }
  user?: TypedUser | null
}

/** A közzétett oldalak időpontkérő helyei a Local API-ból; hibánál null. */
export async function idopontHelyekBetoltese(
  payload: NonNullable<FormBindingNoticeProps['payload']>,
  user: TypedUser | null,
  adminRoute: string,
): Promise<IdopontHely[] | null> {
  try {
    const { docs } = await payload.find({
      collection: 'pages',
      where: {
        and: [
          { 'layout.blockType': { equals: APPOINTMENT_BLOCK_TYPE } },
          { _status: { equals: 'published' } },
        ],
      },
      depth: 0,
      pagination: false,
      sort: 'id',
      overrideAccess: false,
      user,
      select: { title: true, slug: true, layout: true },
    })
    return idopontHelyek(docs, pageBlocks, adminRoute)
  } catch (error) {
    logger.warn('űrlap-szerkesztő: az időpontkérő szekciók helye nem tölthető be', {
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

export const HIRLEVEL_CIM = 'Itt látszik: minden oldal láblécében'
export const HIRLEVEL_SZOVEG =
  'A lábléc feliratkozó sora ezt az űrlapot küldi be. A kérdéseit, a gomb feliratát és a köszönő szövegét a weboldal kódja adja.'

export function idopontCim(helyek: readonly IdopontHely[]): string {
  const [elso] = helyek
  if (helyek.length === 1 && elso !== undefined) {
    return `Itt látszik: ${elso.lapCim} oldal, ${IDOPONT_SZEKCIO_NEV} szekció`
  }
  return `Itt látszik: ${helyek.length} ${IDOPONT_SZEKCIO_NEV} szekcióban`
}

export const IDOPONT_SZOVEG = `A beküldés utáni címét és szövegét („${IDOPONT_KOSZONO_CIM_MEZO}”, „${IDOPONT_KOSZONO_MEZO}”) és az időpont-sávokat a szekcióban írod át, a kérdéseit és a gomb feliratát a weboldal kódja adja.`

/** A link felirata: a B „Ugrás oda, ahol szerkeszted” szava, az oldal és a sorcímke. */
export function idopontLinkFelirat(hely: IdopontHely): string {
  return `${UGRAS_FELIRAT}: ${hely.lapCim}, ${hely.cimke}`
}

export const IDOPONT_NINCS_CIM = 'Most sehol nem látszik a weboldalon'
export const IDOPONT_NINCS_SZOVEG = `Ott jelenik meg, ahol egy közzétett oldal ${IDOPONT_SZEKCIO_NEV} szekciójában be van kapcsolva a „${IDOPONT_URLAP_KAPCSOLO}” pipa, és a szekció nincs elrejtve.`

export const IDOPONT_HIBA_CIM = 'Most nem sikerült megnézni, hol látszik'
export const IDOPONT_HIBA_SZOVEG = `Az űrlap azokon a közzétett oldalakon látszik, ahol ${IDOPONT_SZEKCIO_NEV} szekció áll bekapcsolt „${IDOPONT_URLAP_KAPCSOLO}” pipával. A pontos helyért frissítsd az oldalt.`

export const KAPCSOLAT_CIM = 'Ezt az űrlapot a weboldal most sehol nem használja'
export const KAPCSOLAT_SZOVEG = 'Ha törlöd, a rendszer a következő indításkor újra létrehozza.'

export const EGYEB_CIM = 'Ezt az űrlapot a weboldal nem használja'
export const EGYEB_SZOVEG = `A weboldalon csak az „${APPOINTMENT_FORM_TITLE}” és a „${NEWSLETTER_FORM_TITLE}” nevű űrlap jelenik meg.`

function Doboz({
  cim,
  szoveg,
  figyelem = false,
  children,
}: {
  cim: string
  szoveg: string
  figyelem?: boolean
  children?: JSX.Element | null
}): JSX.Element {
  return (
    <div className={figyelem ? 'kc-admin-notice kc-admin-notice--figyelem' : 'kc-admin-notice'}>
      <p className="kc-admin-notice__cim">{cim}</p>
      <p className="kc-admin-notice__szoveg">{szoveg}</p>
      {children ?? null}
    </div>
  )
}

/** Megjelenítés (tiszta, a render-teszt ezt hívja közvetlenül). */
export function FormBindingNoticeView({ model }: { model: UrlapKotesModel }): JSX.Element {
  switch (model.fajta) {
    case 'hirlevel':
      return <Doboz cim={HIRLEVEL_CIM} szoveg={HIRLEVEL_SZOVEG} />
    case 'kapcsolat':
      return <Doboz cim={KAPCSOLAT_CIM} szoveg={KAPCSOLAT_SZOVEG} />
    case 'egyeb':
      return <Doboz cim={EGYEB_CIM} szoveg={EGYEB_SZOVEG} />
    case 'idopont':
      if (model.helyek === null) {
        return <Doboz cim={IDOPONT_HIBA_CIM} szoveg={IDOPONT_HIBA_SZOVEG} />
      }
      if (model.helyek.length === 0) {
        return <Doboz cim={IDOPONT_NINCS_CIM} figyelem szoveg={IDOPONT_NINCS_SZOVEG} />
      }
      return (
        <Doboz cim={idopontCim(model.helyek)} szoveg={IDOPONT_SZOVEG}>
          <ul className="kc-admin-notice__linkek">
            {model.helyek.map((hely) => (
              <li key={hely.href}>
                <a href={hely.href}>{idopontLinkFelirat(hely)}</a>
              </li>
            ))}
          </ul>
        </Doboz>
      )
  }
}

export async function FormBindingNotice({
  data,
  payload,
  user,
}: FormBindingNoticeProps): Promise<JSX.Element> {
  const fajta = urlapFajta(isRekord(data) ? data.title : undefined)
  if (fajta !== 'idopont') {
    return <FormBindingNoticeView model={{ fajta }} />
  }
  const helyek =
    payload === undefined
      ? null
      : await idopontHelyekBetoltese(
          payload,
          user ?? null,
          payload.config?.routes?.admin ?? '/admin',
        )
  return <FormBindingNoticeView model={{ fajta, helyek }} />
}

export default FormBindingNotice
