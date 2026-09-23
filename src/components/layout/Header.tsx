import Link from 'next/link'

import { BarionSessionSignUp } from '../analytics/BarionSessionSignUp'
import { Container } from '../ui/Container'
import { BRAND_LOGO_ALT, BRAND_LOGO_HORIZONTAL_TAGLINE } from '../../lib/brand-logo'
import { SzerkesztoNezetBelepo } from '../editor/frontend/SzerkesztoNezetBelepo'
import { withCoursesNavItem } from '../../lib/menu-tree'
import { getNavTree } from '../../lib/menus'
import { AccountNav } from './AccountNav'
import { DesktopNav } from './DesktopNav'
import { getHeaderAuthState } from './header-user'
import { HeaderScrollFx } from './HeaderScrollFx'
import { MobileNav } from './MobileNav'

/**
 * Fejléc — a menus menüfából renderel (visible + published-cél, max 2 szint).
 *
 * WP36 (2026-09-08, tulajdonosi kérés): a sávban a főmenü ÉS egyetlen
 * fiók-belépő áll, kitöltött pirula nélkül.
 * - A „Kurzusok" a főmenü első, sima menüpontja (`withCoursesNavItem`), nem
 *   külön akciógomb; az M1-es értékesítési célt a hero és a szekció-CTA-k
 *   viszik (docs/ertekesitesi-ux-skill.md §3, docs/gomb-inventar.md §4.1).
 * - A fiók-belépő MINDKÉT állapotban ugyanaz a 44×44-es profil-ikon a sáv
 *   végén (Jakob törvénye: azonos hely, azonos jel); kijelentkezve link a
 *   /belepes-re, bejelentkezve menügomb (Kurzusaim, Kijelentkezés) — lásd
 *   AccountNav.tsx. Így a sáv Tab-sora minden állapotban ugyanaz: márka →
 *   menüpontok → fiók (WCAG 2.2 SC 2.4.3 Focus Order, SC 3.2.3 Consistent
 *   Navigation).
 * Az „Időpontfoglalás” külön sáv-gomb 2026-09-07-én kikerült (tulajdonosi
 * döntés): a „Kapcsolat” menüpont célja, a /kapcsolat oldal időpontkérő
 * űrlapja ugyanazt a cselekvést fedi.
 * - NN/g, Menu-Design Checklist: kevesebb, egyértelműen elkülönülő menüpont;
 *   ugyanarra a célra ne álljon két menüelem.
 *   https://www.nngroup.com/articles/menu-design/
 * - WCAG 2.2 SC 3.2.3 Consistent Navigation: a keret minden oldalon ugyanazt
 *   a rövid, azonos sorrendű navigációt adja.
 *   https://www.w3.org/WAI/WCAG22/Understanding/consistent-navigation.html
 *
 * SZERKESZTŐI BELÉPŐ (modul-térkép A3, 2. fázis). A bejelentkezett staff/owner
 * a publikált nézetben a fejléc FÖLÖTT egy „Szerkesztő nézet” sávot kap
 * (SzerkesztoNezetBelepo.tsx). A döntés a fenti, MÁR meglévő hitelesítési
 * hívásból születik (`auth.szerkeszto`), és a komponens CSAK a jogosult ágban
 * renderelődik: a látogató és a vásárló kimenete bájtra a belépő nélküli
 * fejléc (nincs üres hely a fában, nincs hivatkozás a kliens-komponensre).
 * Piszkozat-előnézetben a belépő elmarad, ott az előnézet-sáv visz vissza.
 */
export async function Header() {
  const [cmsItems, auth] = await Promise.all([getNavTree(), getHeaderAuthState()])
  const items = withCoursesNavItem(cmsItems)

  const fejlec = (
    <header className="kc-site-header">
      <HeaderScrollFx />
      {/* Barion Pixel: az ÁLLANDÓ (megjegyzett) bejelentkezéssel érkező
          látogató munkamenet-nyitó, implicit `signUp`-ja — munkamenetenként
          EGYSZER. A fejléc az egyetlen olyan, minden oldalon jelen lévő elem,
          amely szerver-oldalon ismeri a hitelesítési bitet; a komponens semmit
          nem renderel. Az indoklás a komponens fejkommentjében. */}
      <BarionSessionSignUp signedIn={auth.signedIn} />
      <Container>
        <div className="kc-site-header__bar">
          {/* WP49 (2026-09-19): a tulajdonosok új, vízszintes logója a
              korábbi szöveges „Kineti|care" wordmark helyén; 2026-09-23 óta a
              „KÉZREHABILITÁCIÓ” feliratos változata (méretek: layout.css). Sima <img>, az
              SVG változtatás nélkül (lásd src/lib/brand-logo.ts). A link
              hozzáférhető neve marad „Kineticare kezdőlap" (a 404-oldallal
              bitre azonos, WCAG 2.2 SC 3.2.4); a kép alt-ja a márkanév.
              Érintőcél: a link min-height 2.75rem (44 px), a logó szélesebb
              44 px-nél (WCAG 2.2 SC 2.5.8; Apple HIG Layout, 44×44 pt). */}
          <Link aria-label="Kineticare kezdőlap" className="kc-site-header__brand" href="/">
            {/* eslint-disable-next-line @next/next/no-img-element -- SVG-logó bitre azonosan, next/image nélkül (src/lib/brand-logo.ts) */}
            <img
              alt={BRAND_LOGO_ALT}
              className="kc-site-header__logo"
              height={BRAND_LOGO_HORIZONTAL_TAGLINE.height}
              src={BRAND_LOGO_HORIZONTAL_TAGLINE.src}
              width={BRAND_LOGO_HORIZONTAL_TAGLINE.width}
            />
          </Link>
          <DesktopNav items={items} />
          <div className="kc-site-header__actions">
            <AccountNav signedIn={auth.signedIn} variant="header" />
            <MobileNav items={items} signedIn={auth.signedIn} />
          </div>
        </div>
      </Container>
    </header>
  )
  if (!auth.szerkeszto || auth.elonezet) {
    return fejlec
  }
  return (
    <>
      <SzerkesztoNezetBelepo />
      {fejlec}
    </>
  )
}
