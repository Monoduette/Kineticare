/**
 * Aktiválási linkek a migrált vevőknek (src/lib/customer-import/invite.ts).
 *
 * A linkek a Payload SAJÁT jelszó-visszaállító tokenjéből épülnek
 * (`forgotPassword`, `disableEmail: true`) — e-mail-küldés itt NINCS, csak
 * link-generálás és CSV-renderelés.
 *
 * MINDEN ADAT KITALÁLT (example.com); valódi token nem szerepel sehol.
 */

import { describe, expect, it } from 'vitest'

import {
  buildInviteUrl,
  generateInviteLinks,
  INVITE_RESET_PATH,
  renderInviteCsv,
  resolveServerUrl,
} from '../../lib/customer-import/invite'
import { UTF8_BOM } from '../../lib/customer-import/parse'
import { createFakeDb, createFakePayload } from './fake-payload'

describe('szerver-URL feloldása', () => {
  it('a záró perjelet levágja', () => {
    expect(resolveServerUrl({ NEXT_PUBLIC_SERVER_URL: 'https://kineticare.example.com/' })).toBe(
      'https://kineticare.example.com',
    )
  })

  it('hiányzó változónál magyar hibaüzenettel dob', () => {
    expect(() => resolveServerUrl({})).toThrow(/NEXT_PUBLIC_SERVER_URL/)
    expect(() => resolveServerUrl({ NEXT_PUBLIC_SERVER_URL: '  ' })).toThrow(/Hiányzó/)
  })
})

describe('link-építés', () => {
  it('a vásárlói jelszó-beállító oldalra mutat, URL-kódolt tokennel', () => {
    expect(buildInviteUrl('https://kineticare.example.com', 'abc+def')).toBe(
      `https://kineticare.example.com${INVITE_RESET_PATH}?token=abc%2Bdef&returnUrl=%2Fkurzusaim`,
    )
  })

  it('a záró perjel nem duplázza az útvonalat', () => {
    expect(buildInviteUrl('https://kineticare.example.com//', 'abc')).toBe(
      `https://kineticare.example.com${INVITE_RESET_PATH}?token=abc&returnUrl=%2Fkurzusaim`,
    )
  })
})

describe('CSV-renderelés', () => {
  it('BOM-mal, fejléccel és CRLF sorvéggel ír (Excel-barát)', () => {
    const csv = renderInviteCsv([
      { email: 'pelda.vasarlo@example.com', url: 'https://kineticare.example.com/x?token=abc' },
    ])
    expect(csv.startsWith(UTF8_BOM)).toBe(true)
    expect(csv).toContain('email,aktivalasi_link\r\n')
    expect(csv).toContain('pelda.vasarlo@example.com,https://kineticare.example.com/x?token=abc')
    expect(csv.endsWith('\r\n')).toBe(true)
  })

  it('idézőjelezi a vesszőt tartalmazó mezőt', () => {
    expect(renderInviteCsv([{ email: 'a@example.com', url: 'https://x.example/a,b' }])).toContain(
      '"https://x.example/a,b"',
    )
  })
})

describe('link-generálás', () => {
  const db = () =>
    createFakeDb({
      users: [
        {
          id: 7,
          email: 'pelda.vasarlo@example.com',
          name: 'Példa Vásárló',
          role: 'customer',
          purchases: [],
          password: 'x',
        },
      ],
    })

  it('minden létező felhasználóhoz linket ad', async () => {
    const database = db()
    const result = await generateInviteLinks(
      createFakePayload(database),
      ['pelda.vasarlo@example.com'],
      { serverUrl: 'https://kineticare.example.com' },
    )
    expect(result.issues).toEqual([])
    expect(result.links[0].email).toBe('pelda.vasarlo@example.com')
    expect(result.links[0].url).toContain(`${INVITE_RESET_PATH}?token=`)
    expect(database.calls.forgotPassword).toEqual(['pelda.vasarlo@example.com'])
  })

  it('ismeretlen e-mailnél NEM hallgat: hibalistába kerül', async () => {
    const result = await generateInviteLinks(createFakePayload(db()), ['nincs.ilyen@example.com'], {
      serverUrl: 'https://kineticare.example.com',
    })
    expect(result.links).toEqual([])
    expect(result.issues[0]).toMatchObject({
      email: 'nincs.ilyen@example.com',
      reason: expect.stringContaining('nincs ilyen felhasználó'),
    })
  })

  it('egy hibás cím nem állítja meg a többi link előállítását', async () => {
    const result = await generateInviteLinks(
      createFakePayload(db()),
      ['nincs.ilyen@example.com', 'pelda.vasarlo@example.com'],
      { serverUrl: 'https://kineticare.example.com' },
    )
    expect(result.links).toHaveLength(1)
    expect(result.issues).toHaveLength(1)
  })
})
