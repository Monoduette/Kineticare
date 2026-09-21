'use client'

import Link from 'next/link'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'

import { Button } from '@/components/ui/Button'
import { ctaLabel, ctaProgressLabel } from '@/lib/cta-vocabulary'

import {
  hianyzikAMiTortent,
  kuldVisszajelzest,
  olvassAnalitikaAzonositot,
  type VisszajelzesKuldo,
} from './visszajelzes-kuldes'
import {
  KAPCSOLAT_UTVONAL,
  VISSZAJELZES_BEVEZETO,
  VISSZAJELZES_CIM,
  VISSZAJELZES_HIBA,
  VISSZAJELZES_KULDES_ALLAPOT,
  VISSZAJELZES_MI_TORTENT_CIMKE,
  VISSZAJELZES_MI_TORTENT_HIBA,
  VISSZAJELZES_MI_TORTENT_SUGO,
  VISSZAJELZES_MIT_CSINALTAL_CIMKE,
  VISSZAJELZES_SIKER_CIM,
  VISSZAJELZES_SIKER_SZOVEG,
  VISSZAJELZES_VALASZ_INFO,
} from './visszajelzes-szoveg'

/**
 * FeedbackDialog (WP65) — a vevői hibajelző doboz.
 *
 * MIÉRT NATÍV `<dialog>` + `showModal()`, ÉS MIÉRT NINCS LEBEGŐ GOMB.
 * A nézetablak alja nálunk FOGLALT: ott ül a süti-sáv (`z-index: 1000`, a
 * magassága a `--kc-consent-offset` tokenbe mérve) és a kurzusoldal ragadós
 * vásárlósávja (`z-index: 40`), amelynek stíluslapja egy MÉRT éles hibát
 * dokumentál: a süti-sáv 390x844, 360x640 és 768x1024 méreten TELJESEN
 * eltakarta a vásárlósávot (`src/app/(frontend)/kurzusok/kurzusok.css`
 * 1150-1165. sor). Egy harmadik, állandóan lebegő elem ugyanebbe a hibába
 * futna, és a WCAG 2.2 SC 2.4.11 (Focus Not Obscured, Minimum) is pontosan
 * ezt nevezi meg: „A notification implemented as sticky content, such as a
 * cookie banner, will fail this success criterion if it entirely obscures a
 * component receiving focus."
 * https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html
 * A natív modális dialógus ezt a kérdést megszünteti: a böngésző TOP LAYER
 * rétegére kerül, tehát z-indexre nincs is szüksége, és semmilyen ragadós
 * sáv nem takarhatja el.
 *
 * A MINTA. A repó saját, működő példája a
 * `src/components/admin/BunnyVideoDialog.tsx`: `showModal()` a mountkor,
 * `cancel` esemény az Escape-re, a fókusz visszaadása a hívó elemnek a
 * leszereléskor. Az APG dialógus-mintájából amit teljesítünk: a konténer
 * `role="dialog"` szerepű (a natív `<dialog>` ezt implicit hozza), a nevét
 * `aria-labelledby` adja a LÁTHATÓ címsorról, nyitáskor a fókusz a
 * dialóguson BELÜLRE kerül, az Escape zár, záráskor pedig a fókusz
 * visszamegy a megnyitó gombra.
 * https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
 *
 * TAB-CSAPDÁT NEM ÍRUNK. A `showModal()` a dialóguson KÍVÜLI dokumentumot
 * inertté teszi (HTML Standard: „blocked by a modal dialog"), tehát a
 * billentyűzet-fókusz magától nem tud kiszökni. Kézi Tab-kezelés itt csak
 * párhuzamos logikát és saját hibalehetőséget adna.
 *
 * A HÁTTÉRRE KATTINTÁS SZÁNDÉKOSAN NEM ZÁR: a dobozban megírt, el nem
 * küldött szöveg egy félrekattintástól veszne el.
 */

export interface FeedbackDialogProps {
  /** A bezárást kérő visszahívás (Escape, bezáró gomb). */
  onClose: () => void
  /** A bejelentés helye: KIZÁRÓLAG útvonal, lekérdezés és domain nélkül. */
  oldal: string
  /** Injektálható hálózati hívó — a teszt így sosem megy ki a hálózatra. */
  kuldo?: VisszajelzesKuldo
}

type Allapot = 'urlap' | 'kuldes' | 'siker'

