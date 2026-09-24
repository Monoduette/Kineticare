import Link from 'next/link'
import type { Payload, Where } from 'payload'

import { hasOwnerRole, type RoleUser } from '../../access/roles'
import { formatAamLine, payloadAamFind, queryAamStatus, type AamStatus } from '../../lib/alerts/aam'
import {
  attentionDefinitions,
  attentionListHref,
  attentionTotal,
  countAttention,
  type AttentionCollection,
  type AttentionCounts,
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
  /** A SZAMLAZZ_AFAKULCS értéke; '27' mellett az AAM-sor kimarad. */
  vatMode?: string
}

interface Adatok {
  counts: AttentionCounts
  aam: AamStatus | null
  /** A számolás pillanata: a linkek feltételei is ehhez igazodnak. */
  nowMs: number
}

async function adatokBetoltese(props: FigyelmetIgenyelProps): Promise<Adatok> {
  const { payload, user } = props
  const nowMs = props.nowMs ?? Date.now()
  const count = async (collection: AttentionCollection, where: Where): Promise<number> => {
    const result = await payload.count({ collection, where, overrideAccess: false, user })
    return result.totalDocs
  }
  const vatMode = props.vatMode ?? process.env.SZAMLAZZ_AFAKULCS
  const [counts, aam] = await Promise.all([
    countAttention(count, nowMs),
    vatMode?.trim() === '27'
      ? Promise.resolve(null)
      : queryAamStatus(payloadAamFind(payload, { overrideAccess: false, user }), nowMs),
  ])
  return { counts, aam, nowMs }
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

  const { counts, aam, nowMs } = adatok
  const osszes = attentionTotal(counts)
  const adminRoute = props.payload.config.routes.admin
  const figyelem = osszes > 0 || (aam !== null && aam.level !== 'rendben')
  const tetelek = attentionDefinitions(nowMs).filter(
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
      {aam === null ? null : <AamSor aam={aam} />}
    </section>
  )
}

export default FigyelmetIgenyel
