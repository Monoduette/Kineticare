'use client'

import { useConfig, useFormFields } from '@payloadcms/ui'
import { useId, useState, type CSSProperties, type JSX, type MouseEvent } from 'react'

import { sectionSource, UGRAS_FELIRAT } from '../../lib/section-row-label'
import { ADMIN_UTAK } from './KezdolapCel'

/**
 * „Mi hol van” tájékoztatók az Oldalak szerkesztőjében (K17, K19).
 *
 * A mért hiba (admin-audit seta/t1c, t7): a kezdőlap szerkesztője a Cím, a
 * Rövid bevezető és az oldal végi GYIK átírásáért is „Sikeresen frissítve.”
 * visszajelzést ad, a látogató pedig semmit nem lát, mert a lapot a Szekciók
 * adják. A tájékoztatók ezért a MEZŐK MELLETT mondják ki, mi hat a lapra
 * (NN/g, Match Between the System and the Real World,
 * https://www.nngroup.com/articles/match-system-real-world/; WCAG 2.2 SC 3.3.2
 * Labels or Instructions,
 * https://www.w3.org/WAI/WCAG22/Understanding/labels-or-instructions.html).
 *
 * Mind `type: 'ui'` mező: adatbázis-oszlopa nincs, a feltétele séma-semleges.
 * Az igazság a route-ok kódjából jön:
 * - kezdőlap (src/components/content/HomeView.tsx): szekciók mellett csak a
 *   RenderBlocks fut; a Cím, a Bevezető, a Fejléckép, a Tartalom és az oldal
 *   végi GYIK a lapon nem jelenik meg (a Cím és a Bevezető SEO-tartalék,
 *   src/lib/seo.ts buildHomeMetadata; a Fejléckép megosztási tartalék,
 *   resolveOgImage);
 * - Kapcsolat (src/app/(frontend)/kapcsolat/page.tsx): a nagy cím a rekord
 *   Címe (`contactHeading`, üresen „Kapcsolat”), alatta csak a szekciók; a
 *   Rövid bevezető, a Fejléckép, a Tartalom és az oldal végi GYIK nem
 *   renderel;
 * - a [slug] oldalak ([slug]/page.tsx): a Cím a nagy cím, alatta a Bevezető,
 *   mellette a Fejléckép (PageHero), KIVÉVE ha látható nyitó videós szekció
 *   van; a Tartalom csak szekciók nélkül jelenik meg; az oldal végi GYIK és a
 *   szerzői doboz a szekciók UTÁN (PageEeat), ha ki vannak töltve.
 *
 * A felső doboz nem állít olyat, hogy „minden” vagy „a többi” szöveg a
 * Szekciókban van: egyes szekciók tartalma máshonnan töltődik (Kurzusok,
 * Vélemények, Blogbejegyzések; src/lib/section-row-label.ts sectionSource).
 * Ezeket a doboz UGYANAZZAL a névvel és linkfelirattal nevezi meg, mint a
 * szekció elején álló tájékoztató (WCAG 2.2 SC 3.2.4 Consistent
 * Identification,
 * https://www.w3.org/WAI/WCAG22/Understanding/consistent-identification.html;
 * NN/g, Consistency and Standards: „Users should not have to wonder whether
 * different words, situations, or actions mean the same thing.”,
 * https://www.nngroup.com/articles/ten-usability-heuristics/).
 *
 * A kezdőlap dobozában két rövid pont is áll (modul-térkép H35, H39), a
 * route-kód szerint, readFileSync-őrrel (oldal-szerkeszto-tajekoztatas.test.tsx):
 * - a lap nem szekció részei: a fejléc menüje a Menüpontokból jön
 *   (src/components/layout/Header.tsx getNavTree → src/lib/menus.ts), a
 *   lábléc (Footer.tsx) és a „Bankkártyás fizetés Barionnal” sáv
 *   (HomeView.tsx `<BarionFizetesJelzes hely="kezdolap" />`) a kódban van;
 * - ha minden szekciót törölnek és közzéteszik, a HomeView a beépített
 *   alapváltozatot rajzolja (`if (layout.length > 0)` hamis ága). Az onInit
 *   (payload.config.ts ensureHomeBaseline → home-seed.ts
 *   ensureHomeLayoutFrissTelepitesen) 2026-09-23 óta csak teljesen üres
 *   Oldalak-gyűjteménynél ír, tehát a szekciók maguktól nem kerülnek vissza;
 *   a korábbi állapot a Verziók fülön állítható vissza.
 *
 * Stílus: a B1 `.kc-admin-notice` szerződése, saját szín nélkül. A doboz
 * statikus, élő régió nélkül (mountkor nem szól be). GOV.UK Inset text: „Use
 * inset text very sparingly”
 * (https://design-system.service.gov.uk/components/inset-text/): ezért csak
 * szekciós oldalon és csak ott jelenik meg, ahol a lap mást mutat, mint amit
 * a mező sugall.
 */

