'use client'

import { useEffect } from 'react'

/**
 * Az „Így tudunk segíteni” sín (Services, `elrendezes: 'sin'`) koppintás-javítása.
 *
 * A HIBA (bejelentve 2026-09-23, mobil gyári böngésző; mérve Chromiumban,
 * 390×844, érintéssel, az éles lapon): nyitott 1. sornál a 3. sorra koppintva
 * a lap 1188 px-t ugrott FELFELÉ, a kinyílt tartalom a képernyő alja alá
 * került (teteje 892 px a 844 px magas nézetben). Két ok:
 *  1. A címke-kattintás a hozzá tartozó rádióra teszi a fókuszt, a böngésző
 *     pedig a fókuszált elemet a nézetbe görgeti. A rejtett rádiók a
 *     `fieldset` ELEJÉN állnak (a `:checked ~` testvér-kombinátor miatt ott
 *     kell lenniük), tehát a modul tetejére. Az ugrás pixelre egyezett a
 *     rádió és a nézet közti távolsággal.
 *  2. Mobilon a sín accordion: a koppintott sor FÖLÖTT nyitva lévő panel
 *     összecsukódik, és minden feljebb csúszik. Chromium a görgetés-
 *     horgonyzással (CSS Scroll Anchoring) részben kiegyenlíti, a Safari nem.
 *
 * A JAVÍTÁS: a címke-kattintást a komponens kezeli. Kiválasztja a rádiót,
 * görgetés nélkül fókuszálja (`focus({ preventScroll: true })`), majd a lapot
 * annyival görgeti, hogy a koppintott sor ugyanott maradjon a képernyőn, ahol
 * a koppintáskor volt; a kinyílt tartalom így közvetlenül alatta kezdődik.
 * Ez a mobil accordion elvárt viselkedése: a megnyitott tartalom a
 * fejléce alatt jelenik meg, a fejléc nem mozdul (NN/g, Accordions on
 * Mobile: https://www.nngroup.com/articles/mobile-accordions/; GOV.UK
 * Accordion: https://design-system.service.gov.uk/components/accordion/).
 * A felhasználó által nem kért mozgás megszűnik (WCAG 2.2 SC 3.2.2 On Input:
 * a kiválasztás nem okozhat váratlan kontextusváltást,
 * https://www.w3.org/WAI/WCAG22/Understanding/on-input.html).
 *
 * A görgetés `instant`: a böngésző saját ugrásának kiegyenlítése, nem új,
 * animált mozgás (a `html { scroll-behavior: smooth }` itt csak üldözést
 * okozna). A következő képkockában még egyszer igazít, ha a horgonyzás vagy
 * egy késői elrendezés-változás közben elmozdította a sort.
 *
 * JavaScript nélkül a sín a mai, tisztán CSS-es módon működik (a rádió és a
 * `:checked` szabályok változatlanok); a billentyűzetes kezelés (nyilak a
 * rádiócsoportban) sem változik, azt a böngésző végzi.
 *
 * NYITÁS-ZÁRÁS ANIMÁCIÓ MOBILON (2026-09-23, tulajdonosi kör: „nagyon
 * hirtelen … nem méltó az oldal finomságához”). A mobil accordionban a CSS
 * a panel magasságát, paddingját, keretét és margóját egy lépésben váltja
 * (0 ↔ auto), csak a tartalom halványul: a régi panel egy képkocka alatt
 * eltűnik, az új teljes magasságában megjelenik. A komponens ezért a váltást
 * Web Animations API-val animálja: a nyíló panel 0-ról a saját dobozára nő,
 * a záródó a régi dobozáról 0-ra zsugorodik, egyszerre, és a koppintott sor
 * a mozgás minden képkockájában ugyanott marad a képernyőn (a fölötte
 * záródó panel zsugorodását a görgetés követi).
 *
 * IDŐZÍTÉS ÉS GÖRBE (mérve). Az első változat a sín áttűnés-tokenjét
 * (350 ms, `--kc-ease-out` = cubic-bezier(0.2, 0.8, 0.2, 1)) használta; a
 * képkockánkénti mérés szerint a 812 px-es panel magasságváltozásának
 * kétharmada az első 100 ms-ban lezajlott, ami ugrásnak hat. A panel
 * magassága ezért a nagy kinyitásra ajánlott értékeket kapja:
 * 400 ms (IBM Carbon `duration--slow-01`: „Large expansion”) és a Carbon
 * kiegyensúlyozott, finoman induló és érkező görbéje,
 * cubic-bezier(0.4, 0.14, 0.3, 1) („standard, expressive”):
 * https://v10.carbondesignsystem.com/guidelines/motion/overview/. A nagyobb
 * elmozdulás hosszabb, egyenletesebb mozgást kér: NN/g, Animation Duration
 * and Motion Characteristics (100–500 ms),
 * https://www.nngroup.com/articles/animation-duration/; Material 3, Easing
 * and duration, https://m3.material.io/styles/motion/easing-and-duration/tokens-specs.
 * A panel tartalmának áttűnése a sín meglévő tokenjein marad (CSS).
 *
 * A KÉT IRÁNY UGYANAZT A KOREOGRÁFIÁT KAPJA (2026-09-23, tulajdonosi kör:
 * „amikor fölfelé kellene nyíljon … mintha szaggatna”). Képkockánként mérve
 * (390×844, 60 Hz, a koppintott sorhoz viszonyítva): nyitott 1. sorból a
 * 3.-ra koppintva a képernyőn látható, átlátszatlan elemek legfeljebb 25 px-t
 * ugrottak képkockánként, mert a fölötte záródó panel a CSS-áttűnéssel
 * (350 ms, `--kc-ease-out`) már elhalványult, mire gyorsan mozdult volna, a
 * beérkező sor pedig a lassuló szakaszban ért a helyére. Nyitott 3. sorból
 * az 1.-re koppintva viszont a lenyíló panel alatti 2. és 3. sor teljesen
 * látható maradt, és a mozgás leggyorsabb részében csúszott ki a képernyő
 * alján: 5–8 képkockán át 30–77 px-es ugrás, ez a szaggatás. A helyüket
 * változtató elemek bármilyen sebességnél erősebben vonzzák a figyelmet,
 * mint a halványulók (NN/g, Animation for Attention and Comprehension:
 * https://www.nngroup.com/articles/animation-usability/), és az átmenet alatt
 * zavaró elem az átmenet idejére eltűnhet, majd utána visszatér (Material
 * Design, Choreography: „Some elements may disappear during the transition
 * but reappear once the transition completes, if they are too distracting
 * during the transition itself”, https://m1.material.io/motion/choreography.html).
 * Ezért az a sor, amely koppintáskor látszott, de a mozgás végén a képernyő
 * alja alá kerül, ugyanazzal az idővel és görbével halványul el, mint a
 * záródó panel, és az átmenet végén (már a képernyőn kívül) visszakapja a
 * teljes átlátszatlanságot. A képernyőn maradó sor nem halványul: az a
 * helyére érkezik, a lassuló szakaszban.
 *
 * Csökkentett mozgásnál (`prefers-reduced-motion`, a CSS a tokent 0-ra zárja)
 * és asztalon (ott a panelek egy cellában rétegződnek, magasságváltás
 * nincs) nincs animáció, a váltás azonnali (WCAG 2.2 SC 2.3.3).
 */

