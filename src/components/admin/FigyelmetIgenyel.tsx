import Link from 'next/link'
import type { Payload } from 'payload'

import { hasOwnerRole, type RoleUser } from '../../access/roles'
import {
  AAM_INCOMPLETE_ALERT_CODE,
  aamNeedsAttention,
  formatAamLine,
  formatAamUnavailableLine,
  payloadAamFind,
  readAamForDisplay,
  type AamReading,
  type AamStatus,
} from '../../lib/alerts/aam'
import { aamEstimateApplies } from '../../lib/alerts/aam-mode'
import {
  attentionListHref,
  attentionTotal,
  payloadAttentionSources,
  resolveAttention,
  type AttentionCounts,
  type AttentionDefinition,
} from '../../lib/alerts/attention'
import { logger } from '../../lib/logger'

/**
 * „Figyelmet igényel" blokk az Irányítópult tetején, CSAK a tulajdonosnak
 * (a-riasztas-9). Ugyanazokat a számokat mutatja, mint a reggeli napi
 * összesítő (`src/lib/alerts/attention.ts`), és minden szám a szűrt admin-
 * listára visz, amelyből jön. Csak olvas; séma és jogosultság nem változik.
 *
 * MIÉRT ITT ÉS ÍGY (források, megnyitva 2026-09-24):
 * - NN/g, Visibility of System Status: a rendszer „should always keep users
 *   informed about what is going on", és „Only by knowing what the current
 *   system status is can you change it". A beragadt pénz eddig öt külön
 *   szűrőből volt kikeresendő.
 *   https://www.nngroup.com/articles/visibility-system-status/
 * - GOV.UK Design System, Notification banner: „Use a notification banner to
 *   tell the user about something they need to know about", a lap tetején,
 *   és „Use notification banners sparingly". Ezért csak nem nulla teendőnél
 *   kap figyelem-dobozt; ha nincs teendő, egy csendes tájékoztató sor áll.
 *   https://design-system.service.gov.uk/components/notification-banner/
 * - WCAG 2.2 SC 1.4.1 Use of Color: a jelentést a címsor és a szöveg mondja
 *   ki, a szín kiegészítő. SC 2.4.4 Link Purpose: a link neve maga a szám és
 *   a kategória („2 fizetett rendelés számla nélkül"). SC 2.5.8 Target Size:
 *   a linkdoboz legalább 24 px magas. SC 1.4.10 Reflow: a doboz egyoszlopos,
 *   320 px-en sem görget vízszintesen.
 *
 * STÍLUS: a meglévő, mért `.kc-admin-notice` / `--figyelem` szerződés
 * (custom.scss, szöveg 12,08:1 és 13,88:1, határ 5,17:1 és 5,64:1 világos és
 * sötét témán, őr: admin-tema-kontraszt.test.ts), új szín nincs.
 *
 * JOGOSULTSÁG: a számolás a bejelentkezett tulajdonos jogaival fut
 * (`overrideAccess: false`), a blokk más szerepkörnek meg sem jelenik.
 *
 * HA A KERET NEM SZÁMOLHATÓ (PR #305, devin5): egyetlen ismeretlen összegű
 * tárgyévi számla vagy a lapozási korlát (`AamIncompleteError`) eddig az egész
 * blokkot a betöltési hibára cserélte, így a teendők sem látszottak. Most a
 * hiba csak az AAM-sor helyén áll, szám nélkül: a hiányzó érték sem 0, sem
 * „rendben”. A sor maga mondja meg a teendőt és a kézikönyv fejezetét, a
 * riasztáskóddal (devin5 rev1, breaker BRK-1): a riasztás-levél kieshet, és
 * címzett vagy e-mail-szolgáltató nélkül meg sem születik, így egy rá mutató
 * sor zsákutca volna. Csak a helyzet félkövér, a teendő nem, ahogy a számolt
 * sorban is (`AamSor`). A doboz ilyenkor figyelem-változatot kap, mert az
 * ismeretlen szint 70% fölött is lehet (`aamNeedsAttention`). Minden más hiba
 * (adatbázis, jogosultság) továbbra is a teljes betöltési hibát adja.
 * Források (megnyitva 2026-09-25):
 * - NN/g, Error-Message Guidelines: „Display the error message close to the
 *   error's source.”, és „Merely stating the problem is also not enough;
 *   offer some potential remedies.”
 *   https://www.nngroup.com/articles/error-message-guidelines/
 * - Cloudscape Design System (AWS), Errors, Contextualize errors: „Show an
 *   error alert where a component failed to render.”, és „provide error
 *   messages to users in the context of where the error occurred when
 *   possible, accounting for the scale and criticality of these errors.”
 *   https://cloudscape.design/patterns/general/errors/
 * - Agriculture Design System (az ausztrál mezőgazdasági minisztériumé),
 *   Error state: „Include the error code in the message if possible.” Ezért
 *   áll a mondatban a riasztáskód: a riasztási runbook táblázata ezzel
 *   kulcsol. https://design-system.agriculture.gov.au/patterns/loading-error-empty-states
 * - IBM Carbon, Notifications: „Provide users with the context and next steps
 *   needed to understand and address the notification”, és „Do not leave
 *   users without next steps.” Ezért áll a teendő magában a sorban.
 *   https://carbondesignsystem.com/patterns/notification-pattern/
 * - GOV.UK A to Z style guide, bold: „Use bold sparingly - using too much will
 *   make it difficult for users to know which parts of your content they need
 *   to pay the most attention to.”
 *   https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/style-guides/a-to-z-style-guide/
 */

