/**
 * Postacím → Google Térkép-link (a `tel-href.ts` párja).
 *
 * A megjelenített szöveg MARAD maga a cím (a vevő azt olvassa, amit a
 * levélre írna), a link viszont a Google Térkép keresőjét nyitja meg rá.
 *
 * MIÉRT `search`, ÉS NEM `dir`: a Google Maps URLs dokumentáció szerint a
 * `search` végpont a helyet mutatja meg a térképen, és onnan egy koppintással
 * indítható az útvonal; a `dir` végpont viszont azonnal útvonalat tervezne, és
 * ahhoz rögtön helymeghatározást kérne a látogatótól, mielőtt egyáltalán látná,
 * hova megy. A cím megnézése a kisebb, visszavonható lépés, ezért ez az
 * alapértelmezés. (Google, *Maps URLs — Get started*, „Search” és
 * „Directions” szakasz: https://developers.google.com/maps/documentation/urls/get-started)
 *
 * MIÉRT ÚJ LAPON: a Kapcsolat oldalon az időpontkérő űrlap kliens-oldali
 * React-state; a saját lapon való elnavigálás elvesztené a már beírt üzenetet.
 * Az ablaknyitást a WCAG 2.2 SC 3.2.5 (Change on Request) szerint előre jelezni
 * kell, ezért a link a képernyőolvasónak szóló rejtett toldatot kapja
 * (G201: https://www.w3.org/WAI/WCAG22/Techniques/general/G201; a `_blank`
 * mellé `rel="noopener noreferrer"`, MDN, *rel=noopener*:
 * https://developer.mozilla.org/en-US/docs/Web/HTML/Attributes/rel/noopener).
 *
 * MIÉRT KÖZÖS MODUL: két szekció jelenít meg rendelői címet CMS-mezőből (az
 * időpontkérő szekció és a rendelői árlista), és a SEO-gráf `hasMap` mezője
 * is ugyanezt a címet viszi. Ugyanaz a cím = ugyanaz a link mindenhol (WCAG
 * 2.2 SC 3.2.4, Consistent Identification:
 * https://www.w3.org/WAI/WCAG22/Understanding/consistent-identification.html).
 *
 * A séma KÓDBÓL épül, a szabad szöveg csak `encodeURIComponent`-en át kerül a
 * query-paraméterbe, ezért injektálható rész nem marad benne; a
 * `sanitizeCmsUrl` allowlistjén nem kell átmennie (az a szerkesztői webcím-
 * mezőket őrzi).
 */
export function mapsHref(cim: string): string | null {
  const trimmed = cim.trim()
  if (trimmed.length === 0) {
    return null
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(trimmed)}`
}

/**
 * A KÉPERNYŐOLVASÓNAK szóló toldat a címlink nevéhez: megnevezi, hova visz
 * (Google Térkép) és hogy új lapon nyílik. Rejtett (`kc-visually-hidden`),
 * ahogy a pénztár `TERMS_NEW_TAB_HINT`-je is: a látó vevőnek a cím maga a
 * felirat, a képernyőolvasó link-listájában viszont a puszta cím nem mondaná
 * meg, hogy a kattintás térképet nyit (WCAG 2.2 SC 2.4.4, Link Purpose:
 * https://www.w3.org/WAI/WCAG22/Understanding/link-purpose-in-context.html;
 * G200 + G201: https://www.w3.org/WAI/WCAG22/Techniques/general/G200).
 */
export const MAPS_LINK_HINT = ' (Google Térkép, új lapon nyílik)'
