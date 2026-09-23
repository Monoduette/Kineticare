import type { CSSProperties } from 'react'
import Image from 'next/image'

import { FRIEZE_PHOTOS } from '../../lib/foto-friz'
import { fokuszPozicio, kepHelyMedia } from '../../lib/kep-helyek'
import { MediaImage } from '../content/MediaImage'

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
 * kikerült; a WP18 hover-nagyítást (scale 1,03) a tulajdonos vetette el
 * (WP24). A hover most a csempe SAJÁT élét alakítja: a felső sor íve lapul,
 * az alsó sor hulláma mélyül. Részletek a photo-frieze.css fejlécében.
 *   https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html
 *   https://developer.apple.com/design/human-interface-guidelines/motion
 *
 * A FOTÓK HELYENKÉNT CSERÉLHETŐK (2026-09-23, tulajdonosi kérés: minden
 * modul külön szerkeszthető az adminban). A Bemutatkozás blokk „Mozgó
 * fotósor” csoportjának négy mezője a négy ívnek felel meg; az üres helyen a
 * beépített fotó áll (src/lib/foto-friz.ts), a kitöltött hely a CMS-képet
 * mutatja a fókuszpontja szerinti kivágással (src/lib/kep-helyek.ts). Üres
 * mezőkkel a kimenet a korábbival bájtra azonos.
 *
 * MIÉRT next/image ÉS NEM SIMA <img>. A forrásfájlok 1388–1600 px szélesek,
 * egy ív viszont ~306 px (1440-en, a jobb fél hasáb fele). A next/image a
 * `sizes` alapján w-leírós srcsetet ad, tehát a böngésző az ívhez mért
 * változatot tölti. A repó MediaImage-je Media-dokumentumra épül, statikus
 * public-fájlra nem alkalmazható, ezért közvetlenül a next/image-et hívjuk.
 */

const TEAM_DIR = '/media/team/'

/**
 * A kép KIRAJZOLT szélessége (nem a csíké): a böngésző ebből és a w-leírós
 * srcsetből választ változatot (MDN, img `sizes`: „The width descriptor is
 * divided by the source size given in the sizes attribute to calculate the
 * effective pixel density", és a méret matematikai függvény is lehet:
 * https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/img).
 *  - Asztalon a rács jobb hasábjának fele: 1440-en ~306 px, 1024-en ~215 px
 *    (a hasáb 24 vw körül). A 320 px-es felső érték 1x-en a 384-es lépcsőt
 *    kéri, 2x-en a 640-est.
 *  - 900 px alatt három keskeny csík áll (390-en 101, 320-on 77 px), de a
 *    kép doboza 18rem × 115% = 20,7rem magas, és a `cover` MAGASSÁGRA
 *    illeszt: a 2:3-as fotó 20,7rem × 2/3 = 13,8rem (221 px) széles
 *    tartalommal rajzolódik ki, a csík ebből csak a középső sávot mutatja. A
 *    korábbi puszta 33vw 390-en 129 px-et mondott, ezért a böngésző DPR 2-n a
 *    384-es, DPR 3-on a 640-es változatot töltötte, és a 442, illetve 662
 *    eszközpixelre 1,15-szörösére, illetve 1,04-szeresére nagyította (élő
 *    oldalon mérve, 2026-09-22). A `max()` a szélesebb mobil csíkot (899 px-en
 *    ~290 px) is lefedi.
 */
const SIZES = '(min-width: 1200px) 320px, (min-width: 900px) 24vw, max(33vw, 13.8rem)'

type StripStyle = CSSProperties & Record<'--kc-frieze-i' | '--kc-frieze-focus', string>

export interface PhotoFriezeProps {
  /**
   * A négy hely CMS-értéke sorrendben (a blokk `frieze.photo1…photo4`
   * mezője). Hiányzó vagy üres helyen a beépített fotó áll.
   */
  photos?: readonly unknown[]
}

/**
 * A fríz `figure`, nem `section`: a szekció-szerepet és a nevet a befogadó
 * About-blokk viseli (egy régió, egy H2). Felirat (figcaption) nincs: a
 * H2 és az eyebrow nevezi meg a képeken látható két gyógytornászt.
 */
export function PhotoFrieze({ photos = [] }: PhotoFriezeProps) {
  return (
    <figure className="kc-photo-frieze">
      <ul className="kc-photo-frieze__strips">
        {FRIEZE_PHOTOS.map((photo, index) => {
          const media = kepHelyMedia(photos[index])
          // A belépő lépcsőzése (80 ms × index) a CSS-ben él; itt csak az index
          // és az ív saját vágása (`object-position`, a kép tulajdonsága).
          const style: StripStyle = {
            '--kc-frieze-i': String(index),
            '--kc-frieze-focus': media ? fokuszPozicio(media) : photo.objectPosition,
          }
          return (
            <li className="kc-photo-frieze__strip" key={index} style={style}>
              {media ? (
                <MediaImage
                  className="kc-photo-frieze__img"
                  media={media}
                  preferredSize="md"
                  sizes={SIZES}
                />
              ) : (
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
              )}
            </li>
          )
        })}
      </ul>
    </figure>
  )
}