/** A panel magasság-animációjának ideje (IBM Carbon `duration--slow-01`). */
export const SIN_MAGASSAG_MS = 400

/** A panel magasság-animációjának görbéje (IBM Carbon „standard, expressive”). */
export const SIN_MAGASSAG_GORBE = 'cubic-bezier(0.4, 0.14, 0.3, 1)'

/**
 * A képernyőről kicsúszó sor halványulásának görbéje: a tokens.css
 * `--kc-ease-out` tokenje, ugyanaz, amivel a záródó panel halványul
 * (services-sin.css). Az egyezést őr-teszt védi.
 */
export const SIN_KILEPO_GORBE = 'cubic-bezier(0.2, 0.8, 0.2, 1)'

/**
 * A képernyő teteje fölül belépő elem a mozgás e hányadáig rejtett marad,
 * utána a kilépő sorok görbéjével jelenik meg (lásd: belepoElemek). A Carbon
 * görbén a mozgás 60%-ánál a képkockánkénti elmozdulás már a csúcs (600
 * px-es úton 55 px) harmada körül van, és tovább lassul. Mérve (390×844,
 * 60 Hz): a látható elemek legnagyobb képkockánkénti ugrása lefelé nyitásnál
 * 18–20 px lett (50%-os kezdettel 27–31 px), a felfelé nyitásé 19–22 px.
 */
export const SIN_BELEPO_KEZDET = 0.6

/** A mobil accordion töréspontja (services-sin.css `max-width: 899px`). */
export const SIN_MOBIL_MEDIA = '(max-width: 899px)'

