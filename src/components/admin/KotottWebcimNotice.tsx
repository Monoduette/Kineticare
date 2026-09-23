'use client'

import {
  Button,
  useConfig,
  useDocumentInfo,
  useForm,
  useFormFields,
  useTranslation,
} from '@payloadcms/ui'
import { useEffect, useState, type CSSProperties, type JSX } from 'react'

import { kotottWebcim, nevelo, type KotottWebcim } from '../../lib/admin/kotott-cimek'

/**
 * Figyelmeztetés a kódhoz kötött webcím átírására (modul-térkép H48), az
 * oldalsávban, közvetlenül a Webcím mező alatt (Oldalak, Blogbejegyzések).
 *
 * Miért kell: a kezdőlap, a Kapcsolat, a jogi oldalak és a Tudástár-hubok
 * webcímére a weboldal kódja épít (src/lib/admin/kotott-cimek.ts), és az
 * átírásuk közzététel után linkeket tör el. A Payload semmit nem jelez. NN/g,
 * Visibility of System Status: „No action with consequences to users should
 * be taken without informing them.”
 * (https://www.nngroup.com/articles/visibility-system-status/); NN/g,
 * Preventing User Errors: „Presenting subtle, contextual error warnings while
 * a user is actively making an error can help them to quickly correct it.”
 * (https://www.nngroup.com/articles/user-mistakes/). A GOV.UK Warning text
 * mintája: „Use the warning text component when you need to warn users about
 * something important, such as legal consequences of an action”
 * (https://design-system.service.gov.uk/components/warning-text/). A
 * figyelmeztetés nem blokkol (a validációs szabály a FŐ VEZETŐ döntése); a
 * „Visszaállítom” gomb a visszautat adja (WCAG 2.2 SC 3.3.4 Error Prevention,
 * „Reversible”, https://www.w3.org/WAI/WCAG22/Understanding/error-prevention-legal-financial-data.html).
 *
 * A viszonyítási alap a fő dokumentum webcíme (REST, `draft=false`), nem az
 * űrlap kezdőértéke: az automatikus mentés csak piszkozatot ír, a fő
 * dokumentum (és a nyilvános lap) a közzétételig a régi webcímen marad
 * (payload/dist/collections/operations/utilities/update.js:
 * `if (!isSavingDraft) { … db.updateOne`). Így a figyelmeztetés akkor sem
 * tűnik el, ha az átírt webcím piszkozatként már elmentődött, vagy ha a
 * szerkesztő egy korábbi munkamenet piszkozatát nyitja meg.
 *
 * Akadálymentesség: az állapotváltozást egy mountkor üres, udvarias élő
 * régió mondja be, egyszer (aria-live="polite", role="alert" nélkül; WCAG
 * 2.2 SC 4.1.3 Status Messages,
 * https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html). A gomb
 * látható felirata igés, és a neve azzal kezdődik (SC 2.5.3 Label in Name).
 * A visszaállítás után a fókusz a Webcím mezőre kerül, hogy ne vesszen el
 * (a gomb eltűnik). A jelentést a szöveg mondja ki, a szín csak kiegészítő
 * (SC 1.4.1); stílus: a B1 `.kc-admin-notice` szerződése, saját szín nélkül.
 */

export type WebcimAllapot = 'nincs' | 'kotott' | 'atirva'

/** A figyelmeztetés állapota a mentett (fő dokumentum) és az űrlapbeli webcímből. */
export function webcimAllapot(
  gyujtemeny: unknown,
  mentett: unknown,
  urlapban: unknown,
): WebcimAllapot {
  if (kotottWebcim(gyujtemeny, mentett) === null) return 'nincs'
  const a = typeof mentett === 'string' ? mentett.trim() : ''
  const b = typeof urlapban === 'string' ? urlapban.trim() : ''
  return a === b ? 'kotott' : 'atirva'
}

export interface WebcimSzoveg {
  cim: string
  bekezdesek: string[]
}

export const NE_IRD_AT = 'A weboldal kódja erre a webcímre épít, ne írd át.'

/** A mentett, kötött webcím nyugalmi szövege. */
export function kotottSzoveg(kotes: KotottWebcim): WebcimSzoveg {
  return { cim: NE_IRD_AT, bekezdesek: [...kotes.mire] }
}

