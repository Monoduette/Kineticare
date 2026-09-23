'use client'

import {
  Button,
  ExternalLinkIcon,
  useDocumentInfo,
  useFormBackgroundProcessing,
  useFormFields,
  useFormModified,
  useLivePreviewContext,
} from '@payloadcms/ui'
import { useEffect, useRef, type JSX, type MouseEvent } from 'react'

import {
  isPreviewCollection,
  PREVIEW_PATH,
  previewTargetPath,
} from '../../lib/preview/preview-target'

/**
 * Látható feliratú „Előnézet” gomb az Oldalak és a Blogbejegyzések
 * szerkesztőjében (a core felirat nélküli ikonja helyett,
 * `admin.components.edit.PreviewButton`).
 *
 * Miért így:
 * - A core gomb csak egy ikon. NN/g, Icon Usability: „A text label must be
 *   present alongside an icon to clarify its meaning”, és a felirat „should be
 *   visible at all times” (https://www.nngroup.com/articles/icon-usability/).
 *   A látható szó és az ikon ezért együtt áll.
 * - Új lapon nyílik, mert a szerkesztő a két lapot egymás mellett hasonlítja
 *   össze; ezt az NN/g kifejezetten az új lap jó esetének nevezi, azzal, hogy
 *   előre jelezni kell („use contextual messaging and perhaps even an icon”,
 *   https://www.nngroup.com/articles/new-browser-windows-and-tabs/). Jelzés: a
 *   kifelé mutató ikon, a hozzáférhető név és az egérrel megjelenő súgó.
 * - A hozzáférhető név a látható szóval KEZDŐDIK (WCAG 2.2 SC 2.5.3, „A best
 *   practice is to have the text of the label at the start of the name.”,
 *   https://www.w3.org/WAI/WCAG22/Understanding/label-in-name.html).
 * - A cél-URL a Payload saját előnézeti logikájából jön (a collection
 *   `admin.preview`-jából a szerver számolja, mentés után frissül; a
 *   `useLivePreviewContext` a 3.88-ban exportált hozzáférés ehhez). Tartalék: a
 *   `preview-target.ts` relatív útja az űrlap webcíméből, ugyanazzal a
 *   szűréssel, amit a /next/preview route is alkalmaz.
 * - A piszkozatot mutatja: az automatikus mentés 2 másodperces késleltetéssel
 *   ír, a Lexical-szerkesztő pedig a gépelést csak üresjáratban (legfeljebb
 *   ~500 ms) adja át az űrlapnak (@payloadcms/richtext-lexical Field.js
 *   runDeprioritized). Mérve: gépelés után azonnal kattintva a core link a
 *   korábbi állapotot nyitotta meg. Ezért ha friss a gépelés, vagy van
 *   mentetlen, illetve épp mentődő változás, a gomb az új lapot azonnal
 *   megnyitja egy rövid „mentés folyamatban” üzenettel, és csak a mentés után
 *   tölti be az előnézetet (legfeljebb MENTESRE_VAR_MS-ig). Módosító
 *   billentyűs vagy középső kattintásnál a böngésző natív útja marad.
 * - Ha a böngésző nem enged új lapot nyitni (window.open null), az előnézet
 *   ezen a lapon nyílik, de CSAK a mentés után: automatikus mentésnél a
 *   Payload nem kérdez rá a távozásra (@payloadcms/ui/dist/views/Edit/index.js:
 *   preventLeaveWithoutSaving = !autosaveEnabled), így az azonnali
 *   átnavigálás akár 2 másodpercnyi gépelést is elvinne. Ha a mentés
 *   MENTESRE_VAR_MS alatt sem ér véget, a gomb nem navigál szó nélkül: megkérdezi,
 *   és kimondja a következményt (NN/g, Error Prevention: „the best designs
 *   carefully prevent problems from occurring in the first place”,
 *   https://www.nngroup.com/articles/ten-usability-heuristics/; NN/g,
 *   Confirmation Dialogs: „Use a confirmation dialog before committing to
 *   actions with serious consequences — such as destroying users' work”,
 *   https://www.nngroup.com/articles/confirmation-dialog/).
 */

export const ELONEZET_FELIRAT = 'Előnézet'
export const ELONEZET_NEV = 'Előnézet (új lapon nyílik)'

/**
 * Ennyit vár legfeljebb az automatikus mentésre. Új lapnál a várakozás után
 * betölti az előnézetet; ha új lap nem nyílhat, és a mentés ennyi idő alatt
 * sem ér véget, ezen a lapon csak megerősítés után nyit (elonezetMegnyitasa).
 */
export const MENTESRE_VAR_MS = 10000

/** Ennyi időn belüli gépelés „friss”: az értéke még úton lehet az űrlap felé. */
export const FRISS_GEPELES_MS = 1500

export const VARAKOZO_SZOVEG = 'Mentés folyamatban, az előnézet pár másodperc múlva megnyílik…'

/** Ennyi időnként nézi meg újra, véget ért-e a mentés. */
export const VARAKOZAS_LEPES_MS = 250

/**
 * Csak akkor kérdez, ha új lap nem nyílhatott, és a mentés a várakozási időn
 * belül sem ért véget: ekkor az átnavigálás elvinné a mentetlen módosítást.
 */
