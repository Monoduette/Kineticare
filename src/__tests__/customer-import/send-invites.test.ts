/**
 * Aktiváló levelek a migrált vevőknek (src/lib/customer-import/send-invites.ts).
 *
 * A modul az `invite.ts` linkjeire épül: a levelet MI állítjuk össze magyarul,
 * a küldés a `payload.sendEmail`-en megy. A tesztek a sablont, az indítási
 * feltételeket és a hibatűrést fedik le.
 *
 * MINDEN ADAT KITALÁLT (example.com); valódi token, kulcs és cím nem szerepel.
 */

import { describe, expect, it, vi } from 'vitest'

import {
  INVITE_TOKEN_TTL_DAYS,
  checkSendInvitesPreconditions,
  inviteEmail,
  sendInviteEmails,
} from '../../lib/customer-import/send-invites'
import { createFakeDb, createFakePayload } from './fake-payload'

const link = (email: string): { email: string; url: string } => ({
  email,
  url: `https://kineticare.example.com/jelszo-visszaallitas?token=token-${email}`,
})

describe('aktiváló levél sablonja', () => {
  it('magyar tárgy, névvel megszólítás, aktiválási linkkel', () => {
    const email = inviteEmail({
      name: 'Kiss Anna',
      email: 'kiss.anna@example.com',
      activationUrl: 'https://kineticare.example.com/jelszo-visszaallitas?token=abc',
    })
    expect(email.subject).toContain('állítsd be a jelszavad')
    expect(email.html).toContain('Kedves Kiss Anna!')
    expect(email.text).toContain('Kedves Kiss Anna!')
    expect(email.html).toContain('https://kineticare.example.com/jelszo-visszaallitas?token=abc')
    expect(email.text).toContain('https://kineticare.example.com/jelszo-visszaallitas?token=abc')
  })

  it('név nélkül is helyes megszólítást ad (üres és hiányzó név)', () => {
    for (const name of [null, undefined, '', '   ']) {
      const email = inviteEmail({
        name,
        email: 'valaki@example.com',
        activationUrl: 'https://kineticare.example.com/x?token=abc',
      })
      expect(email.html).toContain('Kedves Vásárlónk!')
      expect(email.html).not.toContain('Kedves !')
      expect(email.text).toContain('Kedves Vásárlónk!')
    }
  })

  it('kimondja, hogy újra fizetni nem kell, és 30 napos érvényességet ír', () => {
    const email = inviteEmail({
      email: 'valaki@example.com',
      activationUrl: 'https://kineticare.example.com/x?token=abc',
    })
    expect(INVITE_TOKEN_TTL_DAYS).toBe(30)
    expect(email.text).toContain('újra fizetned nem kell')
    expect(email.text).toContain('A link 30 napig érvényes.')
    expect(email.text).toContain('A jelszó után a kurzusaid megnyílnak')
    expect(email.text).not.toContain('belépés után a Kurzusaim')
    expect(email.html).toContain('Beállítom az új jelszót')
    expect(email.html).not.toContain('Jelszó beállítása')
    // Mit tegyen, ha nem működik / nem ő a címzett.
    expect(email.text).toContain('Elfelejtett jelszó')
    expect(email.text).toContain('ne használd a linket')
  })

  it('furcsa/hosszú e-mail-cím és név NEM töri szét a HTML-t (escape)', () => {
    const email = inviteEmail({
      name: '<script>alert(1)</script>',
      email: `"><img src=x onerror=alert(1)>${'a'.repeat(200)}@example.com`,
      activationUrl: 'https://kineticare.example.com/x?token=a&b=1',
    })
    expect(email.html).not.toContain('<script>')
    expect(email.html).not.toContain('<img src=x')
    expect(email.html).toContain('&lt;script&gt;')
    expect(email.html).toContain('&lt;img src=x')
    // A linkben lévő & is escape-elve kerül a HTML-be.
    expect(email.html).toContain('token=a&amp;b=1')
  })
})

describe('a --send-invites indítási feltételei', () => {
  it('próbafutással EGYÜTT elutasítja (magyar üzenet)', () => {
    const problem = checkSendInvitesPreconditions({
      dryRun: true,
      env: { RESEND_API_KEY: 'teszt-kulcs-nem-valodi' },
    })
    expect(problem).toContain('--dry-run')
    expect(problem).toContain('nem használható együtt')
  })

  it('e-mail-szolgáltató nélkül elutasítja, és a Railway-re irányít', () => {
    const problem = checkSendInvitesPreconditions({ dryRun: false, env: {} })
    expect(problem).toContain('RESEND_API_KEY')
    expect(problem).toContain('Railway')
  })

  it('beállított kulccsal, próbafutás nélkül indítható', () => {
    expect(
      checkSendInvitesPreconditions({
        dryRun: false,
        env: { RESEND_API_KEY: 'teszt-kulcs-nem-valodi' },
      }),
    ).toBeNull()
  })

  it('a próbafutás tiltása erősebb, mint a hiányzó kulcs (előbb az szól)', () => {
    expect(checkSendInvitesPreconditions({ dryRun: true, env: {} })).toContain('--dry-run')
  })
})