/** Az átírt webcím figyelmeztetése: mi épít rá, mi lesz közzététel után, és hogy még nem késő. */
export function atirtSzoveg(
  kotes: KotottWebcim,
  mentett: string,
  kozzeteszGomb: string,
): WebcimSzoveg {
  return {
    cim: `Átírtad a webcímet, pedig a weboldal kódja ${nevelo(mentett)} „${mentett}” webcímre épít.`,
    bekezdesek: [
      ...kotes.mire,
      ...kotes.kovetkezmeny,
      `Az automatikus mentés csak piszkozatot ír: a weboldal a „${kozzeteszGomb}” gombig a régi webcímet használja.`,
    ],
  }
}

export function visszaallitoGombFelirat(mentett: string): string {
  return `Visszaállítom ${nevelo(mentett)} „${mentett}” webcímet`
}

export function visszaallitvaBejelentes(mentett: string): string {
  return `A webcím újra „${mentett}”.`
}

/**
 * Mit mondjon be az élő régió egy állapotváltáskor: átíráskor a
 * figyelmeztetés címét, visszaállításkor a megerősítést; mountkor és minden
 * más váltáskor semmit (null).
 */
export function bejelentesValtozaskor(
  volt: WebcimAllapot | null,
  lett: WebcimAllapot,
  gyujtemeny: unknown,
  mentett: string | null,
  kozzeteszGomb: string,
): string | null {
  if (volt === null || volt === lett || mentett === null) return null
  if (lett === 'atirva') {
    const kotes = kotottWebcim(gyujtemeny, mentett)
    return kotes ? atirtSzoveg(kotes, mentett, kozzeteszGomb).cim : null
  }
  if (volt === 'atirva' && lett === 'kotott') return visszaallitvaBejelentes(mentett)
  return null
}

/** Láthatatlan, de felolvasható élő régió (a szokásos „visually hidden” minta). */
const REJTETT: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  margin: -1,
  padding: 0,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
}

/** A gomb a bekezdésektől ugyanakkora térközzel áll, mint a bekezdések egymástól. */
const GOMB_TERKOZ: CSSProperties = { marginTop: '0.5em' }

export interface KotottWebcimNoticeViewProps {
  gyujtemeny: unknown
  mentett: string | null
  urlapban: unknown
  kozzeteszGomb: string
  bejelentes: string
  onVisszaallit: () => void
}

export function KotottWebcimNoticeView({
  gyujtemeny,
  mentett,
  urlapban,
  kozzeteszGomb,
  bejelentes,
  onVisszaallit,
}: KotottWebcimNoticeViewProps): JSX.Element {
  const kotes = mentett === null ? null : kotottWebcim(gyujtemeny, mentett)
  const allapot = webcimAllapot(gyujtemeny, mentett, urlapban)
  const elo = (
    <p aria-live="polite" className="kc-kotott-webcim__bejelentes" style={REJTETT}>
      {bejelentes}
    </p>
  )
  if (kotes === null || mentett === null || allapot === 'nincs') {
    // Az élő régió akkor is a DOM-ban marad, ha épp nincs mit mutatni: így a
    // bejelentés nem egy frissen beszúrt régióban hangzik el (SC 4.1.3).
    return <div className="kc-kotott-webcim">{elo}</div>
  }
  const szoveg =
    allapot === 'atirva' ? atirtSzoveg(kotes, mentett, kozzeteszGomb) : kotottSzoveg(kotes)
  return (
    <div className="kc-kotott-webcim">
      <div
        className={`kc-admin-notice${allapot === 'atirva' ? ' kc-admin-notice--figyelem' : ''}`}
        data-allapot={allapot}
      >
        <p className="kc-admin-notice__cim">{szoveg.cim}</p>
        {szoveg.bekezdesek.map((bekezdes) => (
          <p className="kc-admin-notice__szoveg" key={bekezdes}>
            {bekezdes}
          </p>
        ))}
        {allapot === 'atirva' ? (
          <div style={GOMB_TERKOZ}>
            <Button
              buttonStyle="secondary"
              className="kc-kotott-webcim__gomb"
              margin={false}
              onClick={onVisszaallit}
              size="small"
              type="button"
            >
              {visszaallitoGombFelirat(mentett)}
            </Button>
          </div>
        ) : null}
      </div>
      {elo}
    </div>
  )
}

