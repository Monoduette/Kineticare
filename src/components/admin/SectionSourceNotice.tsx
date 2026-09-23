'use client'

import { useConfig, useDocumentInfo, useFormFields } from '@payloadcms/ui'
import type { JSX } from 'react'

import {
  CMS_KOTOTT_CIM,
  KOTOTT_CIM,
  LAP_TETEJE_MAGYARAZAT,
  MEGNEZEM_FELIRAT,
  REJTETT_CIM,
  REJTETT_MAGYARAZAT,
  hiddenHint,
  sectionNoticeModel,
  type SectionNoticeModel,
} from '../../lib/section-row-label'
import { helybenUgras } from './helyben-ugras'
import { useSiblingRows } from './SectionRowLabel'

import './section-row-label.css'

/**
 * A szekció tetején álló rövid tájékoztató (`type: 'ui'` mező, adatbázis-oszlop
 * nélkül; a blocks/index.ts teszi minden oldalblokk ELSŐ mezőjévé).
 *
 * Ezeket mondja ki, mindegyiket csak akkor, ha igaz:
 * - „Megnézem az oldalon (új lapon)”: a szekcióra ugrik a piszkozat-előnézetben
 *   (a `#szekcio-<blokk-azonosító>` horgonyra, lásd sectionViewLink); a „lap
 *   tetején nyílik meg” mondat csak az azonosító nélküli sornál áll, ahol ez
 *   igaz;
 * - más gyűjteményből vagy automatikusan töltődő szekciónál a forrás, és
 *   „Ugrás oda, ahol szerkeszted: <hely>” link a pontos admin-listára; a
 *   Kapcsolat oldalon azt, ami ott valóban látszik (sectionSource). A
 *   Véleményeknél egy külön, legfeljebb kétmondatos bekezdés azt is
 *   megmondja, hol látszik még ugyanez (`holLatszik`, H30, H43/5): külön
 *   bekezdés, hogy egyik bekezdés se nőjön két mondat fölé;
 * - kódhoz kötött ugrópontnál, hogy mi visz ide, és mi történik átnevezéskor
 *   (kotottUgropont, modul-térkép H48). Az átnevezés tipikus csúszás: NN/g,
 *   Preventing User Errors: Avoiding Unconscious Slips: „Slips occur when
 *   users intend to perform one action, but end up doing another (often
 *   similar) action.”, és „it's even better to prevent users from making
 *   errors in the first place” (https://www.nngroup.com/articles/slips/). A
 *   következményt a mező mellett mondjuk ki, mert NN/g, Visibility of System
 *   Status: „no action with consequences to users should be taken without
 *   informing them” (https://www.nngroup.com/articles/visibility-system-status/);
 * - CMS-linkekkel kötött ugrópontnál (a /rolunk „szakmai-hatter”), hogy
 *   mely linkek visznek ide, és mit kell velük átnevezéskor tenni
 *   (cmsKotottUgropont, modul-térkép H48/3), a kötött mondat mintájára;
 * - rejtett szekciónál a link HELYETT, hogy a lapon nem látszik, és ha van
 *   látható ikre, egy link rá („A látható párja: 02 · <cím>”, H02). A link
 *   ugyanazt a szerkesztőt nyitja az iker szekciójánál (`?szekcio=`), újra-
 *   töltés nélkül (helyben-ugras.ts), hogy a félbehagyott gépelés megmaradjon.
 *   A link a mondat UTÁN, külön sorban áll, és a célját a szövege mondja ki
 *   (WCAG 2.2 SC 2.4.4 Link Purpose (In Context),
 *   https://www.w3.org/WAI/WCAG22/Understanding/link-purpose-in-context.html;
 *   GOV.UK Design System, Links: „Write link text that makes sense out of
 *   context”, https://design-system.service.gov.uk/styles/links/).
 *
 * A doboz statikus szöveg: nincs `role="alert"` (mountkor nem szól be), és
 * legfeljebb két rövid mondat. GOV.UK Design System, Inset text: „Use inset
 * text very sparingly - it's less effective if it's overused.”
 * (https://design-system.service.gov.uk/components/inset-text/), ezért a sima
 * szekciókon csak egy linksor áll, keret nélkül. A „Megnézem” új lapon nyílik,
 * mert a szerkesztő a lapot a szerkesztője mellett nézi (NN/g, Opening Links
 * in New Browser Windows and Tabs: az új lap indokolt a „Comparing content
 * across browser tabs or windows” helyzetben, például előnézet a szerkesztő
 * mellett), és ezt a látható szöveg előre jelzi („Use contextual messaging …
 * to let users know about it before they click.”,
 * https://www.nngroup.com/articles/new-browser-windows-and-tabs/). A link célját
 * a szövege, az előtte álló mondat és a sor `h3` címsora együtt adja meg
 * (WCAG 2.2 SC 2.4.4, W3C H80:
 * https://www.w3.org/WAI/WCAG22/Techniques/html/H80).
 */

