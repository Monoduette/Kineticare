import type { MouseEvent } from 'react'

/**
 * Helyben ugrás a szerkesztőn belül: ugyanazon oldal szerkesztőjének másik
 * szekciójára (`?szekcio=<blokk-azonosító>`) mutató link újratöltés nélkül.
 *
 * MIÉRT. A rejtett szekció tájékoztatója a látható ikerre mutat (modul-térkép
 * H02). Sima linkkel a böngésző a teljes szerkesztőt újratöltené, és a még
 * nem mentett gépelés elveszhetne. A Next.js App Router a natív History API-t
 * a saját routerébe köti: Next.js, Linking and Navigating, „Using the native
 * History API”: „Next.js allows you to use the native window.history.pushState
 * and window.history.replaceState methods to update the browser's history
 * stack without reloading the page. pushState and replaceState calls integrate
 * into the Next.js Router, allowing you to sync with usePathname and
 * useSearchParams.”
 * (https://nextjs.org/docs/app/getting-started/linking-and-navigating#native-history-api).
 * A `pushState` után tehát a `useSearchParams` az új `szekcio` értéket adja,
 * a SzekcioMegnyito (src/components/editor/admin/SzekcioMegnyito.tsx) hatása
 * újra lefut, és kinyitja az iker szekcióját; az űrlap állapota a helyén marad.
 *
 * MIKOR NEM. A link igazi `<a href>` marad, így minden más a böngésző
 * alapviselkedése: módosító billentyűs (Ctrl, Meta, Shift, Alt) vagy nem bal
 * gombos kattintás (új lap, új ablak, letöltés), `target` attribútumos link,
 * és más oldalra (más pathname) mutató cím. A felhasználó így dönthet úgy,
 * hogy új lapon nyitja (NN/g, Opening Links in New Browser Windows and Tabs:
 * a döntés a felhasználóé, https://www.nngroup.com/articles/new-browser-windows-and-tabs/;
 * WCAG 2.2 SC 3.2.5 Change on Request: a kontextusváltás a felhasználó
 * kérésére történik, https://www.w3.org/WAI/WCAG22/Understanding/change-on-request.html).
 * A `pushState` új előzmény-bejegyzést ad, így a Vissza gomb az előző
 * szekcióhoz visz vissza.
 */
export function helybenUgras(esemeny: MouseEvent<HTMLAnchorElement>): void {
  if (
    esemeny.defaultPrevented ||
    esemeny.button !== 0 ||
    esemeny.metaKey ||
    esemeny.ctrlKey ||
    esemeny.shiftKey ||
    esemeny.altKey
  ) {
    return
  }
  const link = esemeny.currentTarget
  const target = link.getAttribute('target')
  if (target !== null && target !== '' && target !== '_self') {
    return
  }
  const href = link.getAttribute('href')
  if (href === null || href === '') {
    return
  }
  let cel: URL
  try {
    cel = new URL(href, window.location.href)
  } catch {
    return
  }
  if (cel.origin !== window.location.origin || cel.pathname !== window.location.pathname) {
    return
  }
  esemeny.preventDefault()
  window.history.pushState(null, '', href)
}