export const MENTETLEN_KERDES =
  'A böngésző nem engedte új lapon megnyitni az előnézetet, ezért ezen a lapon nyílna meg. A legutóbbi módosításod még nem mentődött el, így elveszne. Megnyitod így is?'

/**
 * Kell-e várni a betöltéssel: friss gépelés, mentetlen vagy épp mentődő
 * változás mellett igen (tiszta függvény, a teszt ezt hívja).
 */
export function varniKell(
  most: number,
  utolsoGepeles: number,
  modositott: boolean,
  mentes: boolean,
): boolean {
  return modositott || mentes || most - utolsoGepeles < FRISS_GEPELES_MS
}

/**
 * Az előnézet címe: a Payload által számolt URL, ha van; különben a webcímből
 * képzett relatív út. Érvénytelen vagy üres webcímnél null (nincs gomb).
 */
export function elonezetHref(
  payloadUrl: unknown,
  collectionSlug: unknown,
  slug: unknown,
): string | null {
  if (typeof payloadUrl === 'string' && payloadUrl.trim().length > 0) {
    return payloadUrl
  }
  if (!isPreviewCollection(collectionSlug) || typeof slug !== 'string') {
    return null
  }
  if (previewTargetPath(collectionSlug, slug) === null) {
    return null
  }
  const params = new URLSearchParams({ collection: collectionSlug, slug: slug.trim() })
  return `${PREVIEW_PATH}?${params.toString()}`
}

/**
 * Megvárja, hogy a `kellVarni()` hamis legyen (legfeljebb MENTESRE_VAR_MS-ig),
 * aztán lefuttatja a `lepes`-t; a paramétere megmondja, végzett-e a mentés.
 */
export function mentesUtan(kellVarni: () => boolean, lepes: (mentve: boolean) => void): void {
  const started = Date.now()
  const wait = (): void => {
    const varni = kellVarni()
    if (varni && Date.now() - started < MENTESRE_VAR_MS) {
      window.setTimeout(wait, VARAKOZAS_LEPES_MS)
      return
    }
    lepes(!varni)
  }
  window.setTimeout(wait, VARAKOZAS_LEPES_MS)
}

/**
 * Az előnézet megnyitása, amikor a kattintás pillanatában még menteni kell.
 * Az új lapot MOST nyitja meg (így a böngésző nem tekinti kéretlen felugró
 * ablaknak), a címét a mentés után adja meg. Ha új lap nem nyílhat, ezen a
 * lapon nyit, de csak a mentés után, mentetlen módosítás mellett pedig csak
 * megerősítéssel.
 */
export function elonezetMegnyitasa(href: string, kellVarni: () => boolean): void {
  const tab = window.open('about:blank', '_blank')
  if (tab === null) {
    mentesUtan(kellVarni, (mentve) => {
      if (mentve || window.confirm(MENTETLEN_KERDES)) {
        window.location.assign(href)
      }
    })
    return
  }
  tab.opener = null
  try {
    tab.document.documentElement.lang = 'hu'
    tab.document.title = ELONEZET_FELIRAT
    tab.document.body.textContent = VARAKOZO_SZOVEG
  } catch {
    // Ha a böngésző nem engedi az üres lapot írni, az üzenet elmarad.
  }
  mentesUtan(kellVarni, () => {
    tab.location.href = href
  })
}

export function ElonezetGomb(): JSX.Element | null {
  const { id, collectionSlug } = useDocumentInfo()
  const { previewURL } = useLivePreviewContext()
  const slug = useFormFields(([fields]) => fields?.slug?.value)
  const modified = useFormModified()
  const saving = useFormBackgroundProcessing()

  // A kattintás utáni várakozás a legfrissebb állapotot olvassa, nem a
  // kattintáskorit.
  const pending = useRef({ modified, saving })
  useEffect(() => {
    pending.current = { modified, saving }
  }, [modified, saving])

  // Az utolsó gépelés ideje (a Lexical is `input` eseményt ad).
  const utolsoGepeles = useRef(0)
  useEffect(() => {
    const jegyez = (): void => {
      utolsoGepeles.current = Date.now()
    }
    document.addEventListener('input', jegyez, true)
    return () => document.removeEventListener('input', jegyez, true)
  }, [])

  const href = elonezetHref(previewURL, collectionSlug, slug)
  if (id === undefined || id === null || href === null) {
    return null
  }

  const kellVarni = (): boolean =>
    varniKell(Date.now(), utolsoGepeles.current, pending.current.modified, pending.current.saving)

  const onClick = (event: MouseEvent): void => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
      return
    }
    if (!kellVarni()) {
      return
    }
    event.preventDefault()
    elonezetMegnyitasa(href, kellVarni)
  }

  return (
    <Button
      aria-label={ELONEZET_NEV}
      buttonStyle="secondary"
      className="kc-elonezet-gomb"
      el="anchor"
      // Nem az `onClick` propot használjuk: a Payload Button minden onClick
      // mellett preventDefault-ot hív (Button/index.js handleClick), ami a
      // sima linkkattintást is elnyelné. Így a link alapból natívan nyílik.
      extraButtonProps={{ onClick }}
      icon={
        <span aria-hidden="true">
          <ExternalLinkIcon />
        </span>
      }
      iconPosition="right"
      id="preview-button"
      margin={false}
      newTab
      size="medium"
      url={href}
    >
      {ELONEZET_FELIRAT}
    </Button>
  )
}
