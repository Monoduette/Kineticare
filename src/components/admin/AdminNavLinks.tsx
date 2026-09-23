'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth, useConfig } from '@payloadcms/ui'

import { hasStaffOrOwnerRole } from '../../access/roles'
import { HOME_PAGE_SLUG } from '../../lib/content-slugs'
import { SZERKESZTO_NEZET_FELIRAT } from '../editor/frontend/SzerkesztoNezetBelepo'
import { szerkesztoNezetCel, szerkesztoNezetHref } from '../editor/frontend/szerkeszto-nezet-cel'
import { ADMIN_UTAK, adminCim, type AdminUt } from './KezdolapCel'
import './AdminNavLinks.css'

/**
 * Az admin oldalsávjának saját menücsoportjai, a Payload collection-csoportjai
 * FÖLÖTT (admin.components.beforeNavLinks). A Payload a saját nézeteket nem
 * teszi be a navigációba, ezért ezeket nekünk kell kirajzolnunk.
 *
 * MIÉRT FELÜL ÉS KÉT CSOPORTBAN (admin-audit K32, K33):
 * - A három saját link (Statisztika, Videótár, Webanalitika) eddig az
 *   afterNavLinks helyen, a „Rendszer” csoport ALATT állt, egyenetlen
 *   térközzel (30 és 40 px), csoportcím és aktív-jelzés nélkül. A tulajdonos
 *   leggyakoribb oldala így a legritkábban kellő blokk alá került.
 * - „Leggyakrabban használt”: a kezdőlap és a videó szövegei. A kognitív séta
 *   9 feladatából 7 az Oldalakon át vezetett, köztük a tulajdonos fő kérése, a
 *   kezdőlap szövegeinek szerkesztése (admin-audit séta t1–t4, t6–t8). A csoport nem
 *   „Gyors elérés” nevet kapott, mert az NN/g mérése szerint a „Quicklinks”
 *   jellegű cím „is always a vague label”, és a gyakori elemeknek a „Most
 *   Frequently Used” típusú név való
 *   (https://www.nngroup.com/articles/quicklinks-label-intranet/).
 * - „Kimutatások és kurzusvideók”: a Statisztika, a Webanalitika és a
 *   Videótár. A cím kimondja, hogy a Videótár a KURZUSOK videóit tartja, így
 *   nem téveszthető össze a kezdőlapi videó szövegeivel (NN/g Menu-Design
 *   Checklist 7.: „Use clear, specific, and familiar wording”,
 *   https://www.nngroup.com/articles/menu-design/).
 *
 * AKTÍV ÁLLAPOT. A megnyitott saját nézet linkje `aria-current="page"`
 * jelölést és a Payload saját jelzősávját (`nav__link-indicator`) kapja, így
 * a helyzetet a képernyőolvasó és a szem is látja (NN/g 5. irányelv: „Indicate
 * the User's Current Location in the Menu”; docs/ui-sztenderdek.md N-4).
 *
 * SZERKESZTŐ NÉZET (modul-térkép H08/3). A „Leggyakrabban használt” csoport
 * harmadik linkje a kezdőlap piszkozat-előnézetét nyitja, ahol szekciónként
 * „Szerkesztem” szalag áll. Eddig ez csak a weboldal fejlécéből volt elérhető
 * (SzerkesztoNezetBelepo); az adminból a tulajdonos fő útja (a kezdőlap
 * szövegei) így egy kattintás. A felirat és a cél UGYANAZ, mint a weboldal
 * belépőjéé (SZERKESZTO_NEZET_FELIRAT, szerkesztoNezetHref): egy célra egy név
 * (WCAG 2.2 SC 3.2.4 Consistent Identification).
 * - Sima `<a>`, nem next/link: a /next/preview route draft-sütit állít, az
 *   előtöltés ezt kérés nélkül is bekapcsolná (Next.js, draftMode: „you must
 *   pass prefetch={false} to prevent accidentally deleting the cookie on
 *   prefetch”, https://nextjs.org/docs/app/api-reference/functions/draft-mode;
 *   lásd a SzerkesztoNezetBelepo fejkommentjét).
 * - Új lapon nyílik, mert a szerkesztő az előnézetet az admin mellett nézi, és
 *   ezt a látható szöveg előre mondja („(új lapon)”, a MEGNEZEM_FELIRAT
 *   mintájára). NN/g, Opening Links in New Browser Windows and Tabs: az új lap
 *   indokolt, ha a felhasználó egy folyamat közben nézne meg valamit, és „Use
 *   contextual messaging … to let users know about it before they click.”
 *   (https://www.nngroup.com/articles/new-browser-windows-and-tabs/); WCAG 2.2
 *   G201 technika: „Giving users advanced warning when opening a new window”
 *   (https://www.w3.org/WAI/WCAG22/Techniques/general/G201). A hozzáférhető név
 *   a látható felirattal kezdődik (SC 2.5.3 Label in Name). `rel="noopener"`:
 *   az új lap nem éri el ezt az ablakot (window.opener).
 * - `aria-current` erre a linkre nem vonatkozik: a cél nem admin-nézet, az
 *   oldalsáv sosem áll rajta.
 *
 * CSAK MEGJELENÍTÉS. A linkek elrejtése kozmetika: a védelem a nézetekben
 * van (szerepkör-kapu a lekérdezés előtt, src/__tests__/admin-nezet-kapu-kotes
 * és admin-kezdolap-utak tesztek); a Szerkesztő nézetét a /next/preview route
 * staff/owner-kapuja védi.
 */

