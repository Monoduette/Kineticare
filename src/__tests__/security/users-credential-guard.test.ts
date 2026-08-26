import { APIError } from 'payload'
import { describe, expect, it, vi } from 'vitest'

import { FOREIGN_CREDENTIAL_CHANGE_MESSAGE, Users } from '../../collections/Users'

/**
 * IDEGEN FIÓK HITELESÍTÉSI ADATAINAK VÉDELME (belső biztonsági átvizsgálás,
 * 2026-08-16).
 * A `users` collection `update` szabálya a staffnak MINDEN rekordra írási jogot
 * adott, a Payload beépített `password` és `email` mezőin pedig nincs
 * mezőszintű `access`. Staff jogosultsággal így egy owner (vagy bármely vevő)
 */

/**
 * TESZT-ÉRTÉKEK, NEM VALÓDI JELSZAVAK.
 *
 * A repó 1. tilos zónája (CLAUDE.md) szerint jelszó-szerű karaktersor
 * TESZTFIXTÚRÁBA sem kerülhet — és a titok-szkenner (gitleaks) pontosan ezen a
 * fájlon jelzett öt találatot, mert a korábbi, véletlenszerűnek látszó
 * fixtúra-jelszavak entrópiája elérte a generic-api-key küszöböt.
 *
 * A csere nem elrejti a hibát, hanem megszünteti az okát: ezek az értékek
 * ismétlődő, magyar szavakból állnak, tehát alacsony entrópiájúak, és a nevük
 * kimondja, hogy tesztadatok. A jelszó-politikát viszont teljesítik (nagybetű,
 * szám, hossz), így a mért viselkedés változatlan.
 */
const TESZT_JELSZO_A = 'Teszt-Jelszo-Nem-Titok-1'
const TESZT_JELSZO_B = 'Teszt-Jelszo-Nem-Titok-2'
const TESZT_JELSZO_C = 'Teszt-Jelszo-Nem-Titok-3'
/** Szándékosan gyenge: a jelszó-politika elutasító ágát méri. */
const TESZT_JELSZO_GYENGE = 'rossz'
/** A „nem szivárog a hibaüzenetbe” teszt nyomkövető értéke. */
const TESZT_JELSZO_NYOMKOVETO = 'Teszt-Jelszo-Nem-Titok-Nyomkoveto-9'

type Role = 'owner' | 'staff' | 'customer'

interface HookArgs {
  data: Record<string, unknown>
  originalDoc?: Record<string, unknown>
  operation: 'create' | 'update'
  req: { user?: { id: number; role: Role } | null; payload?: unknown; context?: unknown }
}

/**
 * A hookot NÉV szerint keressük ki: a beforeChange lánc bővülhet, és egy
 * indexre kötött teszt ilyenkor némán MÁS hookot mérne.
 */
const blockForeignCredentialChange = ((): ((
  args: HookArgs,
) => Record<string, unknown> | Promise<Record<string, unknown>>) => {
  const hook = (Users.hooks?.beforeChange ?? []).find(
    (candidate) => candidate.name === 'blockForeignCredentialChange',
  )
  if (!hook) {
    throw new Error("a Users beforeChange láncában nincs 'blockForeignCredentialChange' hook")
  }
  return hook as unknown as (args: HookArgs) => Record<string, unknown>
})()

const owner = { id: 1, role: 'owner' as Role }
const staff = { id: 2, role: 'staff' as Role }
const customer = { id: 3, role: 'customer' as Role }

/** Az áldozat rekordja — SOHA nem a kérést indító felhasználó. */
const victim = { id: 99, email: 'aldozat@kineticare.test', role: 'owner' }

const run = (args: HookArgs) => blockForeignCredentialChange(args)