interface MentettWebcim {
  kulcs: string
  webcim: string | null
}

export function KotottWebcimNotice(): JSX.Element | null {
  const {
    id,
    collectionSlug,
    hasPublishedDoc,
    unpublishedVersionCount,
    versionCount,
    lastUpdateTime,
  } = useDocumentInfo()
  const { config } = useConfig()
  const { t } = useTranslation()
  const { setModified } = useForm()
  const urlapban = useFormFields(([fields]) => fields?.slug?.value)
  const kezdoErtek = useFormFields(([fields]) => fields?.slug?.initialValue)
  const dispatch = useFormFields(([, dispatchFields]) => dispatchFields)
  const kozzeteszGomb = t('version:publishChanges')

  // A fő dokumentum webcíme: minden mentés és közzététel után újra lekérjük
  // (a közzététel a fő dokumentumot is átírja, az automatikus mentés nem).
  const kulcs = `${collectionSlug ?? ''}/${String(id ?? '')}/${String(hasPublishedDoc)}/${unpublishedVersionCount}/${versionCount}/${lastUpdateTime}`
  const [fo, setFo] = useState<MentettWebcim | null>(null)
  useEffect(() => {
    if (id === undefined || id === null || !collectionSlug) return
    let aktiv = true
    const api = `${config.serverURL ?? ''}${config.routes.api}`
    const url = `${api}/${collectionSlug}/${encodeURIComponent(String(id))}?depth=0&draft=false&select[slug]=true`
    fetch(url, { credentials: 'include' })
      .then((valasz) => (valasz.ok ? valasz.json() : null))
      .then((adat: unknown) => {
        if (!aktiv) return
        const webcim =
          typeof adat === 'object' && adat !== null && 'slug' in adat
            ? (adat as { slug?: unknown }).slug
            : null
        setFo({ kulcs, webcim: typeof webcim === 'string' ? webcim : null })
      })
      .catch(() => {
        if (aktiv) setFo({ kulcs, webcim: null })
      })
    return () => {
      aktiv = false
    }
  }, [collectionSlug, config.routes.api, config.serverURL, id, kulcs])

  // Amíg a lekérdezés fut, az űrlap kezdőértéke a viszonyítás (a legtöbbször
  // ugyanaz, mint a fő dokumentumé).
  const mentett =
    fo !== null && fo.webcim !== null
      ? fo.webcim
      : typeof kezdoErtek === 'string'
        ? kezdoErtek
        : null
  const allapot = webcimAllapot(collectionSlug, mentett, urlapban)

  // Bejelentés csak állapotVÁLTOZÁSKOR, egyszer (mountkor nem). Az előző
  // állapotot state-ben tartjuk, és renderelés közben igazítunk (React: „Adjusting
  // some state when a prop changes”, https://react.dev/learn/you-might-not-need-an-effect),
  // így nincs effektből hívott setState és kaszkád-renderelés.
  const [bejelentes, setBejelentes] = useState('')
  const [elozoAllapot, setElozoAllapot] = useState<WebcimAllapot | null>(null)
  if (elozoAllapot !== allapot) {
    setElozoAllapot(allapot)
    const uj = bejelentesValtozaskor(elozoAllapot, allapot, collectionSlug, mentett, kozzeteszGomb)
    if (uj !== null) setBejelentes(uj)
  }

  if (id === undefined || id === null || !collectionSlug) return null

  const visszaallit = (): void => {
    if (mentett === null) return
    dispatch({ type: 'UPDATE', path: 'slug', value: mentett })
    setModified(true)
    // A gomb a visszaállítással eltűnik: a fókusz a Webcím mezőre kerül.
    window.requestAnimationFrame(() => {
      const mezo = document.getElementById('field-slug')
      if (mezo instanceof HTMLElement) mezo.focus()
    })
  }

  return (
    <KotottWebcimNoticeView
      bejelentes={bejelentes}
      gyujtemeny={collectionSlug}
      kozzeteszGomb={kozzeteszGomb}
      mentett={mentett}
      onVisszaallit={visszaallit}
      urlapban={urlapban}
    />
  )
}
