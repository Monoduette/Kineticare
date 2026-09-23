'use client'

import Link from 'next/link'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'

import { isMetaPixelConfigured } from '@/lib/analytics/meta-pixel'
import { sendBarionConsent } from '@/lib/analytics/barion-consent'
import {
  CONSENT_DENIED,
  CONSENT_EVENT,
  CONSENT_GRANTED,
  CONSENT_OPEN_EVENT,
  CONSENT_UNKNOWN,
  consentBannerVisible,
  consentSnapshotStale,
  consentSnapshotState,
  consentStateFromEvent,
  readConsent,
  readConsentSnapshot,
  type ConsentSnapshot,
  type ConsentState,
} from '@/lib/analytics/consent'
import { optInToAnalytics, optOutOfAnalytics } from '@/lib/analytics/posthog'
import { ctaLabel } from '@/lib/cta-vocabulary'

import '../../app/(frontend)/styles/consent-banner.css'

/**
 * ConsentBanner — GDPR-kompatibilis analytics-hozzájárulás sáv.
 * A stílus INLINE `style`-ból STÍLUSLAPRA költözött (styles/consent-banner.css),
 * Ezért NEM üresen jön vissza: a szöveg megmondja, mi a jelenlegi beállítás
 */

/** A dokumentumgyökér jelölése, amíg a sáv látszik (scroll-padding + térköz). */
const ROOT_CLASS = 'kc-has-consent-banner'
/** A sáv mért magassága — a stíluslap ebből számol (lásd consent-banner.css). */
const OFFSET_VAR = '--kc-consent-offset'

/**
 * A tárolt consent KÜLSŐ store-ként. A `kc:analytics-consent` esemény az
 * egyetlen írás-jelzés (az optIn/optOut szórja) — erre iratkozunk fel.
 */
function subscribeToConsent(onStoreChange: () => void): () => void {
  window.addEventListener(CONSENT_EVENT, onStoreChange)
  return () => window.removeEventListener(CONSENT_EVENT, onStoreChange)
}

/**
 * Kliens-pillanatkép: primitív string (`"<állapot>:<frissesség>"`), tehát
 * hivatkozás-stabil (nem ciklizál). A frissesség az újrakérdezési küszöbhöz
 * mért kor — ettől tér vissza a sáv magától.
 */
function getConsentSnapshot(): ConsentSnapshot {
  return readConsentSnapshot()
}

/**
 * Szerver- ÉS hidratálási pillanatkép: `null` = „még nem olvastuk a tárolót".
 * Ez tartja meg pontosan a korábbi viselkedést: a szerver és az első
 * kliens-render egyaránt semmit sem renderel, a tárolt érték csak a
 * hidratálás UTÁN kerül be — így a szerver- és kliens-HTML nem térhet el.
 */
function getServerConsentSnapshot(): ConsentSnapshot | null {
  return null
}

/**
 * A visszatérő sáv első mondata: mi a JELENLEGI beállítás, és miért kérdezünk
 * újra. Magázó hang, mert a sáv többi mondata is az (WCAG 3.2.4 — ugyanaz a
 * dolog ugyanúgy szólal meg); gondolatjel nélküli, natív magyar mondatok.
 * Döntés nélkül ('unknown') nincs mit mutatni — ilyenkor null.
 *
 * Azért EXPORTÁLT, mert így a szöveg viselkedése valódi teszttel őrizhető
 * (a repó tesztkörnyezete node, a sáv interakciója nem játszható le).
 */
export function jelenlegiBeallitasSzovege(
  consent: ConsentState | null,
  lejart: boolean,
): string | null {
  if (consent !== CONSENT_GRANTED && consent !== CONSENT_DENIED) {
    return null
  }
  const beallitas =
    consent === CONSENT_GRANTED ? 'elfogadta az analitikát' : 'elutasította az analitikát'
  if (lejart) {
    return `Jelenlegi beállítása: ${beallitas}. Évente egyszer rákérdezünk, hogy ez továbbra is így legyen.`
  }
  return `Jelenlegi beállítása: ${beallitas}. Alább módosíthatja.`
}