/** Az adminon kívülre, új lapon nyíló menülink (pl. a szerkesztői előnézet). */
export interface AdminKulsoLink {
  felirat: string
  href: string
}

/** Egy menüpont: saját admin-nézet vagy új lapon nyíló külső link. */
export type AdminNavLink = AdminUt | AdminKulsoLink

/** A külső link látható utótagja: a szöveg mondja ki, hogy új lapon nyílik. */
export const UJ_LAPON = '(új lapon)'

/** Új lapon nyíló link-e (a saját nézeteknek `utvonal`-a van, a külsőnek `href`-je). */
export function kulsoLink(link: AdminNavLink): link is AdminKulsoLink {
  return 'href' in link
}

/**
 * A kezdőlap szerkesztői előnézete (`/next/preview?collection=pages&slug=kezdolap`),
 * ugyanazzal a leképezéssel, amit a weboldal belépője a `/` útvonalon használ.
 * A `/` leképezése rögzített (szerkeszto-nezet-cel.ts: `/` → pages / kezdolap),
 * a `??` csak a típus miatt áll itt.
 */
function kezdolapSzerkesztoNezetHref(): string {
  return szerkesztoNezetHref(
    szerkesztoNezetCel('/') ?? { collection: 'pages', slug: HOME_PAGE_SLUG },
  )
}

export const SZERKESZTO_NEZET_LINK: AdminKulsoLink = {
  felirat: SZERKESZTO_NEZET_FELIRAT,
  href: kezdolapSzerkesztoNezetHref(),
}

export interface AdminNavCsoport {
  /** A csoportcím DOM-azonosítója (a csoport `aria-labelledby`-ja). */
  id: string
  cim: string
  linkek: readonly AdminNavLink[]
}

export const ADMIN_NAV_CSOPORTOK: readonly AdminNavCsoport[] = [
  {
    id: 'kc-admin-nav-leggyakrabban',
    cim: 'Leggyakrabban használt',
    linkek: [ADMIN_UTAK.kezdolap, ADMIN_UTAK.videoSzovegei, SZERKESZTO_NEZET_LINK],
  },
  {
    id: 'kc-admin-nav-kimutatasok',
    cim: 'Kimutatások és kurzusvideók',
    linkek: [ADMIN_UTAK.statisztika, ADMIN_UTAK.webanalitika, ADMIN_UTAK.videotar],
  },
]

