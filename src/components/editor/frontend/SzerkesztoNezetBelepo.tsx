'use client'

import { usePathname } from 'next/navigation'

import { szerkesztoNezetCel, szerkesztoNezetHref } from './szerkeszto-nezet-cel'

/**
 * A publikált nézet szerkesztői belépője („Szerkesztő nézet”), a fejléc fölött.
 *
 * KINEK. Csak a bejelentkezett staff/owner kapja: a Header.tsx a fejléc MÁR
 * meglévő hitelesítési hívásából (header-user.ts `szerkeszto` bit) dönt, és
 * a komponenst CSAK a jogosult ágban rendereli. A látogató és a vásárló
 * RSC-adatában így nincs rá hivatkozás, és új kérés sem indul érte. A
 * jogosultságot a `/next/preview` route ellenőrzi (staff/owner-kapu): ez a
 * link csak megjelenítés.
 *
 * MIT CSINÁL. Az aktuális lap piszkozat-előnézetét nyitja meg ugyanazon az
 * útvonalon (`/next/preview?collection=…&slug=…`), ahol szekciónként
 * „Szerkesztem” szalag áll. Sima `<a>`, nem next/link: a route a draft-sütit
 * állítja be, az előtöltés ezt kérés nélkül is bekapcsolná (Next.js,
 * draftMode: „you must pass prefetch={false} to prevent accidentally deleting
 * the cookie on prefetch”, https://nextjs.org/docs/app/api-reference/functions/draft-mode).
 * Kódbeli útvonalon (pl. /kurzusaim) nem jelenik meg.
 *
 * A NÉV. „Szerkesztő nézet”: azt mondja meg, mi van a link túloldalán (NN/g,
 * Better Link Labels: „A link's primary purpose is to communicate to users
 * what they'll find on the other side of a click.”,
 * https://www.nngroup.com/articles/better-link-labels/). A „Szerkesztem” ige
 * itt nem lenne igaz, mert a link nem az adminba visz, hanem az előnézetbe;
 * a „Szerkesztem” a szalagok szava. A sáv szövege kimondja, hogy a látogató
 * nem látja (rendszerállapot, NN/g Visibility of System Status).
 *
 * ELHELYEZÉS. A WordPress eszköztárának mintája: sáv a lap fölött („an area
 * of the screen just above the site”, https://wordpress.org/documentation/article/toolbar/).
 * A fejléc-sávba nem fér: 320 px-en ott 39,5 px a tartalék (layout.css), egy
 * 44 px-es cél és a köze nem férne el, a WCAG 2.2 SC 1.4.10 pedig 320 px-en
 * is megköveteli a funkciót. A sáv nem ragad, így a ragadós fejléc
 * magasságát és a horgony-görgetést sem változtatja.
 */

/** A belépő látható felirata. */
export const SZERKESZTO_NEZET_FELIRAT = 'Szerkesztő nézet'

/** A sáv magyarázó szövege. */
export const SZERKESZTO_NEZET_SZOVEG = 'Ezt a sávot csak a szerkesztők látják.'

/** A link vizuálisan rejtett folytatása (WCAG 2.2 SC 2.4.4; a név a látható szóval kezdődik, SC 2.5.3). */
export const SZERKESZTO_NEZET_KONTEXTUS =
  ': ennek a lapnak a piszkozata, szekciónként Szerkesztem linkkel'

export function SzerkesztoNezetBelepo() {
  const pathname = usePathname()
  const cel = szerkesztoNezetCel(pathname ?? '')
  if (cel === null) {
    return null
  }
  return (
    <div className="kc-szerkeszto-nezet">
      <div className="kc-container kc-szerkeszto-nezet__belso">
        <p className="kc-szerkeszto-nezet__szoveg">{SZERKESZTO_NEZET_SZOVEG}</p>
        <a className="kc-szerkeszto-nezet__link" href={szerkesztoNezetHref(cel)}>
          {SZERKESZTO_NEZET_FELIRAT}
          <span className="kc-visually-hidden">{SZERKESZTO_NEZET_KONTEXTUS}</span>
        </a>
      </div>
    </div>
  )
}