describe('aktiváló levelek kiküldése', () => {
  const options = { delayMs: 0 }

  it('minden címzettnek küld, a levél tartalmazza a SAJÁT linkjét', async () => {
    const db = createFakeDb()
    const result = await sendInviteEmails(
      createFakePayload(db),
      [link('elso@example.com'), link('masodik@example.com')],
      { ...options, names: new Map([['elso@example.com', 'Első Vevő']]) },
    )

    expect(result.summary).toEqual({ elkuldve: 2, sikertelen: 0 })
    expect(result.issues).toEqual([])
    expect(db.sentEmails.map((mail) => mail.to)).toEqual([
      'elso@example.com',
      'masodik@example.com',
    ])
    expect(db.sentEmails[0].html).toContain('token-elso@example.com')
    expect(db.sentEmails[0].html).toContain('Kedves Első Vevő!')
    // A név nélküli címzett is kap semleges megszólítást.
    expect(db.sentEmails[1].html).toContain('Kedves Vásárlónk!')
    // Egyik levélbe sem szivárog át a MÁSIK címzett linkje.
    expect(db.sentEmails[0].html).not.toContain('token-masodik@example.com')
  })

  it('üres címzett-lista: nem hiba, nem küld semmit', async () => {
    const db = createFakeDb()
    const result = await sendInviteEmails(createFakePayload(db), [], options)
    expect(result.summary).toEqual({ elkuldve: 0, sikertelen: 0 })
    expect(result.issues).toEqual([])
    expect(db.sentEmails).toEqual([])
  })

  it('egy bukott küldés (kivétel) NEM állítja meg a kört', async () => {
    const db = createFakeDb({ throwEmailFor: ['bukik@example.com'] })
    const result = await sendInviteEmails(
      createFakePayload(db),
      [link('elso@example.com'), link('bukik@example.com'), link('harmadik@example.com')],
      options,
    )

    expect(result.summary).toEqual({ elkuldve: 2, sikertelen: 1 })
    expect(db.sentEmails.map((mail) => mail.to)).toEqual([
      'elso@example.com',
      'harmadik@example.com',
    ])
    expect(result.issues).toHaveLength(1)
    expect(result.issues[0]).toMatchObject({
      email: 'bukik@example.com',
      reason: expect.stringContaining('Aktiváló levél hiba'),
    })
  })

  it('az adapter `ok: false` válaszát is hibának veszi (nem néma siker)', async () => {
    const db = createFakeDb({ rejectEmailFor: ['elutasitva@example.com'] })
    const result = await sendInviteEmails(
      createFakePayload(db),
      [link('elutasitva@example.com'), link('rendben@example.com')],
      options,
    )

    expect(result.summary).toEqual({ elkuldve: 1, sikertelen: 1 })
    expect(result.outcomes[0]).toMatchObject({ ok: false, error: 'HTTP 422 (teszt)' })
    expect(result.outcomes[1]).toMatchObject({ ok: true })
  })

  it('a küldések KÖZÖTT szünetet tart (rate-limit-barát), az első elé nem', async () => {
    const sleep = vi.fn(async () => {})
    await sendInviteEmails(
      createFakePayload(createFakeDb()),
      [link('a@example.com'), link('b@example.com'), link('c@example.com')],
      { delayMs: 500, sleep },
    )
    expect(sleep).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledWith(500)
  })

  it('a naplóba SEM a token, SEM a link, SEM a teljes cím nem kerül', async () => {
    const entries: Array<{ msg: string; context?: unknown }> = []
    const record = (msg: string, context?: unknown): void => {
      entries.push({ msg, context })
    }
    const log = {
      debug: record,
      info: record,
      warn: record,
      error: record,
      child: () => log,
    }

    await sendInviteEmails(
      createFakePayload(createFakeDb({ throwEmailFor: ['bukik@example.com'] })),
      [link('kiss.anna@example.com'), link('bukik@example.com')],
      { ...options, log },
    )

    const serialized = JSON.stringify(entries)
    expect(serialized).not.toContain('token-')
    expect(serialized).not.toContain('jelszo-visszaallitas')
    expect(serialized).not.toContain('kiss.anna@example.com')
    // A maszkolt cím viszont segít a hibakeresésben.
    expect(serialized).toContain('b***@example.com')
  })
})