export const KEZDOLAP_SLUG = 'kezdolap'
export const KAPCSOLAT_SLUG = 'kapcsolat'

/** A két oldal, amelynek route-ja az oldal végi GYIK-et nem rendereli. */
export const OLDAL_GYIK_NELKULI_SLUGOK: ReadonlySet<string> = new Set([
  KEZDOLAP_SLUG,
  KAPCSOLAT_SLUG,
])

export const NYITO_VIDEO_BLOKK = 'filmHero'
export const GYIK_BLOKK = 'faq'

/** A Szekciók blokkmezőjének DOM-azonosítója (Payload: `field-<név>`). */
export const SZEKCIOK_HORGONY = 'field-layout'

/** A Payload szekciósorának DOM-azonosítója (0-tól számozva). */
export function szekcioSorHorgony(index: number): string {
  return `layout-row-${index}`
}

export interface SzekcioSor {
  blockType: string
  lathato: boolean
  /**
   * Ha a szekció tartalma máshonnan jön: a hely neve, ahol szerkeszted (a
   * sectionSource() `hova.nev`-e, a szekció elején álló „Ugrás oda, ahol
   * szerkeszted: …” link célja). Egyébként üres.
   */
  forras?: string | null
}

/**
 * Magyar névelő és rag a kétjegyű sorszámhoz, ahogy a sorcímke mutatja
 * („az 01-es”, „a 14-es”, „a 03-as”). A névelő a kiejtett szám első hangján
 * múlik (egy, öt, ötven… → az), a rag kötőjellel kapcsolódik, és az utolsó
 * kiejtett szóhoz illeszkedik (AkH. 12. kiadás, 11.1. A számok, 290–294. pont;
 * https://helyesiras.mta.hu/helyesiras/default/numerals).
 */
export function sorszamKifejezes(sorszam: number): string {
  const n = Math.max(1, Math.trunc(sorszam))
  const szam = String(n).padStart(2, '0')
  const tizes = Math.floor(n / 10) % 10
  const egyes = n % 10
  const nevelo = n === 1 || n === 5 || (n >= 50 && n <= 59) ? 'az' : 'a'
  const egyesRag = ['', 'es', 'es', 'as', 'es', 'ös', 'os', 'es', 'as', 'es']
  const tizesRag = ['as', 'es', 'as', 'as', 'es', 'es', 'as', 'es', 'as', 'es']
  let rag: string
  if (egyes !== 0) {
    rag = egyesRag[egyes] ?? 'es'
  } else if (n % 100 === 0) {
    rag = 'as'
  } else {
    rag = tizesRag[tizes] ?? 'es'
  }
  return `${nevelo} ${szam}-${rag}`
}

/** Az első LÁTHATÓ adott típusú szekció indexe, vagy null. */
export function elsoSzekcio(sorok: readonly SzekcioSor[], blockType: string): number | null {
  const index = sorok.findIndex((sor) => sor.blockType === blockType && sor.lathato)
  return index >= 0 ? index : null
}

export type OldalFajta = 'kezdolap' | 'kapcsolat' | 'nyitoVideos' | 'lapfejes'

export function oldalFajta(slug: unknown, sorok: readonly SzekcioSor[]): OldalFajta {
  if (slug === KEZDOLAP_SLUG) return 'kezdolap'
  if (slug === KAPCSOLAT_SLUG) return 'kapcsolat'
  if (elsoSzekcio(sorok, NYITO_VIDEO_BLOKK) !== null) return 'nyitoVideos'
  return 'lapfejes'
}

