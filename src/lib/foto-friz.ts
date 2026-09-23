/**
 * A kezdőlapi mozgó fotósor (PhotoFrieze) négy BEÉPÍTETT fotója. Külön,
 * CSS- és React-mentes modulban él, hogy a blokk-séma (src/blocks/about.ts)
 * a mezők súgójában megnevezhesse, melyik fotó áll az üres helyen.
 */

export interface FriezePhoto {
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
export const FRIEZE_PHOTOS: readonly FriezePhoto[] = [
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