/** A panel dobozának animált tulajdonságai (a mobil CSS ezeket váltja 0 ↔ érték között). */
type Doboz = Record<
  | 'height'
  | 'paddingTop'
  | 'paddingBottom'
  | 'marginBottom'
  | 'borderTopWidth'
  | 'borderBottomWidth',
  string
>

/** A panel doboza és képernyő-helye egyetlen méréssel. */
interface PanelMeres {
  doboz: Doboz
  teteje: number
  alja: number
  /** A rács sorainak kiszámolt magassága (`grid-template-rows`, px-ben). */
  sorok: string
  /** Az oldalsó padding és keret: a záródó panel szélessége ne ugorjon. */
  oldalak: Partial<
    Record<'paddingLeft' | 'paddingRight' | 'borderLeftWidth' | 'borderRightWidth', string>
  >
}

function panelMeres(panel: HTMLElement, ablak: Window): PanelMeres {
  const stilus = ablak.getComputedStyle(panel)
  const hely = panel.getBoundingClientRect()
  return {
    doboz: {
      height: `${hely.height}px`,
      paddingTop: stilus.paddingTop,
      paddingBottom: stilus.paddingBottom,
      marginBottom: stilus.marginBottom,
      borderTopWidth: stilus.borderTopWidth,
      borderBottomWidth: stilus.borderBottomWidth,
    },
    teteje: hely.top,
    alja: hely.bottom,
    sorok: stilus.gridTemplateRows,
    oldalak: {
      paddingLeft: stilus.paddingLeft,
      paddingRight: stilus.paddingRight,
      borderLeftWidth: stilus.borderLeftWidth,
      borderRightWidth: stilus.borderRightWidth,
    },
  }
}

/**
 * A koppintott sor FÖLÖTT záródó panelnek csak a képernyőn látható része
 * mozog (2026-10-05, tulajdonosi kör: lefelé nyitásnál „szaggat”). Ami a
 * képernyő teteje fölött van, azt senki nem látja, mégis a teljes magassága
 * mozgatta a lapot: a koppintott sor helyben tartása miatt a fölötte lévő
 * tartalom (az előző sor, a szekció bevezetője) a panel TELJES magasságát
 * futotta be 400 ms alatt, és a mozgás leggyorsabb szakaszában csúszott be
 * a képernyő tetején (390×844-en 835 px, képkockánként 77 px-ig). Felfelé
 * nyitáskor ilyen belépő tartalom nincs, ezért volt az az irány sima.
 *
 * Ezért a záródó panel kiinduló magassága csak a látható része: a rejtett
 * rész az első képkockában összecsukódik, és a görgetéskövetés ezt a
 * képernyőn kívül, láthatatlanul kiegyenlíti. A panel tartalma a mozgás
 * alatt a panel ALJÁHOZ igazodik (`align-content: end`), a rács sorai pedig
 * a koppintáskor mért magasságukon maradnak (a tartalomnál alacsonyabb
 * panelben különben összenyomódnának: mérve a fotó 276 px-ről 192 px-re
 * esett, a tartalom 84 px-t ugrott). Így a látható rész a helyén marad, és
 * csak a panel teteje ereszkedik le, ahogy egy összecsukódó accordion szokott. A belépő tartalom útja így legfeljebb a
 * koppintott sor képernyő-helye, nem a panel magassága. A látómező szélén
 * gyorsan mozgó elem akaratlanul elrántja a figyelmet („Movement in a
 * person's peripheral vision triggers a stimulus-driven shift in visual
 * attention”), az átmenet dolga pedig az állapotok közti folytonosság
 * („Show continuity in a transition between the states of an object”):
 * NN/g, Animation for Attention and Comprehension,
 * https://www.nngroup.com/articles/animation-usability/. A képernyőn kívüli
 * rész mozgatása ehhez semmit nem ad, csak sebességet.
 */
function lathatoMagassag(teteje: number, alja: number, magassag: number): number {
  if (!Number.isFinite(teteje) || !Number.isFinite(alja)) {
    return magassag
  }
  return Math.min(magassag, Math.max(0, alja - Math.max(teteje, 0)))
}

/** Az első átmenet ideje ms-ban a kiszámolt `transition-duration`-ből (`0.35s` → 350). */
export function elsoAtmenetMs(ertek: string): number {
  const elso = ertek.split(',')[0]?.trim() ?? ''
  const szam = Number.parseFloat(elso)
  if (!Number.isFinite(szam)) {
    return 0
  }
  return elso.endsWith('ms') ? szam : szam * 1000
}