export interface TajekoztatoSzoveg {
  cim: string
  bekezdesek: string[]
  /** Rövid pontok a bekezdések után (csak a kezdőlapon). */
  pontok?: string[]
}

/** A Menüpontok gyűjtemény neve (src/collections/Menus.ts labels.plural; teszt köti). */
export const MENUPONTOK_NEV = 'Menüpontok'

/**
 * A kezdőlapi Barion-sáv címsora (src/components/checkout/BarionFizetesJelzes.tsx
 * BARION_CIM; literál, mert az a modul képet és next/link-et húz be, teszt köti).
 */
export const BARION_SAV_CIM = 'Bankkártyás fizetés Barionnal'

/** A kezdőlap nem szekció részei (H35). */
export const NEM_SZEKCIO_PONT = `A lap nem szekció részei: a fejléc menüjét a ${MENUPONTOK_NEV} között írod át, a láblécet és a „${BARION_SAV_CIM}” sávot a weboldal kódja adja.`

/** Mi történik, ha a kezdőlap minden szekcióját törlik (H39). */
export const MINDEN_SZEKCIO_TORLESE_PONT =
  'Ha az összes szekciót törlöd és közzéteszed, a kezdőlapon a weboldal beépített alapváltozata jelenik meg, a szekciók pedig maguktól nem kerülnek vissza, a korábbi állapotot a Verziók fülön állíthatod vissza.'

/** A Pages.ts-ben álló mezőcímkék, amelyeket a doboz idéz. */
export interface MezoNevek {
  /** Az oldal végi GYIK tömb címkéje. */
  gyik: string
  /** A Szerző mező címkéje. */
  szerzo: string
}

export const ALAP_MEZONEVEK: MezoNevek = { gyik: 'Oldal végi GYIK', szerzo: 'Szerző' }

/**
 * A LÁTHATÓ, máshonnan töltődő szekciók forrásainak neve, az első
 * előfordulás sorrendjében, ismétlés nélkül (pl. Kurzusok, Vélemények).
 */
export function maskentToltodoForrasok(sorok: readonly SzekcioSor[]): string[] {
  const nevek: string[] = []
  for (const sor of sorok) {
    const nev = sor.forras?.trim()
    if (sor.lathato && nev && !nevek.includes(nev)) nevek.push(nev)
  }
  return nevek
}

/** Magyar felsorolás: „A”, „A és B”, „A, B és C”. */
export function felsorolas(nevek: readonly string[]): string {
  if (nevek.length <= 1) return nevek.join('')
  return `${nevek.slice(0, -1).join(', ')} és ${nevek[nevek.length - 1]}`
}

/**
 * A kivétel kimondása: mely szekciók tartalma jön máshonnan, és hol a link.
 * A link felirata a szekció elején a helyet is megnevezi („Ugrás oda, ahol
 * szerkeszted: Kurzusok”), ezért itt elég a közös első részét idézni. Csak
 * akkor van, ha a lapon tényleg van ilyen szekció (GOV.UK Inset text: „Use
 * inset text very sparingly”).
 */
export function maskentMondat(sorok: readonly SzekcioSor[]): string | null {
  const nevek = maskentToltodoForrasok(sorok)
  if (nevek.length === 0) return null
  return `Egyes szekciók tartalma máshonnan jön (itt: ${felsorolas(nevek)}): ezek elején az „${UGRAS_FELIRAT}” link visz tovább.`
}

/**
 * A lap tetején álló „Hol írod át, amit a látogató lát?” tájékoztató szövege.
 * Változatonként legfeljebb négy rövid mondat; a „minden” és „a többi”
 * szót kerüli, mert van kivétel (lásd a fájl elejét).
 */