/** Pontos egyezés: a saját nézetek `exact: true` útvonalak. */
export function aktivLink(pathname: string | null, href: string): boolean {
  return pathname !== null && pathname.replace(/\/+$/, '') === href
}

export function AdminNavLinks() {
  const { user } = useAuth<{ id: number | string; role?: string | null }>()
  const pathname = usePathname()
  const { config } = useConfig()
  if (!hasStaffOrOwnerRole(user)) {
    return null
  }
  const adminRoute = config.routes.admin

  return (
    <div className="kc-admin-nav">
      {ADMIN_NAV_CSOPORTOK.map((csoport) => (
        <div
          aria-labelledby={csoport.id}
          className="kc-admin-nav__csoport"
          key={csoport.id}
          role="group"
        >
          <p className="kc-admin-nav__cim" id={csoport.id}>
            {csoport.cim}
          </p>
          <ul className="kc-admin-nav__lista">
            {csoport.linkek.map((link) => {
              if (kulsoLink(link)) {
                return (
                  <li className="kc-admin-nav__elem" key={link.href}>
                    <a
                      className="nav__link kc-admin-nav__link"
                      href={link.href}
                      rel="noopener"
                      target="_blank"
                    >
                      <span className="nav__link-label">
                        {link.felirat} <span className="kc-admin-nav__uj-lap">{UJ_LAPON}</span>
                      </span>
                    </a>
                  </li>
                )
              }
              const href = adminCim(adminRoute, link.utvonal)
              const aktiv = aktivLink(pathname, href)
              return (
                <li className="kc-admin-nav__elem" key={link.utvonal}>
                  <Link
                    aria-current={aktiv ? 'page' : undefined}
                    className="nav__link kc-admin-nav__link"
                    href={href}
                    prefetch={false}
                  >
                    {aktiv ? <span className="nav__link-indicator" /> : null}
                    <span className="nav__link-label">{link.felirat}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </div>
  )
}

/**
 * A videó szövegeinek linkje az admin FEJLÉCÉBEN (admin.components.actions),
 * minden nézeten.
 *
 * MIÉRT KELL A MENÜ MELLETT: a Payload 1440 CSS px-es és annál keskenyebb
 * ablakban minden betöltéskor BECSUKJA az oldalsávot (@payloadcms/ui
 * Nav/context.js, `largeBreak` → setNavOpen(false); a töréspont
 * „(max-width: 1440px)”, providers/Root/index.js). Egy gyakori laptopon a
 * menüpont így rejtve van, és két kattintás kell hozzá. Az NN/g szerint
 * „When navigation is hidden, people simply forget to check it”, és asztali
 * gépen „Visible navigation is the gold standard”
 * (https://www.nngroup.com/articles/vertical-nav/). A fejléc-link a
 * tulajdonos fő kérését (a videón lévő szövegek) bármely nézetből EGY
 * kattintásra adja; a WCAG 2.2 SC 2.4.5 (Multiple Ways) ugyanezt kéri.
 *
 * 768 CSS px alatt rejtve marad: ott a Payload fejléc-akcióinak helye 150 px,
 * és a menü amúgy is teljes képernyős, egy érintésre nyíló lap.
 */
export function KezdolapVideoFejlecLink() {
  const { user } = useAuth<{ id: number | string; role?: string | null }>()
  const { config } = useConfig()
  if (!hasStaffOrOwnerRole(user)) {
    return null
  }
  return (
    <Link
      className="kc-admin-fejlec-link"
      href={adminCim(config.routes.admin, ADMIN_UTAK.videoSzovegei.utvonal)}
      prefetch={false}
    >
      {ADMIN_UTAK.videoSzovegei.felirat}
    </Link>
  )
}

export default AdminNavLinks