export const FIGYELMET_IGENYEL_CIM = 'Figyelmet igényel'

export const NINCS_TEENDO_SZOVEG =
  'Most nincs teendő a fizetésekkel, a számlákkal és a visszatérítésekkel.'

export const BETOLTESI_HIBA_SZOVEG =
  'A teendők száma most nem tölthető be. Frissítsd az oldalt; ha így marad, szólj a fejlesztőnek.'

export const AAM_MEGJEGYZES =
  'A keretbe a vállalkozás minden belföldi bevétele beleszámít, ez a szám csak a webshop számláit látja.'

export interface FigyelmetIgenyelProps {
  payload: Pick<Payload, 'count' | 'find'> & { config: { routes: { admin: string } } }
  user?: RoleUser | null
  /** Injektálható óra (teszthez). */
  nowMs?: number
  /** A SZAMLAZZ_AFAKULCS értéke; az AAM-sor csak `AAM` mellett készül (`aamEstimateApplies`). */
  vatMode?: string
}

interface Adatok {
  counts: AttentionCounts
  /** A számokkal egy hívásban épült definíciók: a linkek feltételei ezekből jönnek. */
  definitions: readonly AttentionDefinition[]
  aam: AamReading | null
}

async function adatokBetoltese(props: FigyelmetIgenyelProps): Promise<Adatok> {
  const { payload, user } = props
  const nowMs = props.nowMs ?? Date.now()
  const vatMode = props.vatMode ?? process.env.SZAMLAZZ_AFAKULCS
  const [{ counts, definitions }, aam] = await Promise.all([
    resolveAttention(payloadAttentionSources(payload, { overrideAccess: false, user }), nowMs),
    // A nem számolható keret nem buktatja a blokkot (readAamForDisplay).
    aamEstimateApplies(vatMode)
      ? readAamForDisplay(payloadAamFind(payload, { overrideAccess: false, user }), nowMs)
      : Promise.resolve(null),
  ])
  return { counts, definitions, aam }
}

function AamSor({ aam }: { aam: AamStatus }) {
  const sor = `Alanyi adómentes keret, ${formatAamLine(aam)}.`
  const rendben = aam.level === 'rendben'
  return (
    <p className="kc-admin-notice__szoveg" data-aam-szint={aam.level}>
      {rendben ? sor : <strong>{sor}</strong>}{' '}
      {rendben ? null : 'Egyeztess a könyvelővel az áfakörbe lépésről. '}
      {AAM_MEGJEGYZES}
    </p>
  )
}

/**
 * A teendő szövege úgy, hogy a riasztáskód ne törjön el a kötőjeleinél, és
 * egyben látszódjon, ahogy a kézikönyv táblázatában áll. Mérve (devin5 rev1,
 * Chromium, valódi admin-stílusok): enélkül 1440 px-en a kód a sor végén
 * kettétört („aam-keret-nem-” és „teljes).”). A kód 20 karakter, 320 px-en
 * egy sor 34–41 karakter, így egyben is elfér, vízszintes görgetés nélkül. A
 * minta ugyanaz, mint az `OrderTotalCell`-ben.
 */
function TeendoToretlenKoddal({ teendo }: { teendo: string }) {
  const reszek = teendo.split(AAM_INCOMPLETE_ALERT_CODE)
  if (reszek.length !== 2) {
    return <>{teendo}</>
  }
  return (
    <>
      {reszek[0]}
      <span style={{ whiteSpace: 'nowrap' }}>{AAM_INCOMPLETE_ALERT_CODE}</span>
      {reszek[1]}
    </>
  )
}