export function hazaTajekoztato(
  slug: unknown,
  sorok: readonly SzekcioSor[],
  nyitoBlokkNev: string,
  mezok: MezoNevek = ALAP_MEZONEVEK,
): TajekoztatoSzoveg {
  const cim = 'Hol írod át, amit a látogató lát?'
  const fajta = oldalFajta(slug, sorok)
  const nyito = elsoSzekcio(sorok, NYITO_VIDEO_BLOKK)
  const nyitoHely = nyito !== null ? `${sorszamKifejezes(nyito + 1)}, „${nyitoBlokkNev}”` : null
  const maskent = maskentMondat(sorok)
  const szekciokMondat = 'A lapon látható szekciók szövegét lent, a Szekciók között írod át.'
  // A szerzői doboz a Szerző, a Szakmai ellenőrzést végezte és a két
  // ellenőrzési dátum mezőből áll (PostAuthorBox); ezek a Szerzőtől lefelé,
  // egymás alatt állnak, ezért elég az első címkét idézni.
  const lapVegeMondat = `A Szekciók után jön az oldal végi GYIK és a szerzői doboz, ha ki vannak töltve: ezeket az „${mezok.gyik}” mezőben, illetve a „${mezok.szerzo}” mezőtől lefelé írod át.`
  const mondatok = (...lista: Array<string | null>): TajekoztatoSzoveg => ({
    cim,
    bekezdesek: lista.filter((mondat): mondat is string => mondat !== null),
  })
  if (fajta === 'kezdolap') {
    // A menü „Kezdőlapi videó szövegei” pontja az ELSŐ nyitó videós szekciót
    // nyitja meg (KezdolapCel.ts kezdolapCelFeloldasa), láthatóságtól
    // függetlenül; csak akkor utalunk rá, ha ez ugyanaz, mint a látható.
    const menuNyitja =
      nyito !== null && sorok.findIndex((s) => s.blockType === NYITO_VIDEO_BLOKK) === nyito
    const menuResz = menuNyitja
      ? `; ezt a szekciót a menü „${ADMIN_UTAK.videoSzovegei.felirat}” pontja is megnyitja`
      : ''
    return {
      ...mondatok(
        szekciokMondat,
        nyitoHely !== null
          ? `A legnagyobb cím és a videón beúszó szövegek ${nyitoHely} szekcióban vannak${menuResz}.`
          : null,
        maskent,
        'A Cím, a Rövid bevezető és a Fejléckép mező a lapon nem jelenik meg: a keresőknek és a megosztási előnézetnek szól.',
      ),
      pontok: [NEM_SZEKCIO_PONT, MINDEN_SZEKCIO_TORLESE_PONT],
    }
  }
  if (fajta === 'kapcsolat') {
    return mondatok(
      'A lap nagy címe a fenti Cím mező.',
      'Alatta a szekciók jönnek, ezek szövegét lent, a Szekciók között írod át.',
      maskent,
      'A Rövid bevezető és a Fejléckép mező a lapon nem jelenik meg.',
    )
  }
  if (fajta === 'nyitoVideos' && nyitoHely !== null) {
    return mondatok(
      szekciokMondat,
      `A legnagyobb cím ${nyitoHely} szekcióban áll: amíg ez látható, a Cím, a Rövid bevezető és a Fejléckép mező a lapon nem jelenik meg.`,
      maskent,
      lapVegeMondat,
    )
  }
  return mondatok(
    'A Cím mező a lap nagy címe, alatta a Rövid bevezető áll, mellette vagy alatta a Fejléckép.',
    'Alattuk a szekciók jönnek, ezek szövegét lent, a Szekciók között írod át.',
    maskent,
    lapVegeMondat,
  )
}

/** A Tartalom mező előtti figyelmeztetés (csak szekciós oldalon). */
export function regiTartalomSzoveg(): TajekoztatoSzoveg {
  return {
    cim: 'Ez a régi, teljes oldalszöveg.',
    bekezdesek: [
      'Amíg vannak Szekciók, a lapon nem jelenik meg. A látható szöveget fent, a Szekciókban írd át.',
    ],
  }
}

/** Az oldal végi GYIK előtti figyelmeztetés (kezdőlap, Kapcsolat). */
export function oldalGyikSzoveg(
  slug: unknown,
  sorok: readonly SzekcioSor[],
  gyikBlokkNev: string,
): TajekoztatoSzoveg {
  const oldal = slug === KAPCSOLAT_SLUG ? 'A Kapcsolat oldalon' : 'A kezdőlapon'
  const gyik = elsoSzekcio(sorok, GYIK_BLOKK)
  return {
    cim: `${oldal} ez a GYIK nem jelenik meg.`,
    bekezdesek: [
      gyik !== null
        ? `A lapon látható kérdések fent, a Szekciók között, ${sorszamKifejezes(gyik + 1)} „${gyikBlokkNev}” szekcióban vannak.`
        : `Ha kérdés-válaszokat szeretnél a lapon, vegyél fel egy „${gyikBlokkNev}” szekciót a Szekciók közé.`,
    ],
  }
}