interface SectionSourceNoticeProps {
  /** A UI-mező útvonala, pl. `layout.3.szekcioForrasJelzes` (a Payload adja). */
  path?: string
}

/** A UI-mező útvonalából a blokk útvonala és sorindexe. */
function blockPathOf(path: string): { blockPath: string; rowIndex: number } {
  const blockPath = path.slice(0, Math.max(0, path.lastIndexOf('.')))
  const rowIndex = Number(blockPath.slice(blockPath.lastIndexOf('.') + 1))
  return { blockPath, rowIndex: Number.isInteger(rowIndex) && rowIndex >= 0 ? rowIndex : 0 }
}

function Linkek({ model }: { model: SectionNoticeModel }): JSX.Element | null {
  if (!model.ugras && !model.megnezem) {
    return null
  }
  return (
    <ul className="kc-admin-notice__linkek">
      {model.ugras ? (
        <li>
          <a href={model.ugras.href}>{model.ugras.felirat}</a>
        </li>
      ) : null}
      {model.megnezem ? (
        <li>
          <a href={model.megnezem.href} rel="noopener" target="_blank">
            {MEGNEZEM_FELIRAT}
          </a>
          {model.megnezem.mode === 'lap' ? <span> {LAP_TETEJE_MAGYARAZAT}</span> : null}
        </li>
      ) : null}
    </ul>
  )
}

/** A tájékoztató megjelenítése (a render-teszt ezt hívja közvetlenül). */
export function SectionSourceNoticeView({
  model,
}: {
  model: SectionNoticeModel
}): JSX.Element | null {
  const kotott =
    model.kotott || model.cmsKotott ? (
      <>
        {model.kotott ? (
          <p className="kc-admin-notice__szoveg kc-section-source__kotott">{model.kotott}</p>
        ) : null}
        {model.cmsKotott ? (
          <p className="kc-admin-notice__szoveg kc-section-source__kotott">{model.cmsKotott}</p>
        ) : null}
      </>
    ) : null
  if (model.rejtett) {
    const iker = model.ikerLink ?? null
    return (
      <div className="kc-admin-notice kc-admin-notice--figyelem kc-section-source kc-section-source--rejtett">
        <p className="kc-admin-notice__cim">{REJTETT_CIM}</p>
        <p className="kc-admin-notice__szoveg">
          {REJTETT_MAGYARAZAT} {hiddenHint(model.iker)}
        </p>
        {iker ? (
          <p className="kc-admin-notice__szoveg kc-section-source__iker">
            {iker.href ? (
              <a href={iker.href} onClick={helybenUgras}>
                {iker.felirat}
              </a>
            ) : (
              iker.felirat
            )}
          </p>
        ) : null}
        {kotott}
        <Linkek model={model} />
      </div>
    )
  }
  if (model.forras) {
    return (
      <div className="kc-admin-notice kc-section-source">
        <p className="kc-admin-notice__cim">{model.forras.cim}</p>
        <p className="kc-admin-notice__szoveg">{model.forras.szoveg}</p>
        {model.forras.holLatszik ? (
          <p className="kc-admin-notice__szoveg kc-section-source__hol">
            {model.forras.holLatszik}
          </p>
        ) : null}
        {kotott}
        <Linkek model={model} />
      </div>
    )
  }
  if (kotott) {
    return (
      <div className="kc-admin-notice kc-section-source">
        <p className="kc-admin-notice__cim">{model.kotott ? KOTOTT_CIM : CMS_KOTOTT_CIM}</p>
        {kotott}
        <Linkek model={model} />
      </div>
    )
  }
  if (!model.megnezem) {
    return null
  }
  return (
    <div className="kc-section-source kc-section-source--csak-link">
      <Linkek model={model} />
    </div>
  )
}

export function SectionSourceNotice({ path = '' }: SectionSourceNoticeProps): JSX.Element | null {
  const { config } = useConfig()
  const { collectionSlug, id: docId } = useDocumentInfo()
  const pageSlug = useFormFields(([fields]) => fields?.slug?.value)
  const { blockPath, rowIndex } = blockPathOf(path)
  const siblings = useSiblingRows(blockPath)
  if (collectionSlug !== 'pages' || blockPath.length === 0) {
    return null
  }
  const model = sectionNoticeModel({
    data: siblings[rowIndex],
    pageSlug,
    rowIndex,
    siblings,
    adminRoute: config.routes.admin,
    docId,
  })
  return <SectionSourceNoticeView model={model} />
}
