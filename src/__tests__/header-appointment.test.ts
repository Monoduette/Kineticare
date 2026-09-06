import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  HEADER_APPOINTMENT_HREF,
  HEADER_APPOINTMENT_LABEL,
  HEADER_APPOINTMENT_NAV_ITEM,
} from '../lib/header-appointment'
import { getNavRouteState } from '../lib/nav-route'

describe('fejléc Időpontfoglalás — CTA, nem menüpont', () => {
  it('a felirat és a callback-href zárva van', () => {
    expect(HEADER_APPOINTMENT_LABEL).toBe('Időpontfoglalás')
    expect(HEADER_APPOINTMENT_HREF).toBe('/kapcsolat#idopontkeres')
    expect(HEADER_APPOINTMENT_NAV_ITEM.label).toBe(HEADER_APPOINTMENT_LABEL)
    expect(HEADER_APPOINTMENT_NAV_ITEM.href).toBe(HEADER_APPOINTMENT_HREF)
  })

  it('hash-célú callback-link a /kapcsolat oldalon is inaktív marad', () => {
    expect(getNavRouteState(HEADER_APPOINTMENT_NAV_ITEM, '/kapcsolat')).toBe('inactive')
    expect(getNavRouteState(HEADER_APPOINTMENT_NAV_ITEM, '/kapcsolat#idopontkeres')).toBe('inactive')
    expect(getNavRouteState(HEADER_APPOINTMENT_NAV_ITEM, '/kurzusok')).toBe('inactive')
  })

  it('a sáv és a fiók a közös lockot használja; nav-injektálás és Időpontkérés nincs', () => {
    const lock = readFileSync(
      fileURLToPath(new URL('../lib/header-appointment.ts', import.meta.url)),
      'utf8',
    )
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
    const combined = `${lock}${header}${mobile}${cta}`

    expect(header).toContain('HeaderAppointmentCta')
    expect(header).toContain('getNavTree()')
    expect(header).not.toContain('withHeaderAppointmentNav')
    expect(mobile).toContain('HeaderAppointmentCta')
    expect(lock).not.toContain('withHeaderAppointmentNav')
    expect(combined).toContain('Időpontfoglalás')
    expect(combined).not.toContain('Időpontkérés')
  })
})
