import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  HEADER_APPOINTMENT_HREF,
  HEADER_APPOINTMENT_LABEL,
  HEADER_APPOINTMENT_NAV_ID,
  HEADER_APPOINTMENT_NAV_ITEM,
  withHeaderAppointmentNav,
} from '../lib/header-appointment'
import type { NavItem } from '../lib/menu-tree'
import { getNavRouteState } from '../lib/nav-route'

function navItem(id: number, label: string, href: string, children: NavItem[] = []): NavItem {
  return {
    id,
    label,
    href,
    openInNewTab: false,
    isExternal: false,
    children,
  }
}

describe('withHeaderAppointmentNav', () => {
  it('üres fát nem egészít ki', () => {
    expect(withHeaderAppointmentNav([])).toEqual([])
  })

  it('a lista végére fűzi a pontot, ha a CMS még nem hozza', () => {
    const items = [navItem(1, 'Rólunk', '/rolunk'), navItem(2, 'Kapcsolat', '/kapcsolat')]
    const result = withHeaderAppointmentNav(items)

    expect(result.map((item) => item.label)).toEqual([
      'Rólunk',
      'Kapcsolat',
      HEADER_APPOINTMENT_LABEL,
    ])
    expect(result.at(-1)).toEqual(HEADER_APPOINTMENT_NAV_ITEM)
    expect(result.at(-1)?.href).toBe(HEADER_APPOINTMENT_HREF)
    expect(result.at(-1)?.id).toBe(HEADER_APPOINTMENT_NAV_ID)
  })

  it('nem duplikál, ha a felirat vagy a callback-href már a fában van', () => {
    const byLabel = [navItem(3, HEADER_APPOINTMENT_LABEL, '/egyeb')]
    const byHref = [navItem(4, 'Foglalás', HEADER_APPOINTMENT_HREF)]
    const nested = [navItem(5, 'Szolgáltatások', '/szolgaltatasok', [byHref[0]])]

    expect(withHeaderAppointmentNav(byLabel)).toEqual(byLabel)
    expect(withHeaderAppointmentNav(byHref)).toEqual(byHref)
    expect(withHeaderAppointmentNav(nested)).toEqual(nested)
  })
})

describe('Időpontkérés útvonalállapot', () => {
  it('hash-célú callback-link a /kapcsolat oldalon is inaktív marad', () => {
    expect(getNavRouteState(HEADER_APPOINTMENT_NAV_ITEM, '/kapcsolat')).toBe('inactive')
    expect(getNavRouteState(HEADER_APPOINTMENT_NAV_ITEM, '/kapcsolat#idopontkeres')).toBe(
      'inactive',
    )
    expect(getNavRouteState(HEADER_APPOINTMENT_NAV_ITEM, '/kurzusok')).toBe('inactive')
  })
})

describe('fejléc-forrás — Időpontkérés, nem foglalás', () => {
  it('a sáv és a fiók a közös lockot használja, régi felirat nincs', () => {
    const header = readFileSync(
      fileURLToPath(new URL('../components/layout/Header.tsx', import.meta.url)),
      'utf8',
    )
    const mobile = readFileSync(
      fileURLToPath(new URL('../components/layout/MobileNav.tsx', import.meta.url)),
      'utf8',
    )
    const cta = readFileSync(
      fileURLToPath(new URL('../components/layout/HeaderAppointmentCta.tsx', import.meta.url)),
      'utf8',
    )

    expect(header).toContain('withHeaderAppointmentNav')
    expect(header).toContain('HeaderAppointmentCta')
    expect(mobile).toContain('HeaderAppointmentCta')
    expect(cta).toContain('HEADER_APPOINTMENT_NAV_ITEM')
    expect(`${header}${mobile}${cta}`).not.toContain('Időpontfoglalás')
  })
})