export function ConsentBanner() {
  // null = még nem olvastuk a tárolót (SSR + első kliens-render) → null render.
  const snapshot = useSyncExternalStore<ConsentSnapshot | null>(
    subscribeToConsent,
    getConsentSnapshot,
    getServerConsentSnapshot,
  )
  const storedConsent: ConsentState | null =
    snapshot === null ? null : consentSnapshotState(snapshot)
  // Lejárt-e a tárolt döntés (kötelező időszakos újrakérdezés).
  const stale = snapshot !== null && consentSnapshotStale(snapshot)
  // A gombnyomás helyi döntése akkor is elrejti a sávot, ha a tárolóba írás
  // nem sikerült (letiltott localStorage) — a korábbi setConsent pontosan így
  // viselkedett, ezért marad meg külön állapotként.
  const [decision, setDecision] = useState<ConsentState | null>(null)
  // A footer „Süti-beállítások" gombjára történő újranyitás (GDPR visszavonási
  // út): döntés után is újra látható a sáv, amíg a látogató újra nem dönt.
  const [reopened, setReopened] = useState(false)
  const consent = decision ?? storedConsent
  const bannerRef = useRef<HTMLDivElement>(null)
  // A lejárat CSAK addig nyitja a sávot, amíg a látogató most nem döntött:
  // egy friss gombnyomás után a sávnak akkor is el kell tűnnie, ha a tárolóba
  // írás nem sikerült (letiltott localStorage → a pillanatkép lejárt marad).
  const visible = consentBannerVisible(consent, reopened, decision === null && stale)

  /**
   * A sáv TÉNYLEGES magasságának mérése (2.4.11). Fix érték itt nem elég: a
   * sáv 1–3 sorosra tördel a nézetablaktól, a betűmérettől és a fordítás
   * hosszától függően. A ResizeObserver az ablakméret-váltást és a
   * betűméret-változást is lekezeli; ha a böngésző nem ismeri, egyetlen
   * kezdeti mérés marad (a `scroll-padding` így is jobb, mint a semmi).
   */
  useEffect(() => {
    const root = document.documentElement
    const banner = bannerRef.current
    if (!visible || banner === null) {
      root.classList.remove(ROOT_CLASS)
      root.style.removeProperty(OFFSET_VAR)
      return
    }
    const measure = (): void => {
      root.style.setProperty(OFFSET_VAR, `${Math.ceil(banner.getBoundingClientRect().height)}px`)
    }
    root.classList.add(ROOT_CLASS)
    measure()
    if (typeof ResizeObserver !== 'function') {
      return () => {
        root.classList.remove(ROOT_CLASS)
        root.style.removeProperty(OFFSET_VAR)
      }
    }
    const observer = new ResizeObserver(measure)
    observer.observe(banner)
    return () => {
      observer.disconnect()
      root.classList.remove(ROOT_CLASS)
      root.style.removeProperty(OFFSET_VAR)
    }
  }, [visible])

  /**
   * A Barion Pixel FELHASZNÁLÁSI hozzájárulásának jelzése — a
   * GoogleAnalytics.tsx mintája: betöltéskor a TÁROLT döntés megy ki, utána a
   * 'kc:analytics-consent' esemény kapcsol át (elfogadás, elutasítás és a
   * későbbi módosítás egyaránt ezen az egy úton fut). Döntés nélkül
   * ('unknown') semmi nem megy ki, azonosító nélkül szintén semmi.
   * A lemondó függvény a pixel megjelenésére váró újrapróbálkozást állítja le.
   */
  useEffect(() => {
    let cancelBarionConsent = sendBarionConsent(readConsent())
    const onConsent = (event: Event): void => {
      const state = consentStateFromEvent(event)
      cancelBarionConsent()
      cancelBarionConsent = sendBarionConsent(state === CONSENT_UNKNOWN ? readConsent() : state)
    }
    window.addEventListener(CONSENT_EVENT, onConsent)
    return () => {
      window.removeEventListener(CONSENT_EVENT, onConsent)
      cancelBarionConsent()
    }
  }, [])

  useEffect(() => {
    const onOpen = (): void => {
      // A korábbi helyi döntés-jelölést is töröljük, hogy a TÁROLT állapot
      // látszódjon kiindulásként, és a sáv biztosan megjelenjen.
      setDecision(null)
      setReopened(true)
    }
    window.addEventListener(CONSENT_OPEN_EVENT, onOpen)
    return () => window.removeEventListener(CONSENT_OPEN_EVENT, onOpen)
  }, [])

  if (!visible) {
    return null
  }

  // A visszatérő sávon a KORÁBBI beállítás is látszik (Barion-követelmény:
  // „az előzőleg mentett beállításokkal"); első látogatáskor ez null.
  const jelenlegiBeallitas = jelenlegiBeallitasSzovege(consent, stale)

  const onAccept = (): void => {
    optInToAnalytics()
    setDecision('granted')
    setReopened(false)
  }

  const onDecline = (): void => {
    optOutOfAnalytics()
    setDecision('denied')
    setReopened(false)
  }

  return (
    <div aria-label="Süti-hozzájárulás" className="kc-consent-banner" ref={bannerRef} role="region">
      <div className="kc-consent-banner__inner">
        <p className="kc-consent-banner__text">
          {jelenlegiBeallitas === null ? null : `${jelenlegiBeallitas} `}
          Sütiket használunk a felhasználói élmény javításához és a látogatottsági statisztikák
          készítéséhez
          {isMetaPixelConfigured()
            ? ', valamint a Facebook- és Instagram-hirdetéseink méréséhez (Meta Pixel)'
            : ''}
          . Az analitika csak a hozzájárulásával kapcsol be. Részletek az{' '}
          <Link href="/adatvedelem">adatvédelmi tájékoztatóban</Link>.
        </p>
        {/* A KÉT FELIRAT A SZÓTÁRBÓL (§3.2 #18, 2026-08-18). A korábbi
            „Elfogadom" nem mondta meg, MIRE vonatkozik az elfogadás (NN/g,
            Better Link Labels — „Substantial"), az „Elutasítom" pedig
            FÉLREVEZETETT: a működéshez szükséges sütik nem utasíthatók el, a
            gomb valójában „csak a szükségeseket" hagyja bekapcsolva.
            A két gomb SÚLYA változatlanul azonos (nem dark pattern). */}
        <div className="kc-consent-banner__actions">
          <button
            className="kc-consent-banner__button kc-consent-banner__button--accept"
            onClick={onAccept}
            type="button"
          >
            {ctaLabel('consent-accept-all')}
          </button>
          <button
            className="kc-consent-banner__button kc-consent-banner__button--decline"
            onClick={onDecline}
            type="button"
          >
            {ctaLabel('consent-essential-only')}
          </button>
        </div>
      </div>
    </div>
  )
}