export function FeedbackDialog({ onClose, oldal, kuldo }: FeedbackDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const cimRef = useRef<HTMLHeadingElement>(null)
  const sikerCimRef = useRef<HTMLHeadingElement>(null)
  const hibaRef = useRef<HTMLParagraphElement>(null)

  const azonosito = useId()
  const cimId = `${azonosito}-cim`
  const sikerCimId = `${azonosito}-siker`
  const mitCsinaltalId = `${azonosito}-mit`
  const miTortentId = `${azonosito}-tortent`
  const miTortentSugoId = `${miTortentId}-hint`
  const miTortentHibaId = `${miTortentId}-error`
  const allapotId = `${azonosito}-allapot`

  const [mitCsinaltal, setMitCsinaltal] = useState('')
  const [miTortent, setMiTortent] = useState('')
  const [weboldal, setWeboldal] = useState('')
  const [mezoHiba, setMezoHiba] = useState<string | null>(null)
  const [kuldesiHiba, setKuldesiHiba] = useState<string | null>(null)
  const [allapot, setAllapot] = useState<Allapot>('urlap')

  /**
   * Nyitás és zárás.
   *
   * `useEffect` és nem `useLayoutEffect`: a `<dialog>` `open` attribútum
   * nélkül `display: none`, tehát kivillanás nincs, viszont a komponens
   * szerveren is renderelhető marad (a `useLayoutEffect` ott figyelmeztetne).
   * A leszereléskor a fókusz visszakerül arra az elemre, amelyik megnyitotta
   * a dialógust (APG: „When a dialog closes, focus returns to the element
   * that invoked the dialog").
   */
  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog === null) {
      return
    }
    const elozoFokusz = document.activeElement
    dialog.showModal()
    // A fókusz a LÁTHATÓ címsorra megy, nem rögtön az első mezőbe: így a
    // képernyőolvasó felolvassa a doboz nevét és a felvezetőt, mielőtt a
    // látogató gépelni kezdene (APG: „focus moves to an element inside").
    cimRef.current?.focus()
    return () => {
      dialog.close()
      if (elozoFokusz instanceof HTMLElement && elozoFokusz.isConnected) {
        elozoFokusz.focus()
      }
    }
  }, [])

  /** Sikeres beküldés után a nyugta címsora kapja a fókuszt (ua., mint a ContactForm). */
  useEffect(() => {
    if (allapot === 'siker') {
      sikerCimRef.current?.focus()
    }
  }, [allapot])

  /**
   * SIKERTELEN beküldés után a fókusz a hibadobozra megy.
   *
   * MIÉRT KÖTELEZŐ. A küldés idejére a beküldő gomb `disabled`, a letiltott
   * elem pedig ELVESZTI a fókuszt: visszatéréskor a billentyűzetes látogató
   * a dialógus tetején találná magát, a hibaüzenetről pedig semmit nem tudna.
   * A hibadoboz `tabIndex={-1}` + programozott fókusz megoldása a
   * kapcsolat-űrlapé (`ContactForm.tsx` errorSummaryRef).
   * A begépelt szöveg ilyenkor VÁLTOZATLANUL az űrlapon marad: a mezők
   * állapotát a hibaág nem nullázza, tehát a bejelentés újraküldhető
   * anélkül, hogy a látogatónak újra kellene írnia (NN/g, Error-Message
   * Guidelines: „Preserve as much as the user has already typed").
   */
  useEffect(() => {
    if (kuldesiHiba !== null) {
      hibaRef.current?.focus()
    }
  }, [kuldesiHiba])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    setKuldesiHiba(null)

    if (hianyzikAMiTortent(miTortent)) {
      setMezoHiba(VISSZAJELZES_MI_TORTENT_HIBA)
      document.getElementById(miTortentId)?.focus()
      return
    }
    setMezoHiba(null)
    setAllapot('kuldes')

    const eredmeny = await kuldVisszajelzest(
      {
        mitCsinaltal: mitCsinaltal.trim(),
        miTortent: miTortent.trim(),
        oldal,
        weboldal,
        analitikaAzonosito: await olvassAnalitikaAzonositot(),
      },
      kuldo,
    )

    if (eredmeny.ok) {
      setAllapot('siker')
      return
    }
    setAllapot('urlap')
    setKuldesiHiba(eredmeny.uzenet.length > 0 ? eredmeny.uzenet : VISSZAJELZES_HIBA)
  }

  const kuldesFolyamatban = allapot === 'kuldes'

  return (
    <dialog
      aria-labelledby={allapot === 'siker' ? sikerCimId : cimId}
      className="kc-visszajelzes"
      onCancel={(event) => {
        // Escape: a natív zárás helyett a szülő állapotát írjuk át, így a
        // leszerelés (és vele a fókusz visszaadása) egyetlen úton fut.
        event.preventDefault()
        onClose()
      }}
      ref={dialogRef}
    >
      {allapot === 'siker' ? (
        <div aria-live="polite" className="kc-visszajelzes__torzs" role="status">
          <h2 className="kc-visszajelzes__cim" id={sikerCimId} ref={sikerCimRef} tabIndex={-1}>
            {VISSZAJELZES_SIKER_CIM}
          </h2>
          <p className="kc-visszajelzes__szoveg">{VISSZAJELZES_SIKER_SZOVEG}</p>
          <p className="kc-visszajelzes__szoveg">
            <Link className="kc-visszajelzes__link" href={KAPCSOLAT_UTVONAL}>
              {ctaLabel('contact-open')}
            </Link>
          </p>
          <div className="kc-visszajelzes__muveletek">
            <button className="kc-visszajelzes__bezar" onClick={onClose} type="button">
              {ctaLabel('feedback-close')}
            </button>
          </div>
        </div>
      ) : (
        <form className="kc-visszajelzes__torzs" noValidate onSubmit={handleSubmit}>
          <div className="kc-visszajelzes__fejlec">
            <h2 className="kc-visszajelzes__cim" id={cimId} ref={cimRef} tabIndex={-1}>
              {VISSZAJELZES_CIM}
            </h2>
            <button className="kc-visszajelzes__bezar" onClick={onClose} type="button">
              {ctaLabel('feedback-close')}
            </button>
          </div>

          <p className="kc-visszajelzes__szoveg">{VISSZAJELZES_BEVEZETO}</p>

          <div className="kc-field">
            <label className="kc-field__label" htmlFor={mitCsinaltalId}>
              {VISSZAJELZES_MIT_CSINALTAL_CIMKE}
            </label>
            <textarea
              className="kc-field__input kc-visszajelzes__mezo"
              disabled={kuldesFolyamatban}
              id={mitCsinaltalId}
              name="mitCsinaltal"
              onChange={(event) => setMitCsinaltal(event.target.value)}
              rows={3}
              value={mitCsinaltal}
            />
          </div>

          <div className="kc-field">
            <label className="kc-field__label" htmlFor={miTortentId}>
              {VISSZAJELZES_MI_TORTENT_CIMKE}{' '}
              <span aria-hidden="true" className="kc-field__required">
                *
              </span>
              <span className="kc-visually-hidden"> (kötelező)</span>
            </label>
            <textarea
              aria-describedby={
                mezoHiba === null ? miTortentSugoId : `${miTortentHibaId} ${miTortentSugoId}`
              }
              aria-invalid={mezoHiba === null ? undefined : true}
              className={[
                'kc-field__input',
                'kc-visszajelzes__mezo',
                mezoHiba === null ? '' : 'kc-field__input--error',
              ]
                .filter(Boolean)
                .join(' ')}
              disabled={kuldesFolyamatban}
              id={miTortentId}
              name="miTortent"
              onChange={(event) => setMiTortent(event.target.value)}
              required
              rows={4}
              value={miTortent}
            />
            {/* NN/g, Error-Message Guidelines: „Display the error message close
                to the error's source" — a hibaüzenet a mező ALATT áll, nem a
                doboz tetején.
                https://www.nngroup.com/articles/error-message-guidelines/ */}
            {mezoHiba === null ? null : (
              <p className="kc-field__error" id={miTortentHibaId} role="alert">
                {mezoHiba}
              </p>
            )}
            <p className="kc-field__hint" id={miTortentSugoId}>
              {VISSZAJELZES_MI_TORTENT_SUGO}
            </p>
          </div>

          {/* Csalétek-mező: emberi látogató sosem tölti ki (a képernyőolvasó
              elől `aria-hidden`, a Tab-sorrendből `tabIndex={-1}` veszi ki),
              a botok igen. Ugyanaz a minta, mint a kapcsolat-űrlapon. */}
          <div aria-hidden="true" className="kc-visszajelzes__csaletek">
            <label htmlFor={`${azonosito}-weboldal`}>Weboldal</label>
            <input
              autoComplete="off"
              id={`${azonosito}-weboldal`}
              name="weboldal"
              onChange={(event) => setWeboldal(event.target.value)}
              tabIndex={-1}
              type="text"
              value={weboldal}
            />
          </div>

          <p className="kc-visszajelzes__szoveg">
            {VISSZAJELZES_VALASZ_INFO}{' '}
            <Link className="kc-visszajelzes__link" href={KAPCSOLAT_UTVONAL}>
              {ctaLabel('contact-open')}
            </Link>
          </p>

          {kuldesiHiba === null ? null : (
            <p className="kc-visszajelzes__hiba" ref={hibaRef} role="alert" tabIndex={-1}>
              {kuldesiHiba}
            </p>
          )}

          <div className="kc-visszajelzes__muveletek">
            {/* A letiltott gomb mellett KÖTELEZŐ a szöveges magyarázat, hogy
                miért nem használható (docs/ui-sztenderdek.md gombállapot-tábla);
                itt ezt az élő állapot-régió adja, amit a képernyőolvasó is hall
                (WCAG 2.2 SC 4.1.3 Status Messages). */}
            <Button describedBy={allapotId} disabled={kuldesFolyamatban} type="submit">
              {kuldesFolyamatban
                ? ctaProgressLabel('feedback-submit')
                : ctaLabel('feedback-submit')}
            </Button>
          </div>

          <p aria-live="polite" className="kc-visszajelzes__allapot" id={allapotId} role="status">
            {kuldesFolyamatban ? VISSZAJELZES_KULDES_ALLAPOT : ''}
          </p>
        </form>
      )}
    </dialog>
  )
}