describe('blockForeignCredentialChange — idegen rekord jelszó-/e-mail-cseréje', () => {
  it.each([
    ['staff', staff],
    ['customer', customer],
  ])('%s NEM írhatja át idegen fiók JELSZAVÁT (403, magyar üzenet)', (_label, actor) => {
    let thrown: unknown
    try {
      run({
        data: { password: TESZT_JELSZO_A },
        originalDoc: victim,
        operation: 'update',
        req: { user: actor },
      })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(APIError)
    expect((thrown as APIError).status).toBe(403)
    expect((thrown as APIError).message).toBe(FOREIGN_CREDENTIAL_CHANGE_MESSAGE)
    // A felhasználónak szóló üzenet magyar (CLAUDE.md kódolási konvenció).
    expect(FOREIGN_CREDENTIAL_CHANGE_MESSAGE).toMatch(/tulajdonos/i)
  })

  it.each([
    ['staff', staff],
    ['customer', customer],
  ])('%s NEM írhatja át idegen fiók E-MAIL-CÍMÉT (403)', (_label, actor) => {
    expect(() =>
      run({
        data: { email: 'tamado@example.com' },
        originalDoc: victim,
        operation: 'update',
        req: { user: actor },
      }),
    ).toThrow(FOREIGN_CREDENTIAL_CHANGE_MESSAGE)
  })

  it('a jelszó SOSEM kerül a hibaüzenetbe', () => {
    const password = TESZT_JELSZO_NYOMKOVETO
    let message = ''
    try {
      run({
        data: { password },
        originalDoc: victim,
        operation: 'update',
        req: { user: staff },
      })
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    expect(message).not.toContain(password)
  })

  it('owner ÁTÍRHATJA más fiók jelszavát és e-mail-címét (ügyfélszolgálati út)', () => {
    expect(
      run({
        data: { password: TESZT_JELSZO_B, email: 'uj@kineticare.test' },
        originalDoc: victim,
        operation: 'update',
        req: { user: owner },
      }),
    ).toMatchObject({ email: 'uj@kineticare.test' })
  })

  it('idegen rekord EGYÉB mezői (név, számlázási adat) staffnak nyitva maradnak', () => {
    const data = { name: 'Új Név', billingCity: 'Szeged' }
    expect(
      run({
        data,
        originalDoc: { id: 99, email: 'vevo@kineticare.test', role: 'customer' },
        operation: 'update',
        req: { user: staff },
      }),
    ).toEqual(data)
  })

  it('a VÁLTOZATLAN e-mail visszaküldése nem változtatás (az admin a teljes dokumentumot küldi)', () => {
    // A Payload admin a mentéskor minden mezőt visszaküld — a nagybetűs/whitespace-es
    // alak sem számíthat cserének, különben egy sima név-mentés is 403-at kapna.
    const data = { email: '  Aldozat@Kineticare.TEST ', name: 'Új Név' }
    expect(
      run({ data, originalDoc: victim, operation: 'update', req: { user: staff } }),
    ).toEqual(data)
  })
})

describe('blockForeignCredentialChange — aminek működnie KELL', () => {
  it('a felhasználó SAJÁT jelszócseréje átmegy (customer)', () => {
    const data = { password: TESZT_JELSZO_C }
    expect(
      run({
        data,
        originalDoc: { id: customer.id, email: 'vevo@kineticare.test', role: 'customer' },
        operation: 'update',
        req: { user: customer },
      }),
    ).toEqual(data)
  })

  it('a felhasználó SAJÁT e-mail-cseréje átmegy (staff)', () => {
    const data = { email: 'uj.cim@kineticare.test' }
    expect(
      run({
        data,
        originalDoc: { id: staff.id, email: 'regi@kineticare.test', role: 'staff' },
        operation: 'update',
        req: { user: staff },
      }),
    ).toEqual(data)
  })

  it('CREATE műveletre nem fut (regisztráció, vendég-vásárlás fiókja, vásárló-import)', () => {
    // A vendég-vásárlás (resolve-order-customer.ts) és az import is create-tel,
    // overrideAccess-szel dolgozik — a hook egyiket sem érintheti.
    const data = { email: 'vendeg@kineticare.test', password: TESZT_JELSZO_A }
    expect(run({ data, operation: 'create', req: { user: null } })).toEqual(data)
    expect(run({ data, operation: 'create', req: { user: staff } })).toEqual(data)
  })

  it('az ELSŐ-FELHASZNÁLÓ bootstrap (create, nincs bejelentkezett user) átmegy', () => {
    const data = { email: 'elso@kineticare.test', password: TESZT_JELSZO_B, role: 'owner' }
    expect(run({ data, operation: 'create', req: {} })).toEqual(data)
  })

  it('SZERVER-OLDALI update (local API, nincs req.user) átmegy', () => {
    // Pl. a jelszó-beállítás-jelző törlése vagy a purchases-beírás
    // (overrideAccess: true). REST-en bejelentkezés nélkül nincs user-update:
    // a canUpdateUser látogatóra false-t ad.
    const data = { passwordSetupPending: false, password: TESZT_JELSZO_C }
    expect(run({ data, originalDoc: victim, operation: 'update', req: {} })).toEqual(data)
  })
})

/**
 * A jelszó-visszaállítás („elfelejtett jelszó" → aktiváló link) útja NEM megy
 * át a beforeChange láncon: a Payload `resetPasswordOperation`-je közvetlenül
 * írja a jelszót, és csak az afterLogin hookokat futtatja. Ezt a
 * FÜGGŐSÉGET rögzítjük, hogy egy Payload-frissítés utáni viselkedésváltozás
 * (ha egyszer mégis lefuttatná a láncot) itt bukjon meg, ne élesben.
 */
describe('jelszó-visszaállítás — a beforeChange lánc megkerülése (Payload-szerződés)', () => {
  it('a resetPassword művelet forrása nem hívja a beforeChange hookokat', async () => {
    const { readFile } = await import('node:fs/promises')
    const source = await readFile(
      new URL('../../../node_modules/payload/dist/auth/operations/resetPassword.js', import.meta.url),
      'utf8',
    )
    expect(source).not.toContain('beforeChange')
    // Az afterLogin viszont FUT — erre épül a passwordSetupPending törlése.
    expect(source).toContain('afterLogin')
  })

  it('a jelszó-visszaállítás után futó afterLogin hook be van kötve', () => {
    const afterLogin = Users.hooks?.afterLogin ?? []
    expect(afterLogin.map((hook) => hook.name)).toContain(
      'clearPasswordSetupPendingAfterLogin',
    )
  })
})

/**
 * Regressziós fogás: a `blockForeignCredentialChange` a lánc ELEJÉN áll.
 * Ha a jelszó-politika (400) elé kerülne más hook, egy gyenge jelszóval indított
 * idegen-rekord-támadás a POLITIKA hibáját kapná vissza a 403 helyett — a
 * jogosultsági elutasításnak kell elsőnek lennie.
 */
describe('hook-sorrend', () => {
  it('a hitelesítési-adat őr a beforeChange lánc első eleme', () => {
    expect((Users.hooks?.beforeChange ?? [])[0]?.name).toBe('blockForeignCredentialChange')
  })

  it('gyenge jelszóval, idegen rekordon is a 403 nyer (nem a jelszó-politika 400-asa)', () => {
    let status: number | undefined
    try {
      run({
        data: { password: TESZT_JELSZO_GYENGE },
        originalDoc: victim,
        operation: 'update',
        req: { user: staff },
      })
    } catch (error) {
      status = error instanceof APIError ? error.status : undefined
    }
    expect(status).toBe(403)
  })
})

/** A csendes elnyelés kizárása: a hook nem tér vissza csendben az áldozat adatával. */
describe('a hook nem nyeli el a hibát', () => {
  it('elutasításkor DOB, nem pedig kiszűri a jelszót a data-ból', () => {
    const spy = vi.fn(() =>
      run({
        data: { password: TESZT_JELSZO_A },
        originalDoc: victim,
        operation: 'update',
        req: { user: staff },
      }),
    )
    expect(spy).toThrow()
  })
})