/**
 * A felhasználó saját görgető mozdulatai: bármelyik azonnal leállítja a
 * görgetéskövetést, hogy a követés ne dolgozzon a felhasználó ellen
 * (érintés, egérgörgő, billentyű: Page Down, szóköz, nyilak; mutató-lenyomás).
 */
const FELHASZNALOI_MOZDULATOK = ['touchstart', 'wheel', 'keydown', 'pointerdown'] as const

/** A fieldsetenként futó váltás leállítója (gyors ismételt koppintáshoz). */
const aktivValtasok = new WeakMap<Element, () => void>()

function azonosDoboz(a: Doboz, b: Doboz): boolean {
  return (Object.keys(a) as (keyof Doboz)[]).every(
    (kulcs) => Math.abs(Number.parseFloat(a[kulcs]) - Number.parseFloat(b[kulcs])) < 0.5,
  )
}

/** A sín címkéinek osztálya (Services.tsx, services-sin.css). */
export const SIN_CIMKE_OSZTALY = 'kc-services-sin__rail-label'

/**
 * Egy címke-kattintás kezelése a sín `fieldset`-jén. Exportálva, hogy a
 * viselkedés tesztből (happy-dom) bizonyítható legyen.
 */
export function sinCimkeKattintas(event: MouseEvent, ablak: Window = window): void {
  const cel = event.target
  if (!(cel instanceof Element)) {
    return
  }
  const cimke = cel.closest(`label.${SIN_CIMKE_OSZTALY}`)
  if (!(cimke instanceof HTMLLabelElement)) {
    return
  }
  const radio = cimke.htmlFor ? ablak.document.getElementById(cimke.htmlFor) : null
  if (!(radio instanceof HTMLInputElement) || radio.type !== 'radio' || radio.disabled) {
    return
  }
  event.preventDefault()
  const elotte = cimke.getBoundingClientRect().top
  const igazit = () => {
    const elteres = cimke.getBoundingClientRect().top - elotte
    if (Math.abs(elteres) >= 1) {
      ablak.scrollBy({ top: elteres, behavior: 'instant' })
    }
  }
  if (radio.checked) {
    radio.focus({ preventScroll: true })
    return
  }

  const fieldset = cimke.closest('fieldset')
  const radiok = fieldset
    ? [...fieldset.querySelectorAll<HTMLInputElement>('input.kc-services-sin__input')]
    : []
  const panelek = fieldset
    ? [...fieldset.querySelectorAll<HTMLElement>('.kc-services-sin__panel')]
    : []
  const ujPanel = panelek[radiok.indexOf(radio)]
  const cimkek = fieldset
    ? [...fieldset.querySelectorAll<HTMLElement>(`label.${SIN_CIMKE_OSZTALY}`)]
    : []
  const mobil = ablak.matchMedia?.(SIN_MOBIL_MEDIA).matches === true
  // A kiinduló doboz a panelek PILLANATNYI mérete: ha egy korábbi váltás
  // animációja még fut, onnan folytatjuk, ugrás nélkül.
  const kezdoMeresek = mobil ? panelek.map((panel) => panelMeres(panel, ablak)) : []
  // A többi sor koppintáskori helye (a koppintott sor helye az `elotte`).
  const kezdoCimkek = mobil
    ? cimkek.map((masik) => (masik === cimke ? null : masik.getBoundingClientRect()))
    : []
  // A szekció bevezetője (mobilon a rács első sora) is beléphet felülről.
  const fejlec = fieldset?.querySelector<HTMLElement>('.kc-services-sin__header') ?? null
  const kezdoFejlec = mobil && fejlec ? fejlec.getBoundingClientRect() : null
  // A sorok pillanatnyi átlátszatlansága, még az előző váltás leállítása
  // előtt: a leállítás 1-re ugratná a félig halvány sort (felvillanás).
  const kezdoAtlatszosag = mobil
    ? cimkek.map((masik) => {
        const ertek = Number.parseFloat(ablak.getComputedStyle(masik).opacity)
        return Number.isFinite(ertek) ? ertek : 1
      })
    : []
  // Egy fieldsetben egyszerre egy váltás él: a gyors második koppintás
  // leállítja az előző animációit és görgetéskövetését (a két követés
  // különben egymás ellen görgetne).
  if (fieldset) {
    aktivValtasok.get(fieldset)?.()
    aktivValtasok.delete(fieldset)
  }

  radio.checked = true
  radio.dispatchEvent(new Event('input', { bubbles: true }))
  radio.dispatchEvent(new Event('change', { bubbles: true }))
  radio.focus({ preventScroll: true })

  // A csökkentett mozgást a CSS jelzi: reduce alatt a panel átmenete 0 s.
  // A panel halványulásának ideje (services-sin.css, `--kc-services-motion-cross`).
  const athalvanyulasMs =
    mobil && ujPanel ? elsoAtmenetMs(ablak.getComputedStyle(ujPanel).transitionDuration) : 0
  const mozoghat =
    athalvanyulasMs > 0 && ablak.matchMedia?.('(prefers-reduced-motion: reduce)').matches !== true
  if (!fieldset || !ujPanel || !mozoghat || typeof ujPanel.animate !== 'function') {
    igazit()
    ablak.requestAnimationFrame(igazit)
    return
  }

  // A végső elrendezés, még az animációk előtt mérve (az animáció már a
  // köztes méretet adná). A koppintott sor a helyén marad, tehát minden elem
  // végső képernyő-helye a mostani helye, a sor elmozdulásával kiegyenlítve.
  const vegDobozok = panelek.map((panel) => panelMeres(panel, ablak).doboz)
  const kiegyenlites = elotte - cimke.getBoundingClientRect().top
  const kepernyoAlja = ablak.innerHeight
  const kilepoCimkek = cimkek.filter((masik, index) => {
    const kezdo = kezdoCimkek[index]
    if (!kezdo) {
      return false
    }
    const latszott = kezdo.bottom > 0 && kezdo.top < kepernyoAlja
    return latszott && masik.getBoundingClientRect().top + kiegyenlites >= kepernyoAlja
  })
  // A tükörkép (lefelé nyitás, a koppintott sor fölött záródó panel): ami a
  // koppintáskor teljesen a képernyő teteje fölött volt, és a mozgás végén
  // látszik, az felülről úszik be, a mozgás gyors szakaszában is. Ez az elem
  // a mozgás első felében rejtett, és csak a lassuló második felében jelenik
  // meg (Material Design, Choreography: az átmenet alatt zavaró elem
  // eltűnhet, és az átmenet végén visszatér,
  // https://m1.material.io/motion/choreography.html).
  const belepEFelulrol = (elem: Element, kezdo: DOMRect | null | undefined) => {
    // Csak a megjelenített (nem nulla magas) elem számít.
    if (!kezdo || kezdo.bottom > 0 || !(kezdo.bottom - kezdo.top > 0)) {
      return false
    }
    const veg = elem.getBoundingClientRect()
    return veg.bottom + kiegyenlites > 0 && veg.top + kiegyenlites < kepernyoAlja
  }
  const belepoElemek: Element[] = [
    ...cimkek.filter((masik, index) => belepEFelulrol(masik, kezdoCimkek[index])),
    ...(fejlec && belepEFelulrol(fejlec, kezdoFejlec) ? [fejlec] : []),
  ]

  const idozites: KeyframeAnimationOptions = {
    duration: SIN_MAGASSAG_MS,
    easing: SIN_MAGASSAG_GORBE,
  }
  const animaciok: Animation[] = []
  try {
    panelek.forEach((panel, index) => {
      const meres = kezdoMeresek[index]
      const veg = vegDobozok[index]
      if (!meres || !veg || azonosDoboz(meres.doboz, veg)) {
        return
      }
      // A záródó panel a CSS szerint rögtön rejtett lenne: a mozgás idejére
      // látható marad, hogy a zsugorodás látsszon.
      const zarodik = Number.parseFloat(veg.height) === 0
      if (!zarodik) {
        animaciok.push(panel.animate([meres.doboz, veg], idozites))
        return
      }
      // A koppintott sor fölött záródó panelből csak a látható rész mozog
      // (lásd: lathatoMagassag).
      const teljes = Number.parseFloat(meres.doboz.height)
      const lathato =
        meres.alja <= elotte + 0.5 ? lathatoMagassag(meres.teteje, meres.alja, teljes) : teljes
      const kurtitott = lathato < teljes - 0.5
      const kezdo = kurtitott ? { ...meres.doboz, height: `${lathato}px` } : meres.doboz
      const igazitas = kurtitott
        ? { alignContent: 'end', ...(meres.sorok ? { gridTemplateRows: meres.sorok } : {}) }
        : {}
      // A mobil CSS a záródó panel oldalsó paddingjét és keretét azonnal
      // 0-ra váltja: a tartalom kiszélesedne, a négyzetes fotó 276 px-ről
      // 320 px-re nőne az első képkockában (390×844, mérve). A mozgás alatt
      // a szélesség a koppintáskori marad; csak a magasság változik.
      const oldalak = Object.fromEntries(
        Object.entries(meres.oldalak).filter(([, ertek]) => typeof ertek === 'string' && ertek),
      )
      animaciok.push(
        panel.animate(
          [
            { ...kezdo, ...oldalak, ...igazitas, visibility: 'visible' },
            { ...veg, ...oldalak, ...igazitas, visibility: 'visible' },
          ],
          idozites,
        ),
      )
    })
    // A képernyő alja alá kicsúszó sor a záródó panellel együtt halványul el,
    // és az átmenet végén, már a képernyőn kívül, újra teljesen látszik. Egy
    // gyors ismételt koppintás után minden sor a pillanatnyi átlátszatlanságából
    // folytatja: a kilépő tovább halványul, a maradó ugyanazzal a görbével tér
    // vissza, ugrás nélkül.
    const kilepoVege = Math.min(1, athalvanyulasMs / SIN_MAGASSAG_MS)
    for (const belepo of belepoElemek) {
      animaciok.push(
        belepo.animate(
          [
            { opacity: 0 },
            { opacity: 0, offset: SIN_BELEPO_KEZDET, easing: SIN_KILEPO_GORBE },
            { opacity: 1 },
          ],
          { duration: SIN_MAGASSAG_MS },
        ),
      )
    }
    cimkek.forEach((masik, index) => {
      if (belepoElemek.includes(masik)) {
        return
      }
      const kezdoAtlatszo = kezdoAtlatszosag[index] ?? 1
      const kilep = kilepoCimkek.includes(masik)
      if (!kilep && kezdoAtlatszo >= 0.99) {
        return
      }
      const cel = kilep ? 0 : 1
      animaciok.push(
        masik.animate(
          [
            { opacity: kezdoAtlatszo, easing: SIN_KILEPO_GORBE },
            { opacity: cel, offset: kilepoVege },
            { opacity: cel },
          ],
          { duration: SIN_MAGASSAG_MS },
        ),
      )
    })
  } catch {
    // Ha a böngésző nem tudja lejátszani, a váltás azonnali marad, de a
    // koppintott sor akkor is a helyén.
    animaciok.forEach((animacio) => animacio.cancel())
    igazit()
    ablak.requestAnimationFrame(igazit)
    return
  }

  // A koppintott sor minden képkockában a helyén marad; a felhasználó saját
  // görgetése vagy érintése azonnal átveszi az irányítást.
  let kovet = true
  const leall = () => {
    kovet = false
  }
  const takarit = () => {
    kovet = false
    for (const esemeny of FELHASZNALOI_MOZDULATOK) {
      ablak.removeEventListener(esemeny, leall)
    }
  }
  const megszakit = () => {
    takarit()
    animaciok.forEach((animacio) => animacio.cancel())
  }
  aktivValtasok.set(fieldset, megszakit)
  for (const esemeny of FELHASZNALOI_MOZDULATOK) {
    ablak.addEventListener(esemeny, leall, { once: true, passive: true })
  }
  const lepes = () => {
    if (!kovet) {
      return
    }
    igazit()
    ablak.requestAnimationFrame(lepes)
  }
  lepes()
  void Promise.all(animaciok.map((animacio) => animacio.finished))
    .then(() => {
      if (kovet) {
        igazit()
      }
    })
    .catch(() => undefined)
    .finally(() => {
      takarit()
      if (aktivValtasok.get(fieldset) === megszakit) {
        aktivValtasok.delete(fieldset)
      }
    })
}

export function SinKoppintasIgazito({ fieldsetId }: { fieldsetId: string }) {
  useEffect(() => {
    const fieldset = document.getElementById(fieldsetId)
    if (!fieldset) {
      return
    }
    const kezelo = (event: MouseEvent) => sinCimkeKattintas(event)
    fieldset.addEventListener('click', kezelo)
    return () => {
      fieldset.removeEventListener('click', kezelo)
      // Ha a komponens egy futó váltás közben tűnik el (navigáció), a
      // görgetéskövetés és az animáció sem futhat tovább az új lapon.
      aktivValtasok.get(fieldset)?.()
      aktivValtasok.delete(fieldset)
    }
  }, [fieldsetId])
  return null
}