/**
 * A keret most nem számolható: szám és szint helyett a helyzet (kiemelve) és
 * a teendő, ugyanúgy felépítve, mint a számolt sor (`AamSor`). Az
 * `AAM_MEGJEGYZES` itt nem áll, mert „ez a szám”-ra utal, szám pedig nincs.
 */
function AamNemSzamolhatoSor({ year }: { year: number }) {
  const sor = formatAamUnavailableLine(year)
  return (
    <p className="kc-admin-notice__szoveg" data-aam-szint="nem-szamolhato">
      <strong>{sor.allapot}</strong> <TeendoToretlenKoddal teendo={sor.teendo} />
    </p>
  )
}

function AamResz({ aam }: { aam: AamReading }) {
  return aam.kind === 'szamolt' ? (
    <AamSor aam={aam.status} />
  ) : (
    <AamNemSzamolhatoSor year={aam.year} />
  )
}

/**
 * A blokk. Szerver-komponens; a GyakoriTeendok panel hívja a kártyák elé.
 * Nem tulajdonosnak `null`.
 */
export async function FigyelmetIgenyel(props: FigyelmetIgenyelProps) {
  if (!hasOwnerRole(props.user)) {
    return null
  }
  let adatok: Adatok
  try {
    adatok = await adatokBetoltese(props)
  } catch (error) {
    logger.error('a Figyelmet igényel blokk nem tölthető be', {
      error: error instanceof Error ? error.message : String(error),
    })
    return (
      <section aria-labelledby="kc-figyelmet-cim" className="kc-admin-notice kc-figyelmet">
        <h2 className="kc-admin-notice__cim kc-figyelmet__cim" id="kc-figyelmet-cim">
          {FIGYELMET_IGENYEL_CIM}
        </h2>
        <p className="kc-admin-notice__szoveg">{BETOLTESI_HIBA_SZOVEG}</p>
      </section>
    )
  }

  const { counts, definitions, aam } = adatok
  const osszes = attentionTotal(counts)
  const adminRoute = props.payload.config.routes.admin
  const figyelem = osszes > 0 || aamNeedsAttention(aam)
  const tetelek = definitions.filter(
    (definicio) => definicio.reszhalmaz !== true && counts[definicio.key] > 0,
  )

  return (
    <section
      aria-labelledby="kc-figyelmet-cim"
      className={
        figyelem
          ? 'kc-admin-notice kc-admin-notice--figyelem kc-figyelmet'
          : 'kc-admin-notice kc-figyelmet'
      }
      data-teendo={osszes}
    >
      <h2 className="kc-admin-notice__cim kc-figyelmet__cim" id="kc-figyelmet-cim">
        {FIGYELMET_IGENYEL_CIM}
      </h2>
      {osszes === 0 ? (
        <p className="kc-admin-notice__szoveg">{NINCS_TEENDO_SZOVEG}</p>
      ) : (
        <>
          <p className="kc-admin-notice__szoveg">
            {`${osszes.toLocaleString('hu-HU')} ügy vár rád. A számra kattintva megnyílik a szűrt lista.`}
          </p>
          <ul className="kc-admin-notice__linkek kc-figyelmet__lista">
            {tetelek.map((definicio) => {
              const leirasId = `kc-figyelmet-${definicio.key}`
              const reszhalmaz =
                definicio.key === 'fuggoFizetes' && counts.fuggoFizetesRegi > 0
                  ? ` (ebből ${counts.fuggoFizetesRegi.toLocaleString('hu-HU')} egy napnál régebbi)`
                  : ''
              return (
                <li className="kc-figyelmet__elem" key={definicio.key}>
                  <Link
                    aria-describedby={leirasId}
                    href={attentionListHref(adminRoute, definicio.collection, definicio.where)}
                    prefetch={false}
                  >
                    {`${counts[definicio.key].toLocaleString('hu-HU')} ${definicio.label}`}
                  </Link>
                  {reszhalmaz}
                  <span className="kc-figyelmet__leiras" id={leirasId}>
                    {definicio.teendo}
                  </span>
                </li>
              )
            })}
          </ul>
        </>
      )}
      {aam === null ? null : <AamResz aam={aam} />}
    </section>
  )
}

export default FigyelmetIgenyel