/**
 * Egy kattintásos ugrás: a cél a ragadós dokumentumfejléc ALÁ kerül, és a
 * fókusz is odaáll (a billentyűzetes felhasználó onnan folytatja).
 *
 * A Payload a mezőket csak a nézetbe érve rendereli (RenderIfInViewport), így
 * görgetés közben a cél fölötti tartalom magassága változhat. Ezért néhány
 * képkockán át újramérjük a cél helyét, amíg meg nem áll (legfeljebb ~1 mp).
 */
export function ugrasHozza(event: MouseEvent<HTMLAnchorElement>, celId: string): void {
  const cel = document.getElementById(celId)
  if (!cel) return
  event.preventDefault()
  const celY = (): number => {
    // A ragadós fejléc a görgetés UTÁN ennyit takar: a sticky `top` + a magassága.
    const fejlec = document.querySelector('.doc-controls')
    const takaras = fejlec
      ? (Number.parseFloat(getComputedStyle(fejlec).top) || 0) +
        fejlec.getBoundingClientRect().height
      : 0
    return Math.max(0, cel.getBoundingClientRect().top + window.scrollY - takaras - 8)
  }
  window.scrollTo({ top: celY() })
  if (!cel.hasAttribute('tabindex')) {
    cel.setAttribute('tabindex', '-1')
  }
  cel.focus({ preventScroll: true })
  // Ha közben a szerkesztő maga görget vagy gépel, azonnal abbahagyjuk.
  let kepkocka = 0
  const abbahagy = (): void => {
    kepkocka = 60
  }
  const opciok = { once: true, passive: true } as const
  for (const esemeny of ['wheel', 'touchstart', 'keydown'] as const) {
    window.addEventListener(esemeny, abbahagy, opciok)
  }
  const igazit = (): void => {
    kepkocka += 1
    if (kepkocka >= 60) {
      for (const esemeny of ['wheel', 'touchstart', 'keydown'] as const) {
        window.removeEventListener(esemeny, abbahagy)
      }
      return
    }
    const y = celY()
    if (Math.abs(y - window.scrollY) > 2) window.scrollTo({ top: y })
    window.requestAnimationFrame(igazit)
  }
  window.requestAnimationFrame(igazit)
}

function kulcsbol(kulcs: string): SzekcioSor[] {
  if (kulcs.length === 0) return []
  let adat: unknown
  try {
    adat = JSON.parse(kulcs)
  } catch {
    return []
  }
  if (!Array.isArray(adat)) return []
  return adat.flatMap((elem: unknown): SzekcioSor[] => {
    if (!Array.isArray(elem) || typeof elem[0] !== 'string') return []
    const forras = typeof elem[2] === 'string' && elem[2].length > 0 ? elem[2] : null
    return [{ blockType: elem[0], lathato: elem[1] !== false, forras }]
  })
}

/**
 * A szekciósor tömör lenyomata az űrlapállapotból (a Payload blokkmezőjének
 * sorai `layout.<i>.blockType` kulcson élnek). Szöveget ad vissza, hogy a
 * kiválasztó csak valódi változásra rendereljen újra.
 *
 * A forrást ugyanaz a sectionSource() adja, mint a szekció elején álló
 * tájékoztatót (a gombos kiemelő sávnál a gomb célja dönt, ezért azt is
 * átadjuk).
 */
function useSzekcioSorok(): SzekcioSor[] {
  const kulcs = useFormFields(([fields]) => {
    const slug = fields?.slug?.value
    const sorok: Array<[string, boolean, string]> = []
    for (let i = 0; ; i += 1) {
      const tipus = fields?.[`layout.${i}.blockType`]?.value
      if (typeof tipus !== 'string') break
      const lathato = fields?.[`layout.${i}.sectionSettings.visible`]?.value !== false
      const forras = sectionSource(
        { blockType: tipus, cta: { url: fields?.[`layout.${i}.cta.url`]?.value } },
        slug,
      )
      sorok.push([tipus, lathato, forras?.hova?.nev ?? ''])
    }
    return JSON.stringify(sorok)
  })
  return kulcsbol(typeof kulcs === 'string' ? kulcs : '')
}

