import type { ReactElement } from 'react'

import {
  BARION_PIXEL_SCRIPT_SRC,
  barionPixelNoscriptUrl,
  getBarionPixelId,
} from '@/lib/analytics/barion-pixel'

/**
 * Az ALAP (Base) Barion Pixel beillesztése.
 * kifejezetten kiköti, hogy a süti-hozzájárulás kezelője NE nyúljon hozzá:
 */

/**
 * A hivatalos alap-snippet, a beépített azonosítóval.
 * ELTÉRÉS A DOKSI SZÖVEGÉTŐL, KÉT PONTON — mindkettő a viselkedést nem
 * érinti, csak a mellékhatásokat szünteti meg:
 * snippetje deklaráció nélkül használja őket, ami implicit globálist hoz
 * létre — laza módban nem hiba, de két véletlen globális a mi oldalunkon).
 * A `window["bp"]` sorbaállító, a `window["barion_pixel_id"]` és a záró
 */
function baseBarionPixelSnippet(pixelId: string): string {
  return `(function () {
  window["bp"] = window["bp"] || function () {
    (window["bp"].q = window["bp"].q || []).push(arguments);
  };
  window["bp"].l = 1 * new Date();
  var scriptElement = document.createElement("script");
  var firstScript = document.getElementsByTagName("script")[0];
  scriptElement.async = true;
  scriptElement.src = "${BARION_PIXEL_SCRIPT_SRC}";
  firstScript.parentNode.insertBefore(scriptElement, firstScript);
  window["barion_pixel_id"] = "${pixelId}";
  bp("init", "addBarionPixelId", window["barion_pixel_id"]);
})();`
}

/**
 * Az alap Pixel snippetje. A `<head>` LEGELSŐ eleme a helye (layout.tsx).
 *
 * FIGYELEM: ide sem consent-ellenőrzés, sem `'use client'` nem kerülhet —
 * lásd a fájl fejlécét és a barion-pixel.ts indoklását. Az őr-teszt
 * (src/__tests__/barion-pixel-alap.test.ts) ezt a fájlt is figyeli.
 */
export function BarionPixel(): ReactElement | null {
  const pixelId = getBarionPixelId()
  if (pixelId === null) {
    return null
  }
  return (
    <script
      // A tartalom saját, a build-be fordított kód; a beillesztett azonosító
      // alakra ellenőrzött. Külső, felhasználói adat NEM kerül bele.
      dangerouslySetInnerHTML={{ __html: baseBarionPixelSnippet(pixelId) }}
    />
  )
}

/**
 * A JS nélküli tartalék-képpont.
 *
 * A doksi a snippet UTÁN, a `<head>`-be írja, de a `<noscript>` a `<head>`-ben
 * csak `link`/`style`/`meta` elemet tartalmazhat: egy `<img>` ott érvénytelen,
 * és a böngésző elemzője úgyis a `<body>`-ba sodorná. Ezért a `<body>` VÉGÉN
 * áll — a mérésre ez nincs hatással (rejtett 1×1-es kép), viszont így nem
 * kerül a „Ugrás a tartalomra” ugrólink elé sem, vagyis JS nélkül sem tolakszik
 * a képernyőolvasó elé a lap legelején.
 */
export function BarionPixelNoscript(): ReactElement | null {
  const pixelId = getBarionPixelId()
  if (pixelId === null) {
    return null
  }
  return (
    <noscript>
      {/* eslint-disable-next-line @next/next/no-img-element -- mérőpont, nem tartalmi kép: a next/image itt értelmetlen (1×1, rejtett, külső host). */}
      <img
        alt="Barion Pixel"
        height="1"
        src={barionPixelNoscriptUrl(pixelId)}
        style={{ display: 'none' }}
        width="1"
      />
    </noscript>
  )
}
