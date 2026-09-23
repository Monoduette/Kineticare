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
 * kikerült; a WP18 hover-nagyítást (scale 1,03) a tulajdonos vetette el
 * (WP24). A hover most a csempe SAJÁT élét alakítja: a felső sor íve lapul,
 * az alsó sor hulláma mélyül. Részletek a photo-frieze.css fejlécében.
 *   https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html
 *   https://developer.apple.com/design/human-interface-guidelines/motion
 *
 * A FOTÓLISTA KÓDBAN ÉL, ahogy a filmsáv feliratai is (FilmHero.tsx,
 * CAPTION_*): a CMS-séma nem bővül, migráció nincs. Az alt a manifest.json
 * ellenőrzött szövege.
 *
 * MIÉRT next/image ÉS NEM SIMA <img>. A forrásfájlok 1388–1600 px szélesek,
 * egy ív viszont ~306 px (1440-en, a jobb fél hasáb fele). A next/image a
 * `sizes` alapján w-leírós srcsetet ad, tehát a böngésző az ívhez mért
 * változatot tölti. A repó MediaImage-je Media-dokumentumra épül, statikus
 * public-fájlra nem alkalmazható, ezért közvetlenül a next/image-et hívjuk.
 */

interface FriezePhoto {
  /** public/media/team-beli fájl (manifest.json). */
  file: string
  /** A manifest ellenőrzött alt-szövege. */
  alt: string
  /** A fájl valós pixelmérete (a manifesttel és a fájllal egyezik, őr-teszt). */
  width: number
  height: number
  /**
   * Az ív saját vágása (`object-position`, a csík `--kc-frieze-focus`
   * változójaként; photo-frieze.css). A kép lényegének mért helyéből jön,
   * lásd a `PHOTOS` kommentjét.
   */
  objectPosition: string
}

/**
 * A négy ív sorrendje (desktopon 2×2: bal-fönt, jobb-fönt, bal-lent,
 * jobb-lent). 2026-09-22, tulajdonosi kérés: a két alapító közös képe, majd
 * három, a szakmát mutató felvétel a fotózásból (kéz-anatómia táblagépen,
 * goniométeres mérés), végül a két alapító együtt dolgozva. Az NN/g szerint a
 * látogató a valódi munkatársat és a feladathoz tartozó, információt hordozó
 * képet nézi meg, a díszítő portrét átugorja
 * (https://www.nngroup.com/articles/photos-as-web-content/); a korábbi négyes
 * két szóló portréja („A Kineticare egyik alapítójának portréja") helyére
 * ezért kerül tevékenység. A fájlok a Drive eredetijeiből készültek,
 * felskálázás nélkül (manifest.json: forrás, sha256, méret).
 *
 * MÉRT KERETEK (élő oldal, Chromium, 2026-09-22). A csík mérete és benne a
 * kép dobozáé (115% magas, a parallax tartaléka), CSS px-ben:
 *   1440: 306×296 (kép 306×341)   1200: 251×337 (kép 251×388)
 *   1024: 215×272 (kép 215×313)    900: 187×272 (kép 187×313)
 *    390: 101×288 (kép 101×331)    320:  77×288 (kép  77×331)
 * 900 px alatt az 1. ív elmarad (photo-frieze.css). A látható sáv
 * forráspixelben, nyugalmi helyzetben:
 *
 *  1. founders-white-turtleneck (1600×2000), 50% 20%: 1440-en a teljes
 *     szélesség és y 44–1593; 1200-on x 152–1448, 1024-en x 112–1488,
 *     900-on x 202–1398. A két arc x 243–1333 között van, így minden asztali
 *     szélességen mindkettő egész. Mobilon a 101 px-es csíkban a kép 38%-a
 *     (608 px) látszana, a két arc együtt 1090 px széles, ezért ott nem fér
 *     el: ez a csík mobilon elmarad.
 *  2. tablet-forearm-anatomy (1600×2400), 50% 20%: 1440-en y 124–1673, a
 *     táblagép y 210–1650 között van; 390-en x 435–1165, benne a képernyőn
 *     látható alkar és a toll.
 *  3. goniometer-elbow-measure (1388×2082), 78% 72%: a _MG_0041 2:3-as
 *     kivágása 1:1-ben, átméretezés nélkül (forrásban x 1400–2788,
 *     y 150–2232). A páciens copfja (forrásban x ≤ ~1385) és a kezelő haja
 *     (x ≥ ~2788) így kívül esik: a korábbi, x 1060-tól induló vágásban a
 *     copf vége asztali szélességen a csempe bal alsó sarkában látszott. A
 *     lényeg a mérőkorong (x 815–1105, y 1243–1528), a felső kéz (x 130–1200,
 *     a teteje y 411) és az alsó kéz hüvelykujja (x 725–830). 1440-en
 *     y 385–1730: a felső kéz egésze és a korong bent. 1200-on és 900-on
 *     y 0–1810, 1024-en y 44–1800. 390-en x 587–1220, 320-on x 705–1191: a
 *     korong és a hüvelykujj mindenhol egész, a felső kéz minden ablakon
 *     átfut. Az alapértelmezett 50% 20% mobilon a korongot kettévágná
 *     (390-en x 378–1011, 320-on x 451–937).
 *  4. founders-working-laptop (1600×2400), 55% 20%: a két arc bőrének széle
 *     x ≈ 575 és x ≈ 1130 (szemmagasságban mérve). 390-en x 479–1208, mindkét
 *     arc a hajjal együtt bent; 320-on x 572–1132, a 560 px-es sávba a 555 px
 *     széles arcpár éppen belefér, ez a legkedvezőbb érték. 50%-on 390-en a
 *     jobb arc csak 35 px-re lenne a széltől, 320-on (x 520–1080) levágódna.
 *
 * A vágás az `object-position`-nel történik, a százalék a `background-
 * position` szerint oldódik fel (W3C CSS Images 3:
 * https://www.w3.org/TR/css-images-3/#the-object-position). A korábbi
 * `founders-intro-white` fekvő párost a CMS Rólunk-fotója viszi (/rolunk); a
 * kezdőlapon a fríz miatt nem ismétlődik.
 */
const PHOTOS: readonly FriezePhoto[] = [
  {
    file: 'founders-white-turtleneck-1600.webp',
    alt: 'Kiss Kata és Kocsis Kata fehér garbóban.',
    width: 1600,
    height: 2000,
    objectPosition: '50% 20%',
  },
  {
    file: 'tablet-forearm-anatomy-1600.webp',
    alt: 'Az alkar izmai táblagépen, a gyógytornász tollal mutat rájuk.',
    width: 1600,
    height: 2400,
    objectPosition: '50% 20%',
  },
  {
    file: 'goniometer-elbow-measure-1388.webp',
    alt: 'A gyógytornász goniométerrel méri a fekvő páciens könyökének mozgástartományát.',
    width: 1388,
    height: 2082,
    objectPosition: '78% 72%',
  },
  {
    file: 'founders-working-laptop-1600.webp',
    alt: 'A Kineticare alapítói együtt dolgoznak egy laptopnál.',
    width: 1600,
    height: 2400,
    objectPosition: '55% 20%',
  },
]

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
          // A belépő lépcsőzése (80 ms × index) a CSS-ben él; itt csak az index
          // és az ív saját vágása (`object-position`, a kép tulajdonsága).
          const style: StripStyle = {
            '--kc-frieze-i': String(index),
            '--kc-frieze-focus': photo.objectPosition,
          }
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