function useOldalSlug(): unknown {
  return useFormFields(([fields]) => fields?.slug?.value)
}

/**
 * A kezdőlap két kiegészítő pontja (H35, H39) egy nyitható részben áll: a
 * doboz csukva a B3-ban mért keretben marad (1440 px-en 461–753 px), a
 * nyitógomb a linksorban ül, így csukott állapotban nem ad hozzá magasságot.
 * Ezt csak néhány szerkesztő keresi (fejléc, lábléc, a teljes törlés
 * következménye): GOV.UK Details, „Use the details component to make a page
 * easier to scan when it contains information that only some users will
 * need.” (https://design-system.service.gov.uk/components/details/). A minta
 * a WAI-ARIA APG Disclosure: gomb `aria-expanded`-del és `aria-controls`-szal,
 * Enter és Szóköz nyitja (https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/).
 * A pontok `<ul>`-ban, látható jellel (WCAG 2.2 SC 1.3.1), mert a Payload
 * alapstílusa a listajelet elveszi.
 */
export const KIEGESZITES_GOMB = 'Fejléc, lábléc és a szekciók törlése'

const PONTOK_STILUS = {
  margin: '0.5em 0 0',
  paddingInlineStart: '1.25em',
  listStyle: 'disc',
} as const

/**
 * A nyitógomb a linksor linkjeinek megjelenését veszi át (aláhúzott szöveg,
 * 24 px-es cél; a GOV.UK Details összefoglalója is aláhúzott szöveg
 * háromszöggel). Fókuszjelet a Payload a saját gombjain kívül nem ad, ezért
 * billentyűs fókusznál (`:focus-visible`) a linkekével azonos körvonalat kap.
 */
function gombStilus(fokuszban: boolean): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.35em',
    minHeight: 24,
    margin: 0,
    padding: 0,
    border: 0,
    background: 'none',
    color: 'inherit',
    font: 'inherit',
    textDecoration: 'underline',
    textUnderlineOffset: '0.2em',
    cursor: 'pointer',
    outline: fokuszban ? 'var(--accessibility-outline)' : undefined,
    outlineOffset: fokuszban ? 2 : undefined,
  }
}

export interface Kiegeszites {
  gomb: string
  pontok: string[]
  link?: { felirat: string; href: string }
}

