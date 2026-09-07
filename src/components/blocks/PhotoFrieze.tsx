import type { CSSProperties } from 'react'
import Image from 'next/image'

import '../../app/(frontend)/styles/blocks/photo-frieze.css'

/**
 * PhotoFrieze — a kezdőlapi alapítók-szekció (About, `kc-about--founders`)
 * képi fele: négy íves csapatfotó-csík. NEM önálló szekció: a Rólunk-blokk
 * rácsában áll, a szöveghasáb mellett (desktop, 2×2 ív) vagy fölött (mobil,
 * egy sor három ív). A bekötés: About.tsx (`frieze` prop), a RenderBlocks
 * `about` ága adja a jelet, ha a blokk a filmsáv után áll.
 *
 * MIÉRT EGY SZEKCIÓ A FRÍZ ÉS A BEMUTATKOZÁS (WP11, tulajdonosi kérés,
 * 2026-09-07: „az alapítók és a fölső mozgó 4 kép mehetne egybe"). A fríz
 * 2026-09-07 reggelig a FilmHero testvéreként, külön `<section>`-ként állt,
 * alatta pedig külön About-szekció ismételte ugyanazt a tartalmat (a két
 * gyógytornász arca és neve). Az NN/g közös-régió elve szerint ami egy
 * határon belül áll, azt egy egységnek olvassák („items within a boundary
 * are perceived as a group"), és a határ erősebb jel, mint a közelség; két
 * szekcióhatár tehát két külön témát ígért ugyanarra a tartalomra. Ezért a
 * fotók és a szöveg most EGY régióban, EGY H2 alatt állnak (WCAG 2.2 SC
 * 2.4.6: a címsor a szakasz témáját nevezi meg; a szekció `aria-labelledby`
 * a H2-re mutat), a páros CMS-fotó pedig a jobb hasábból kimarad, mert a
 * fríz már mutatja ugyanazt a két arcot.
 *   NN/g, The Principle of Common Region:
 *   https://www.nngroup.com/articles/common-region/
 *   NN/g, „About Us" Information on Websites (a valódi, ember-arcú
 *   bemutatkozás bizalmi elem; a látogató a vezetőket keresi):
 *   https://www.nngroup.com/articles/about-us-information-on-websites/
 *   WCAG 2.2 SC 2.4.6 Headings and Labels:
 *   https://www.w3.org/WAI/WCAG22/Understanding/headings-and-labels.html
 *
 * MIÉRT VALÓDI ARCOK ÉS NEM ILLUSZTRÁCIÓ. Az NN/g szemkamerás mérése szerint a
 * felhasználók a VALÓDI munkatársak portréit vizsgálják (10%-kal több időt
 * töltöttek a portrékon, mint a 316%-kal nagyobb helyet foglaló életrajzon),
 * a stockfotós modelleket viszont átugorják. Ezért a fríz kizárólag a két
 * gyógytornász saját, ellenőrzött eredetű fotóit viszi (public/media/team,
 * manifest.json), és a mellette álló H2 megnevezi őket.
 *   NN/g, Photos as Web Content:
 *   https://www.nngroup.com/articles/photos-as-web-content/
 *
 * DOM-SORREND. A fríz a rácsban a szöveg ELŐTT áll (mobilon így a fotósor
 * nyitja a szekciót, desktopon a rács a jobb hasábba helyezi). A WCAG 2.2 SC
 * 1.3.2 szerint a lineáris sorrend csak ott kötött, ahol a jelentést
 * befolyásolja („Providing a particular linear order is only required where
 * it affects meaning"); a portrésor és a bemutatkozó szöveg egymáshoz képesti
 * sorrendje nem változtat a jelentésen, fókuszálható elem nincs a frízben.
 *   https://www.w3.org/WAI/WCAG22/Understanding/meaningful-sequence.html
 *
 * MOZGÁS. A csíkok belépője (clip-path) és a halk görgetés-parallax
 * DEKORATÍV, mind kikapcsol `prefers-reduced-motion: reduce` alatt (WCAG 2.2
 * SC 2.3.3). A korábbi hover-nyúlás (flex 1 → 1,6) a 2×2-es rácsban
 * értelmét vesztette (egy soros, teljes szélességű frízre volt szabva), ezért
 * kikerült. Részletek a photo-frieze.css fejlécében.
 *   https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html
 *   https://developer.apple.com/design/human-interface-guidelines/motion
 *
 * A FOTÓLISTA KÓDBAN ÉL, ahogy a filmsáv feliratai is (FilmHero.tsx,
 * CAPTION_*): a CMS-séma nem bővül, migráció nincs. Az alt a manifest.json
 * ellenőrzött szövege.
 *
 * MIÉRT next/image ÉS NEM SIMA <img>. A forrásfájlok 1600 px szélesek, egy
 * ív viszont ~306 px (1440-en, a jobb fél hasáb fele). A next/image a
 * `sizes` alapján w-leírós srcsetet ad, tehát a böngésző az ívhez mért
 * változatot tölti. A repó MediaImage-je Media-dokumentumra épül, statikus
 * public-fájlra nem alkalmazható, ezért közvetlenül a next/image-et hívjuk.
 */

