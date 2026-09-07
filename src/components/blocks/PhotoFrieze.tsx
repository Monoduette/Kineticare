import type { CSSProperties } from 'react'
import Image from 'next/image'

import '../../app/(frontend)/styles/blocks/photo-frieze.css'

/**
 * PhotoFrieze — a kezdőlap filmsávja UTÁN álló, négy csíkos csapatfotó-fríz.
 *
 * MIÉRT VAN (tulajdonosi kérés, 2026-09-07): Kiss Kata és Kocsis Kata azt
 * kérte, hogy az oldal elején SAJÁT fotó fogadja a látogatót, és több saját
 * fotó legyen a lapon. A vezető döntése: az egykezes film marad legfelül, a
 * fotó közvetlenül alatta. A forma a tulajdonos által kedvelt referencia
 * („image-frieze": négy magas képcsík, a párosak felül félkör-ívvel) átültetése
 * a Kineticare tokenjeire — a színt és a betűt NEM vesszük át.
 *
 * MIÉRT VALÓDI ARCOK ÉS NEM ILLUSZTRÁCIÓ. Az NN/g szemkamerás mérése szerint a
 * felhasználók a VALÓDI munkatársak portréit vizsgálják (10%-kal több időt
 * töltöttek a portrékon, mint a 316%-kal nagyobb helyet foglaló életrajzon),
 * a stockfotós modelleket viszont átugorják; a „feldobó" dekorációt pedig
 * figyelmen kívül hagyják. Ezért a fríz kizárólag a két gyógytornász saját,
 * ellenőrzött eredetű fotóit viszi (public/media/team, manifest.json), és a
 * felirat MEGNEVEZI őket — a kép így tartalom, nem díszítés.
 *   NN/g, Photos as Web Content:
 *   https://www.nngroup.com/articles/photos-as-web-content/
 *   NN/g, Decorative Images: Delightful or Dreadful?:
 *   https://www.nngroup.com/videos/decorative-images/
 *
 * MOZGÁS. A csíkok belépője (clip-path), a hover-nyúlás és a halk
 * görgetés-parallax mind DEKORATÍV: információt nem hordoz, ezért mind
 * kikapcsol `prefers-reduced-motion: reduce` alatt (WCAG 2.2 SC 2.3.3
 * Animation from Interactions: az interakcióra induló, nem lényegi mozgás
 * legyen kikapcsolható; a parallaxot az Understanding-dokumentum név szerint
 * ilyennek nevezi), és az Apple HIG Motion elve szerint rövid, célzott és
 * elhagyható. Részletek és a CSS-források a photo-frieze.css fejlécében.
 *   https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html
 *   https://developer.apple.com/design/human-interface-guidelines/motion
 *
 * A FOTÓLISTA KÓDBAN ÉL, ahogy a filmsáv feliratai is (FilmHero.tsx,
 * CAPTION_*): a CMS-séma nem bővül, migráció nincs. Az alt a manifest.json
 * ellenőrzött szövege.
 *
 * MIÉRT next/image ÉS NEM SIMA <img>. A forrásfájlok 1600 px szélesek, a csík
 * viszont ~260 px (1440-en; hover-nyúlva ~380). A next/image a `sizes`
 * alapján w-leírós srcsetet ad a beépített optimalizálóból, tehát a böngésző
 * a csíkhoz mért változatot tölti, nem a 1600-ast. A repó MediaImage-je a
 * Media-collection dokumentumaira épül (sizes-alréteg), statikus public-fájlra
 * nem alkalmazható, ezért közvetlenül a next/image-et hívjuk, ugyanazzal a
 * width/height/sizes szerződéssel.
 */

interface FriezePhoto {
  /** public/media/team-beli fájl (manifest.json). */
  file: string
  /** A manifest ellenőrzött alt-szövege. */
  alt: string
  width: number
  height: number
  /** Csak ott, ahol a vágat közepe nem a manifest szerinti alapérték. */
  objectPosition?: string
}

/**
 * A négy csík sorrendje: nyitó páros portré, álló portré, kézkezelés részlet
 * (szakmai tartalom), álló portré.
 *
 * A NYITÓ PÁROS FOTÓ VÁLASZTÁSA MÉRT (vezetői döntés, 2026-09-07). A
 * `founders-standing-blazers` álló (1600×1815), a két arc középpontja a
 * szélesség 32%-án és 60%-án áll (a forrásképen kimérve; a fekvő
 * `founders-intro-white`-ot a közvetlenül alatta álló Rólunk-szekció viszi,
 * ne ismétlődjön). Egy csík 115%-os magasítással ennyit mutat a kép
 * szélességéből, középre igazítva:
 *   1440 px, flex 1 (259×432): 59% → 20,5–79,5%: mindkét arc a csíkban;
 *   1024 px, flex 1 (235×320): 72% → 14–86%: mindkét arc a csíkban;
 *   390 px (106×288): 36% → 32–68%: a bal arc (26–39%) elvágva;
 *   320 px (82×288): 28%: egyetlen arc sem fér ki.
 * Ezért desktopon nincs külön vágat és nincs külön arány; mobilon (< 900 px)
 * ez a csík ELMARAD, és a három álló formátumú kép fut (photo-frieze.css).
 * NN/g: a valódi arcokat nézik — arc nélküli vágat a frízt dekorációvá tenné.
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
 * A csík valós szélessége: 1440-en ~260 px, hover-nyúlva (flex 1,6) ~380 px;
 * 900 px alatt három csík osztja a hasábot (~33vw). A 384 px-es felső érték a
 * hover-nyúlást is lefedi 1x-en, 2x-en a 828-as lépcsőt kéri.
 */
const SIZES = '(min-width: 1200px) 384px, (min-width: 900px) 27vw, 33vw'

/** A fríz feliratának két fele; nincs gondolatjel, nincs CTA. */
const NOTE_LEFT = 'Kiss Kata és Kocsis Kata, gyógytornászok'
const NOTE_RIGHT = 'Két rendelő Budapesten, és egy otthoni program.'

const FRIEZE_LABEL = 'Fotók a Kineticare gyógytornászairól'

type StripStyle = CSSProperties & Record<'--kc-frieze-i', string>

export function PhotoFrieze() {
  return (
    <section aria-label={FRIEZE_LABEL} className="kc-section kc-photo-frieze">
      <div className="kc-container kc-photo-frieze__inner">
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
                  // Az első csík azonnal tölt (a fríz a film után az első
                  // álló kép), a többi lusta. MÉRT MELLÉKHATÁS: a next/image
                  // az `eager`-re is <link rel="preload">-ot ír a fejlécbe
                  // (a `priority` ráadásul fetchpriority="high"-t is adna).
                  // A preload a `sizes` szerinti kis (w=384) változat, és a
                  // filmsáv posztere viszi a fetchpriority="high"-t, tehát az
                  // LCP-t nem előzi meg — ezért marad az eager, `priority`
                  // nélkül. Ha a lap tetején mérten lassul az LCP, ez az első
                  // hely, ahol `lazy`-re kell váltani.
                  loading={index === 0 ? 'eager' : 'lazy'}
                  sizes={SIZES}
                  src={`${TEAM_DIR}${photo.file}`}
                  style={photo.objectPosition ? { objectPosition: photo.objectPosition } : undefined}
                  width={photo.width}
                />
              </li>
            )
          })}
        </ul>
        <p className="kc-photo-frieze__note">
          <span className="kc-photo-frieze__note-start">{NOTE_LEFT}</span>
          <span className="kc-photo-frieze__note-end">{NOTE_RIGHT}</span>
        </p>
      </div>
    </section>
  )
}