function Doboz({
  szoveg,
  link,
  kiegeszites,
  figyelem = false,
  osztaly,
}: {
  szoveg: TajekoztatoSzoveg
  link?: { felirat: string; cel: string }
  /** Nyitható kiegészítés a linksor után (csak a kezdőlapon). */
  kiegeszites?: Kiegeszites
  figyelem?: boolean
  osztaly: string
}): JSX.Element {
  const [nyitva, setNyitva] = useState(false)
  const [fokuszban, setFokuszban] = useState(false)
  const reszId = useId()
  return (
    <div className={`kc-admin-notice${figyelem ? ' kc-admin-notice--figyelem' : ''} ${osztaly}`}>
      <p className="kc-admin-notice__cim">{szoveg.cim}</p>
      {szoveg.bekezdesek.map((bekezdes) => (
        <p className="kc-admin-notice__szoveg" key={bekezdes}>
          {bekezdes}
        </p>
      ))}
      {link || kiegeszites ? (
        <ul className="kc-admin-notice__linkek">
          {link ? (
            <li>
              <a href={`#${link.cel}`} onClick={(event) => ugrasHozza(event, link.cel)}>
                {link.felirat}
              </a>
            </li>
          ) : null}
          {kiegeszites ? (
            <li>
              <button
                aria-controls={reszId}
                aria-expanded={nyitva}
                className="kc-oldal-tajekoztato__nyito"
                onBlur={() => setFokuszban(false)}
                onClick={() => setNyitva((elozo) => !elozo)}
                onFocus={(event) => setFokuszban(event.currentTarget.matches(':focus-visible'))}
                style={gombStilus(fokuszban)}
                type="button"
              >
                <span aria-hidden="true">{nyitva ? '▾' : '▸'}</span>
                {kiegeszites.gomb}
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}
      {kiegeszites ? (
        <div className="kc-oldal-tajekoztato__kiegeszites" hidden={!nyitva} id={reszId}>
          <ul className="kc-admin-notice__szoveg" style={PONTOK_STILUS}>
            {kiegeszites.pontok.map((pont) => (
              <li key={pont}>{pont}</li>
            ))}
          </ul>
          {kiegeszites.link ? (
            <ul className="kc-admin-notice__linkek">
              <li>
                <a href={kiegeszites.link.href}>{kiegeszites.link.felirat}</a>
              </li>
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/** A Menüpontok lista címe az adminban. */
export function menupontokHref(adminRoute: string): string {
  return `${adminRoute.replace(/\/+$/, '')}/collections/menus`
}

export interface HomePageEditNoticeProps {
  /** A nyitó videós blokk neve (a blocks/film-hero.ts labels.singular, Pages.ts adja). */
  nyitoBlokkNev?: string
  /** Az oldal végi GYIK tömb címkéje (Pages.ts adja, ugyanabból az állandóból). */
  gyikMezoNev?: string
  /** A Szerző mező címkéje (Pages.ts adja, ugyanabból az állandóból). */
  szerzoMezoNev?: string
}

/** A dokumentum tetején: hol a látható szöveg, és egy kattintással oda. */
export function HomePageEditNotice({
  nyitoBlokkNev = 'Nyitó videó',
  gyikMezoNev = ALAP_MEZONEVEK.gyik,
  szerzoMezoNev = ALAP_MEZONEVEK.szerzo,
}: HomePageEditNoticeProps): JSX.Element | null {
  const slug = useOldalSlug()
  const sorok = useSzekcioSorok()
  const { config } = useConfig()
  if (sorok.length === 0) return null
  const szoveg = hazaTajekoztato(slug, sorok, nyitoBlokkNev, {
    gyik: gyikMezoNev,
    szerzo: szerzoMezoNev,
  })
  return (
    <Doboz
      link={{ felirat: 'Ugrás a Szekciókhoz', cel: SZEKCIOK_HORGONY }}
      kiegeszites={
        szoveg.pontok && szoveg.pontok.length > 0
          ? {
              gomb: KIEGESZITES_GOMB,
              pontok: szoveg.pontok,
              link: {
                felirat: `${MENUPONTOK_NEV} (a fejléc menüje)`,
                href: menupontokHref(config.routes.admin),
              },
            }
          : undefined
      }
      osztaly="kc-oldal-tajekoztato"
      szoveg={szoveg}
    />
  )
}

/** Közvetlenül a Tartalom mező előtt, szekciós oldalon. */
export function RegiTartalomNotice(): JSX.Element | null {
  const sorok = useSzekcioSorok()
  if (sorok.length === 0) return null
  return (
    <Doboz
      figyelem
      link={{ felirat: 'Ugrás a Szekciókhoz', cel: SZEKCIOK_HORGONY }}
      osztaly="kc-regi-tartalom-tajekoztato"
      szoveg={regiTartalomSzoveg()}
    />
  )
}

export interface OldalGyikNoticeProps {
  /** A GYIK blokk neve (a blocks/faq.ts labels.singular, Pages.ts adja). */
  gyikBlokkNev?: string
}

/** Az oldal végi GYIK előtt, a kezdőlapon és a Kapcsolat oldalon. */
export function OldalGyikNotice({
  gyikBlokkNev = 'GYIK',
}: OldalGyikNoticeProps): JSX.Element | null {
  const slug = useOldalSlug()
  const sorok = useSzekcioSorok()
  if (typeof slug !== 'string' || !OLDAL_GYIK_NELKULI_SLUGOK.has(slug)) return null
  const gyik = elsoSzekcio(sorok, GYIK_BLOKK)
  return (
    <Doboz
      figyelem
      link={
        gyik !== null
          ? { felirat: 'Ugrás a látható GYIK szekcióhoz', cel: szekcioSorHorgony(gyik) }
          : { felirat: 'Ugrás a Szekciókhoz', cel: SZEKCIOK_HORGONY }
      }
      osztaly="kc-oldal-gyik-tajekoztato"
      szoveg={oldalGyikSzoveg(slug, sorok, gyikBlokkNev)}
    />
  )
}
