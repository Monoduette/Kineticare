import Link from 'next/link'

import { BarionSessionSignUp } from '../analytics/BarionSessionSignUp'
import { Container } from '../ui/Container'
import { getNavTree } from '../../lib/menus'
import { AccountNav } from './AccountNav'
import { DesktopNav } from './DesktopNav'
import { getHeaderAuthState } from './header-user'
import { HeaderCoursesNav } from './HeaderCoursesNav'
import { HeaderScrollFx } from './HeaderScrollFx'
import { MobileNav } from './MobileNav'

/**
 * Fejléc — a menus menüfából renderel (visible + published-cél, max 2 szint,
 */
export async function Header() {
  const [items, auth] = await Promise.all([getNavTree(), getHeaderAuthState()])

  return (
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
          <Link aria-label="Kineticare kezdőlap" className="kc-site-header__brand" href="/">
            Kineti<span className="kc-site-header__brand-accent">care</span>
          </Link>
          <DesktopNav items={items} />
          <div className="kc-site-header__actions">
            <AccountNav signedIn={auth.signedIn} variant="header" />
            <HeaderCoursesNav />
            <MobileNav items={items} signedIn={auth.signedIn} />
          </div>
        </div>
      </Container>
    </header>
  )
}