interface FriezePhoto {
  /** public/media/team-beli fájl (manifest.json). */
  file: string
  /** A manifest ellenőrzött alt-szövege. */
  alt: string
  width: number
  height: number
}

/**
 * A négy ív sorrendje (desktopon 2×2: bal-fönt, jobb-fönt, bal-lent,
 * jobb-lent): nyitó páros portré, álló portré, kézkezelés részlet (szakmai
 * tartalom), álló portré.
 *
 * A NYITÓ PÁROS FOTÓ VÁLASZTÁSA MÉRT. A `founders-standing-blazers` álló
 * (1600×1815), a két arc középpontja a szélesség 32%-án és 60%-án áll. A
 * 2×2-es ívben a csempe SZÉLESEBB, mint amilyen magas (1440 px: 306×272;
 * 1024 px: 215×272), ezért az `object-fit: cover` a kép TELJES szélességét
 * mutatja, csak függőlegesen vág (object-position 50% 20%): mindkét arc
 * minden desktop szélességen a csempében van. Mobilon (< 900 px) a sor
 * három álló csíkból áll (100 px-es csíkban a fekvőbb páros fotónak csak a
 * 36%-a látszana, a bal arc elvágva), ezért ott ez a csík ELMARAD
 * (photo-frieze.css). A `founders-intro-white` fekvő párost a CMS
 * Rólunk-fotója viszi (/rolunk); a kezdőlapon a fríz miatt nem ismétlődik.
 */
const PHOTOS: readonly FriezePhoto[] = [
  {
    file: 'founders-standing-blazers-1600.webp',
    alt: 'A Kineticare alapítói közös portrén.',
    width: 1600,
    height: 1815,
  },
  {
    file: 'portrait-standing-navy-portrait-1600.webp',
    alt: 'A Kineticare egyik alapítójának portréja.',
    width: 1600,
    height: 2000,
  },
  {
    file: 'hand-treatment-detail-1600.webp',
    alt: 'Gyógytornász kézzel végzett kezelés közben.',
    width: 1600,
    height: 2400,
  },
  {
    file: 'portrait-standing-white-blazer-portrait-1600.webp',
    alt: 'A Kineticare egyik alapítójának portréja.',
    width: 1600,
    height: 2000,
  },
]

const TEAM_DIR = '/media/team/'

/**
 * Az ív valós szélessége: a rács jobb hasábjának fele, 1440-en ~306 px,
 * 1024-en ~215 px (a hasáb 24 vw körül); 900 px alatt három csík osztja a
 * tábla-hasábot (~33vw). A 320 px-es felső érték 1x-en a 384-es lépcsőt
 * kéri, 2x-en a 640-est.
 */
const SIZES = '(min-width: 1200px) 320px, (min-width: 900px) 24vw, 33vw'

type StripStyle = CSSProperties & Record<'--kc-frieze-i', string>

/**
 * A fríz `figure`, nem `section`: a szekció-szerepet és a nevet a befogadó
 * About-blokk viseli (egy régió, egy H2). Felirat (figcaption) nincs: a
 * H2 és az eyebrow nevezi meg a képeken látható két gyógytornászt.
 */
export function PhotoFrieze() {
  return (
    <figure className="kc-photo-frieze">
      <ul className="kc-photo-frieze__strips">
        {PHOTOS.map((photo, index) => {
          // A belépő lépcsőzése (80 ms × index) a CSS-ben él; itt csak az index.
          const style: StripStyle = { '--kc-frieze-i': String(index) }
          return (
            <li className="kc-photo-frieze__strip" key={photo.file} style={style}>
              <Image
                alt={photo.alt}
                className="kc-photo-frieze__img"
                decoding="async"
                height={photo.height}
                // Az első ív azonnal tölt (a szekció a film után az első
                // álló kép), a többi lusta. A next/image az `eager`-re is
                // <link rel="preload">-ot ír (a `sizes` szerinti kis
                // változatra); a filmsáv posztere viszi a fetchpriority=
                // "high"-t, tehát az LCP-t nem előzi meg — ezért marad az
                // eager, `priority` nélkül. Ha az LCP mérten lassul, ez az
                // első hely, ahol `lazy`-re kell váltani.
                loading={index === 0 ? 'eager' : 'lazy'}
                sizes={SIZES}
                src={`${TEAM_DIR}${photo.file}`}
                width={photo.width}
              />
            </li>
          )
        })}
      </ul>
    </figure>
  )
}
