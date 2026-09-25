import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  assertRequiredEnv,
  buildOriginAllowlist,
  DEFAULT_SERVER_URL,
  JOB_WORKERS_OFF_CONFIRM_ENV,
  requiredEnvVars,
  resolveServerUrl,
  szamlazzVatModes,
  turnstileEnvPair,
} from '../../env'

/**
 * Induláskori ENV-assert (src/env.ts) — a `register()` (src/instrumentation.ts)
 * ezt futtatja a szerver indulásakor.
 *
 * A HANGSÚLY a Turnstile-kulcspáron van: a `TURNSTILE_SECRET_KEY` hiánya ma
 * CSENDBEN kapcsolja ki a kapcsolat-űrlap spam-védelmét (a `verifyTurnstile`
 * kulcs nélkül korán visszatér, src/payload.config.ts). Élesben ezért a pár
 * KONZISZTENCIÁJA kötelező: fél-lábas konfiguráció (csak site key vagy csak
 * secret) megakasztja az indulást, teljes hiány viszont — amíg a Turnstile
 * nincs élesítve — warn-riasztással átengedett, hogy a deploy ne törjön el.
 * Fejlesztésben/tesztben minden változatlanul opcionális, hogy
 * Cloudflare-fiók nélkül is fusson a projekt.
 *
 * A környezetet a `vi.stubEnv` állítja (a `NODE_ENV` típusa csak írható így),
 * és az `afterEach` mindent visszaállít. A teszt SEHOL nem használ valódi
 * titkot: minden érték egyértelműen DUMMY.
 */

const DUMMY_ENV_VALUE = 'DUMMY-42'
/** A NEXT_PUBLIC_SERVER_URL-nek az ALAKJA is ellenőrzött, ezért valódi URL kell. */
const DUMMY_SERVER_URL = 'https://dummy.example'
/**
 * Élesben a Barion-konfiguráció induláskor teljesen feloldódik (API-hoszt,
 * POSKey-alak), ezért ide érvényes ALAKÚ, de nyilvánvalóan nem valódi értékek
 * kellenek: a csupa nulla GUID nem lehet valódi POSKey.
 */
const DUMMY_BARION_TEST_API_URL = 'https://api.test.barion.com'
const DUMMY_BARION_PROD_API_URL = 'https://api.barion.com'
const DUMMY_BARION_PAYEE = 'penztar@dummy.example'
const DUMMY_GUID_POS_KEY = '00000000-0000-0000-0000-000000000000'
const [SITE_KEY_ENV, SECRET_KEY_ENV] = turnstileEnvPair

beforeEach(() => {
  // Minden „minden környezetben kötelező" kulcs kitöltve — így a tesztek
  // kizárólag a vizsgált kulcs hiányán bukhatnak el.
  for (const key of requiredEnvVars) {
    vi.stubEnv(key, DUMMY_ENV_VALUE)
  }
  vi.stubEnv('NEXT_PUBLIC_SERVER_URL', DUMMY_SERVER_URL)
  vi.stubEnv('BARION_API_URL', DUMMY_BARION_TEST_API_URL)
  vi.stubEnv('BARION_PAYEE_EMAIL', DUMMY_BARION_PAYEE)
  vi.stubEnv('BARION_ENVIRONMENT', undefined)
  vi.stubEnv('BARION_POSKEY_TEST', DUMMY_GUID_POS_KEY)
  vi.stubEnv('BARION_POSKEY_PROD', undefined)
  vi.stubEnv(SITE_KEY_ENV, undefined)
  vi.stubEnv(SECRET_KEY_ENV, undefined)
  vi.stubEnv('SZAMLAZZ_AFAKULCS', undefined)
  vi.stubEnv('SZAMLAZZ_AGENT_KEY', undefined)
  // Élesben az induláskori Barion-összefoglaló info-sort ír; a tesztkimenetet ne szemetelje.
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

/**
 * Éles futás beállítása a Turnstile-tesztekhez.
 *
 * A `BARION_ENVIRONMENT` és az `ENABLE_JOB_WORKERS` élesben külön szabályt kap
 * (B3 / job-worker-riasztás, lentebb saját describe-okban vizsgálva) — itt
 * ezért expliciten „rendben lévő" értékre állítjuk őket, hogy ezek a tesztek
 * KIZÁRÓLAG a Turnstile-páron bukhassanak el.
 */
function stubProductionRuntime(): void {
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('BARION_ENVIRONMENT', 'test')
  vi.stubEnv('ENABLE_JOB_WORKERS', 'true')
}

describe('assertRequiredEnv — minden környezetben kötelező kulcsok', () => {
  it('hiánytalan környezetben nem dob', () => {
    vi.stubEnv('NODE_ENV', 'test')

    expect(() => assertRequiredEnv()).not.toThrow()
  })

  it('hiányzó alapkulcsot magyar üzenetben, néven nevezve jelez', () => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('DATABASE_URI', undefined)

    expect(() => assertRequiredEnv()).toThrowError(/DATABASE_URI/)
    expect(() => assertRequiredEnv()).toThrowError(/nem indulhat el/)
  })
})

describe('assertRequiredEnv — Turnstile-kulcspár konzisztenciája', () => {
  it('a Turnstile-kulcsok nem alapkulcsok (fejlesztés Cloudflare-fiók nélkül is fut)', () => {
    expect(requiredEnvVars as readonly string[]).not.toContain(SITE_KEY_ENV)
    expect(requiredEnvVars as readonly string[]).not.toContain(SECRET_KEY_ENV)
  })

  it('NEM production: semmilyen kombináció nem akasztja meg az indulást', () => {
    for (const nodeEnv of ['development', 'test']) {
      vi.stubEnv('NODE_ENV', nodeEnv)

      vi.stubEnv(SITE_KEY_ENV, undefined)
      vi.stubEnv(SECRET_KEY_ENV, undefined)
      expect(() => assertRequiredEnv(), `${nodeEnv}: egyik sincs`).not.toThrow()

      vi.stubEnv(SITE_KEY_ENV, DUMMY_ENV_VALUE)
      expect(() => assertRequiredEnv(), `${nodeEnv}: csak site key`).not.toThrow()

      vi.stubEnv(SITE_KEY_ENV, undefined)
      vi.stubEnv(SECRET_KEY_ENV, DUMMY_ENV_VALUE)
      expect(() => assertRequiredEnv(), `${nodeEnv}: csak secret`).not.toThrow()
    }
  })

  it('PRODUCTION: csak site key (secret nélkül) → nem indul, néven nevezett magyar hibával', () => {
    stubProductionRuntime()
    vi.stubEnv(SITE_KEY_ENV, DUMMY_ENV_VALUE)

    expect(() => assertRequiredEnv()).toThrowError(/TURNSTILE_SITE_KEY/)
    expect(() => assertRequiredEnv()).toThrowError(/nem indulhat el/)
  })

  it('PRODUCTION: csak secret (site key nélkül) → nem indul', () => {
    stubProductionRuntime()
    vi.stubEnv(SECRET_KEY_ENV, DUMMY_ENV_VALUE)

    expect(() => assertRequiredEnv()).toThrowError(/TURNSTILE_SECRET_KEY/)
  })

  it('PRODUCTION: az üres/whitespace érték is hiánynak számít a párellenőrzésben', () => {
    stubProductionRuntime()
    vi.stubEnv(SITE_KEY_ENV, DUMMY_ENV_VALUE)
    vi.stubEnv(SECRET_KEY_ENV, '   ')

    expect(() => assertRequiredEnv()).toThrowError(/TURNSTILE_SITE_KEY/)
  })

  it('PRODUCTION: egyik kulcs sincs → elindul, de warn-riasztás megy a hívónak', () => {
    stubProductionRuntime()
    const warn = vi.fn()

    expect(() => assertRequiredEnv(warn)).not.toThrow()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toBe('turnstile_kikapcsolva')
  })

  it('PRODUCTION: egyik kulcs sincs és nincs warn-callback → akkor sem dob', () => {
    stubProductionRuntime()

    expect(() => assertRequiredEnv()).not.toThrow()
  })

  it('PRODUCTION: mindkét kulcs kitöltve → elindul, warn nélkül', () => {
    stubProductionRuntime()
    vi.stubEnv(SITE_KEY_ENV, DUMMY_ENV_VALUE)
    vi.stubEnv(SECRET_KEY_ENV, DUMMY_ENV_VALUE)
    const warn = vi.fn()

    expect(() => assertRequiredEnv(warn)).not.toThrow()
    expect(warn).not.toHaveBeenCalled()
  })

  it('NEM production: fél-lábas konfigurációnál warn sem megy (csak éles gondoskodás)', () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv(SITE_KEY_ENV, DUMMY_ENV_VALUE)
    const warn = vi.fn()

    expect(() => assertRequiredEnv(warn)).not.toThrow()
    expect(warn).not.toHaveBeenCalled()
  })
})

/**
 * SZAMLAZZ_AFAKULCS (F16) — szigorú értékkészlet; bekapcsolt számlázásnál
 * (van SZAMLAZZ_AGENT_KEY) kötelező, kikapcsolt számlázásnál elhagyható.
 *
 * A `getSzamlazzConfig` csak LUSTÁN, az első számlázási művelet közben fut le,
 * ahol a hiba a jobban vagy a rendelés-visszaigazoló e-mail try/catch-ében
 * nyelődne el: egy elgépelt áfakulcs úgy állítaná le a számlázást, hogy arról
 * senki nem szerez tudomást. Ezért a hibás érték MÁR INDULÁSKOR megakasztja az
 * appot — minden környezetben, mert az áfakulcs adóügyi következménye élesen és
 * stagingen egyaránt súlyos.
 */
describe('assertRequiredEnv — SZAMLAZZ_AFAKULCS induláskori ellenőrzése', () => {
  it('nincs beállítva, KIKAPCSOLT számlázásnál (nincs agent-kulcs) → nem dob, riasztás sincs', () => {
    vi.stubEnv('NODE_ENV', 'test')
    const alert = vi.fn()

    expect(() => assertRequiredEnv(undefined, alert)).not.toThrow()
    expect(alert).not.toHaveBeenCalled()
  })

  it('BEKAPCSOLT számlázás (van agent-kulcs) áfakulcs nélkül: elindul, de induláskor RIASZTÁS megy', () => {
    // A getSzamlazzConfig ilyenkor minden számlázási műveletnél dob: egyetlen
    // számla sem állna ki. A boltot nem állítjuk meg, de a hiba már induláskor
    // error-szintű riasztás, a kulcs ÉRTÉKE nélkül.
    const DUMMY_AGENT_KEY = 'dummy-agent-kulcs-nem-valodi-titok'
    vi.stubEnv('SZAMLAZZ_AGENT_KEY', DUMMY_AGENT_KEY)
    for (const nodeEnv of ['development', 'test', 'production']) {
      vi.stubEnv('NODE_ENV', nodeEnv)
      if (nodeEnv === 'production') {
        vi.stubEnv('BARION_ENVIRONMENT', 'test')
        vi.stubEnv('ENABLE_JOB_WORKERS', 'true')
      }
      for (const empty of [undefined, '', '   ']) {
        vi.stubEnv('SZAMLAZZ_AFAKULCS', empty)
        const alert = vi.fn()
        expect(() => assertRequiredEnv(() => undefined, alert), nodeEnv).not.toThrow()
        expect(alert, `${nodeEnv}/${String(empty)}`).toHaveBeenCalledTimes(1)
        const [message, context] = alert.mock.calls[0] as [string, Record<string, unknown>]
        expect(message).toMatch(/^RIASZTÁS: a SZAMLAZZ_AFAKULCS nincs beállítva/)
        expect(message).toContain('kötelező')
        expect(message).toContain("'27' vagy 'AAM'")
        expect(message).not.toContain(DUMMY_AGENT_KEY)
        expect(JSON.stringify(context)).not.toContain(DUMMY_AGENT_KEY)
      }
    }
  })

  it('bekapcsolt számlázás megadott áfakulccsal: nincs riasztás', () => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('SZAMLAZZ_AGENT_KEY', 'dummy-agent-kulcs-nem-valodi-titok')
    for (const mode of szamlazzVatModes) {
      vi.stubEnv('SZAMLAZZ_AFAKULCS', mode)
      const alert = vi.fn()
      assertRequiredEnv(undefined, alert)
      expect(alert, mode).not.toHaveBeenCalled()
    }
  })

  it('az alapértelmezett riasztás-kimenet error-szintű, RIASZTÁS-előtagú strukturált naplósor', () => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('LOG_LEVEL', 'debug')
    vi.stubEnv('SZAMLAZZ_AGENT_KEY', 'dummy-agent-kulcs-nem-valodi-titok')
    const written = vi.mocked(console.log)
    written.mockClear()

    expect(() => assertRequiredEnv()).not.toThrow()

    const lines = written.mock.calls
      .map((call) => String(call[0]))
      .filter((line) => line.includes('SZAMLAZZ_AFAKULCS'))
    expect(lines).toHaveLength(1)
    const entry = JSON.parse(lines[0] ?? '{}') as { level?: string; msg?: string }
    expect(entry.level).toBe('error')
    expect(entry.msg).toMatch(/^RIASZTÁS: /)
    expect(lines[0]).not.toContain('dummy-agent-kulcs-nem-valodi-titok')
  })

  it('üres/whitespace érték → nem dob (hiánynak számít)', () => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('SZAMLAZZ_AFAKULCS', '   ')

    expect(() => assertRequiredEnv()).not.toThrow()
  })

  it("a támogatott értékek ('27', 'AAM') nem akasztják meg az indulást", () => {
    vi.stubEnv('NODE_ENV', 'test')

    for (const mode of szamlazzVatModes) {
      vi.stubEnv('SZAMLAZZ_AFAKULCS', mode)
      expect(() => assertRequiredEnv(), mode).not.toThrow()
    }
  })

  it('ismeretlen érték → már induláskor dob, néven nevezett magyar hibával', () => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('SZAMLAZZ_AFAKULCS', 'TAM')

    expect(() => assertRequiredEnv()).toThrowError(/SZAMLAZZ_AFAKULCS/)
    expect(() => assertRequiredEnv()).toThrowError(/nem indulhat el/)
    // A hibás érték szerepel az üzenetben (nem titok — adóügyi kód).
    expect(() => assertRequiredEnv()).toThrowError(/TAM/)
  })

  it('a hibaüzenet NEM javasolja az üresen hagyást: bekapcsolt számlázásnál a kulcs kötelező', () => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('SZAMLAZZ_AFAKULCS', '0')

    expect(() => assertRequiredEnv()).toThrowError(/kötelező/)
    expect(() => assertRequiredEnv()).not.toThrowError(/hagyd üresen/)
    expect(() => assertRequiredEnv()).not.toThrowError(/alapértelmezés: 27/)
  })

  it('MINDEN környezetben dob (nem csak élesben)', () => {
    // A '0' és a '27%' a két legvalószínűbb elgépelés — egyik sem érvényes kulcs.
    for (const nodeEnv of ['development', 'test', 'production']) {
      for (const badValue of ['0', '27%']) {
        vi.stubEnv('NODE_ENV', nodeEnv)
        vi.stubEnv('SZAMLAZZ_AFAKULCS', badValue)
        expect(() => assertRequiredEnv(), `${nodeEnv}/${badValue}`).toThrowError(
          /SZAMLAZZ_AFAKULCS/,
        )
      }
    }
  })
})

describe('assertRequiredEnv — környezetfüggő Barion POSKey (változatlan viselkedés)', () => {
  it('teszt-környezetben a BARION_POSKEY_TEST kell', () => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('BARION_POSKEY_TEST', undefined)

    expect(() => assertRequiredEnv()).toThrowError(/BARION_POSKEY_TEST/)
  })

  it('BARION_ENVIRONMENT=prod esetén az éles kulcs kell', () => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('BARION_ENVIRONMENT', 'prod')

    expect(() => assertRequiredEnv()).toThrowError(/BARION_POSKEY_PROD/)
  })
})

/**
 * B3 — a BARION_ENVIRONMENT ÉLESBEN KÖTELEZŐ.
 * A változó hiányában a Barion-kliens NÉMÁN a 'test' környezetre esik vissza,
 * és a BARION_POSKEY_TEST kulcsot használja. Élesben ez azt jelentené, hogy a
 * vásárló a Barion SANDBOXÁBAN fizet: a pénz sosem érkezik meg, a rendelés
 * viszont a „sikeres" teszt-válasz alapján paid lenne — hozzáféréssel és
 */
describe('assertRequiredEnv — BARION_ENVIRONMENT élesben kötelező (B3)', () => {
  it('PRODUCTION + hiányzó BARION_ENVIRONMENT → nem indul, néven nevezett magyar hibával', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('ENABLE_JOB_WORKERS', 'true')

    expect(() => assertRequiredEnv()).toThrowError(/BARION_ENVIRONMENT/)
    expect(() => assertRequiredEnv()).toThrowError(/nem indulhat el/)
  })

  it('PRODUCTION + üres/whitespace érték is hiánynak számít', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('ENABLE_JOB_WORKERS', 'true')
    vi.stubEnv('BARION_ENVIRONMENT', '   ')

    expect(() => assertRequiredEnv()).toThrowError(/BARION_ENVIRONMENT/)
  })

  it("PRODUCTION + 'prod' beállítás, de hiányzó éles POSKey → beszédes indulási hiba", () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('ENABLE_JOB_WORKERS', 'true')
    vi.stubEnv('BARION_ENVIRONMENT', 'prod')
    vi.stubEnv('BARION_POSKEY_PROD', undefined)

    expect(() => assertRequiredEnv()).toThrowError(/BARION_POSKEY_PROD/)
    expect(() => assertRequiredEnv()).toThrowError(/nem indulhat el/)
  })

  it("PRODUCTION + 'prod' + éles POSKey → elindul", () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('ENABLE_JOB_WORKERS', 'true')
    vi.stubEnv('BARION_ENVIRONMENT', 'prod')
    vi.stubEnv('BARION_API_URL', DUMMY_BARION_PROD_API_URL)
    vi.stubEnv('BARION_POSKEY_PROD', DUMMY_GUID_POS_KEY)

    expect(() => assertRequiredEnv()).not.toThrow()
  })

  it('NEM production: a hiányzó BARION_ENVIRONMENT változatlanul rendben (helyi fejlesztés)', () => {
    for (const nodeEnv of ['development', 'test']) {
      vi.stubEnv('NODE_ENV', nodeEnv)
      expect(() => assertRequiredEnv(), nodeEnv).not.toThrow()
    }
  })
})

/**
 * A BARION_ENVIRONMENT-et az env-assert is levágva (trim) hasonlítja, ahogy a
 * Barion-kliens. Korábban egy ' prod ' érték mellett az assert a TESZT-kulcsot
 * követelte meg, a kliens viszont az ÉLES kulcsot használta volna.
 */
describe('assertRequiredEnv — a BARION_ENVIRONMENT levágva számít', () => {
  it("' prod ' (szóközzel) mellett az éles kulcs kell, nem a teszt-kulcs", () => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('BARION_ENVIRONMENT', ' prod ')

    expect(() => assertRequiredEnv()).toThrowError(/BARION_POSKEY_PROD/)
  })
})

/**
 * Élesben a Barion-konfiguráció induláskor TELJESEN feloldódik: a környezet
 * és az API-hoszt összeillése és a POSKey alakja már itt bukik el, nem az első
 * vásárlónál. Az aktív környezet és hoszt egyszer, titokmentesen naplózódik.
 */
describe('assertRequiredEnv — a Barion-konfiguráció induláskori ellenőrzése élesben', () => {
  function stubLiveBarion(): void {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('ENABLE_JOB_WORKERS', 'true')
    vi.stubEnv('BARION_ENVIRONMENT', 'prod')
    vi.stubEnv('BARION_API_URL', DUMMY_BARION_PROD_API_URL)
    vi.stubEnv('BARION_POSKEY_PROD', DUMMY_GUID_POS_KEY)
  }

  function logLines(): Record<string, unknown>[] {
    const spy = vi.mocked(console.log)
    return spy.mock.calls.map((call) => JSON.parse(String(call[0])) as Record<string, unknown>)
  }

  it('induláskor egyszer naplózza a környezetet, a hosztot és a kulcs VÁLTOZÓNEVÉT, a kulcsot soha', () => {
    stubLiveBarion()

    assertRequiredEnv()

    const summaries = logLines().filter((line) => line.msg === 'barion_konfiguracio')
    expect(summaries).toHaveLength(1)
    expect(summaries[0]?.context).toEqual({
      barionEnvironment: 'prod',
      apiHost: 'api.barion.com',
      posKeyEnvName: 'BARION_POSKEY_PROD',
      payee: 'p***@dummy.example',
      postTimeoutMs: 35_000,
      getTimeoutMs: 15_000,
    })
    const output = JSON.stringify(vi.mocked(console.log).mock.calls)
    expect(output).not.toContain(DUMMY_GUID_POS_KEY)
    expect(output).not.toContain(DUMMY_BARION_PAYEE)
  })

  it("'prod' környezet + teszt API-hoszt → nem indul (a vásárló a sandboxban fizetne)", () => {
    stubLiveBarion()
    vi.stubEnv('BARION_API_URL', DUMMY_BARION_TEST_API_URL)

    expect(() => assertRequiredEnv()).toThrowError(/BARION_API_URL/)
    expect(() => assertRequiredEnv()).toThrowError(/nem indulhat el/)
  })

  it('hibás alakú POSKey → nem indul; az üzenet a változót nevezi meg, az értéket nem', () => {
    stubLiveBarion()
    const quotedKey = `"${DUMMY_GUID_POS_KEY}"`
    vi.stubEnv('BARION_POSKEY_PROD', quotedKey)

    let message = ''
    try {
      assertRequiredEnv()
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    expect(message).toMatch(/BARION_POSKEY_PROD/)
    expect(message).toMatch(/idézőjelet/)
    expect(message).toMatch(/nem indulhat el/)
    expect(message).not.toContain(DUMMY_GUID_POS_KEY)
  })

  it('érvénytelen BARION_ENVIRONMENT érték → nem indul', () => {
    stubLiveBarion()
    vi.stubEnv('BARION_ENVIRONMENT', 'staging')

    expect(() => assertRequiredEnv()).toThrowError(/BARION_ENVIRONMENT/)
  })

  // a-egyeztetes-6: a warn RIASZTÁS-ra erősödött (számlázás nélkül elindul).
  it('az éles oldal címén futó teszt-Barion, számlázás nélkül → RIASZTÁS (de elindul)', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('ENABLE_JOB_WORKERS', 'true')
    vi.stubEnv('BARION_ENVIRONMENT', 'test')
    const alert = vi.fn()

    for (const liveUrl of ['https://www.kineticare.hu', 'https://kineticare.hu/']) {
      alert.mockClear()
      vi.stubEnv('NEXT_PUBLIC_SERVER_URL', liveUrl)
      expect(() => assertRequiredEnv(undefined, alert), liveUrl).not.toThrow()
      const messages = alert.mock.calls.map((call) => String(call[0]))
      expect(
        messages.some((message) => message.startsWith('RIASZTÁS: az oldal az éles címen fut')),
        liveUrl,
      ).toBe(true)
      expect(alert.mock.calls.map((call) => call[1])).toContainEqual({
        valtozo: 'BARION_ENVIRONMENT',
      })
    }
  })

  it('nem éles címen a teszt-Barion rendben van, és éles Barionnál sincs ilyen riasztás', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('ENABLE_JOB_WORKERS', 'true')
    vi.stubEnv('BARION_ENVIRONMENT', 'test')
    const warn = vi.fn()

    const alert = vi.fn()
    assertRequiredEnv(warn, alert)
    expect(alert).not.toHaveBeenCalled()

    stubLiveBarion()
    vi.stubEnv('NEXT_PUBLIC_SERVER_URL', 'https://www.kineticare.hu')
    assertRequiredEnv(warn, alert)
    expect(alert).not.toHaveBeenCalled()
  })

  it('NEM production: a részletes Barion-ellenőrzés elmarad (álértékekkel is indul, napló nélkül)', () => {
    for (const nodeEnv of ['development', 'test']) {
      vi.stubEnv('NODE_ENV', nodeEnv)
      vi.stubEnv('BARION_API_URL', DUMMY_ENV_VALUE)
      vi.stubEnv('BARION_POSKEY_TEST', DUMMY_ENV_VALUE)
      expect(() => assertRequiredEnv(), nodeEnv).not.toThrow()
    }
    expect(logLines().filter((line) => line.msg === 'barion_konfiguracio')).toHaveLength(0)
  })
})

/**
 * ENABLE_JOB_WORKERS — élesben ez kapcsolja be a job-ütemezést (autoRun).
 * Nélküle nem fut a webhook-retry (elveszett callback újrapróbálása), az
 * order-poll (a payment_pending rendelések mentőhálója) és a számla-resweep
 * sem. Ez nem indulás-megakasztó hiba, de némán sem maradhat.
 */
describe('assertRequiredEnv — ENABLE_JOB_WORKERS élesben (warn)', () => {
  it('PRODUCTION + nincs bekapcsolva → warn-riasztás megy a hívónak (de elindul)', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('BARION_ENVIRONMENT', 'test')
    vi.stubEnv('ENABLE_JOB_WORKERS', undefined)
    const warn = vi.fn()

    expect(() => assertRequiredEnv(warn)).not.toThrow()
    const keys = warn.mock.calls.map((call) => call[0])
    expect(keys).toContain('job_workerek_kikapcsolva')
  })

  it("PRODUCTION + 'false' (elgépelt bekapcsolás) → szintén riaszt", () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('BARION_ENVIRONMENT', 'test')
    vi.stubEnv('ENABLE_JOB_WORKERS', 'false')
    const warn = vi.fn()

    assertRequiredEnv(warn)

    expect(warn.mock.calls.map((call) => call[0])).toContain('job_workerek_kikapcsolva')
  })

  it("PRODUCTION + 'true' → nincs job-worker riasztás", () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('BARION_ENVIRONMENT', 'test')
    vi.stubEnv('ENABLE_JOB_WORKERS', 'true')
    const warn = vi.fn()

    assertRequiredEnv(warn)

    expect(warn.mock.calls.map((call) => call[0])).not.toContain('job_workerek_kikapcsolva')
  })

  it('NEM production: kikapcsolt workerekre sem megy riasztás', () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('ENABLE_JOB_WORKERS', undefined)
    const warn = vi.fn()

    assertRequiredEnv(warn)

    expect(warn).not.toHaveBeenCalled()
  })
})

/**
 * NEXT_PUBLIC_SERVER_URL — a MEGLÉTE alapkulcsként ellenőrzött, itt az ALAKJA
 * a tét.
 *
 * Erre az értékre épül a Payload `serverURL`-je és a CORS/CSRF-engedélylistája
 * (src/payload.config.ts), a storefront `metadataBase`-e és az SEO-segédek
 * kanonikus gyökere. Hibás alaknál a lista olyan értékre állna, amire a
 * böngésző `Origin` fejléce sosem illeszkedik: az admin-bejelentkezés CSENDBEN
 * hasalna el. Ezért az alak-hiba már induláskor, minden környezetben megállítja
 * az appot — a `resolveServerUrl` viszont sosem dob, hogy a config betöltése
 * (tesztek, szkriptek) egy rossz env-től ne törjön el.
 */
describe('assertRequiredEnv — NEXT_PUBLIC_SERVER_URL alakja', () => {
  it('abszolút http/https cím rendben van (a záró perjeles alak is)', () => {
    vi.stubEnv('NODE_ENV', 'test')

    for (const value of [
      'http://localhost:3000',
      'https://kineticare.hu',
      'https://kineticare.hu/',
    ]) {
      vi.stubEnv('NEXT_PUBLIC_SERVER_URL', value)
      expect(() => assertRequiredEnv(), value).not.toThrow()
    }
  })

  it.each([
    ['séma nélküli hoszt', 'kineticare.hu'],
    ['nem URL szöveg', 'DUMMY-42'],
    ['protokoll-relatív cím', '//kineticare.hu'],
    ['gyökér-relatív útvonal', '/kineticare'],
    ['nem http(s) séma', 'ftp://kineticare.hu'],
  ])('hibás alak (%s) → már induláskor dob, magyar üzenettel', (_label, value) => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('NEXT_PUBLIC_SERVER_URL', value)

    expect(() => assertRequiredEnv()).toThrowError(/NEXT_PUBLIC_SERVER_URL/)
    expect(() => assertRequiredEnv()).toThrowError(/nem indulhat el/)
  })

  it('MINDEN környezetben dob (nem csak élesben)', () => {
    for (const nodeEnv of ['development', 'test', 'production']) {
      vi.stubEnv('NODE_ENV', nodeEnv)
      vi.stubEnv('NEXT_PUBLIC_SERVER_URL', 'kineticare.hu')
      expect(() => assertRequiredEnv(), nodeEnv).toThrowError(/NEXT_PUBLIC_SERVER_URL/)
    }
  })
})

/**
 * A publikus gyökér feloldása (`resolveServerUrl`) és az eredet-lista
 * (`buildOriginAllowlist`) — EGY env-értékből, ugyanazzal a normalizálással.
 * A `resolveServerUrl` fogyasztói: a storefront `metadataBase`-e és az SEO
 * `SITE_URL`-je; a `buildOriginAllowlist`-é a `cors` és a `csrf`.
 */
describe('resolveServerUrl / buildOriginAllowlist', () => {
  it('a záró perjelet levágja (az Origin fejlécben sincs)', () => {
    vi.stubEnv('NEXT_PUBLIC_SERVER_URL', 'https://kineticare.hu/')

    expect(resolveServerUrl()).toBe('https://kineticare.hu')
    expect(buildOriginAllowlist(process.env.NEXT_PUBLIC_SERVER_URL)[0]).toBe(
      'https://kineticare.hu',
    )
  })

  it('útvonal-előtagos gyökérnél az allowlist az EREDETET kapja', () => {
    vi.stubEnv('NEXT_PUBLIC_SERVER_URL', 'https://kineticare.hu/app')

    expect(resolveServerUrl()).toBe('https://kineticare.hu/app')
    // A böngésző Origin fejléce sosem tartalmaz útvonalat, tehát a teljes URL
    // allowlist-elemként sosem illeszkedne.
    expect(buildOriginAllowlist(process.env.NEXT_PUBLIC_SERVER_URL)[0]).toBe(
      'https://kineticare.hu',
    )
  })

  it('hiányzó vagy hibás env esetén a fejlesztői tartalék, dobás NÉLKÜL', () => {
    vi.stubEnv('NEXT_PUBLIC_SERVER_URL', undefined)
    expect(resolveServerUrl()).toBe(DEFAULT_SERVER_URL)

    vi.stubEnv('NEXT_PUBLIC_SERVER_URL', 'kineticare.hu')
    expect(resolveServerUrl()).toBe(DEFAULT_SERVER_URL)
    expect(buildOriginAllowlist(process.env.NEXT_PUBLIC_SERVER_URL)[0]).toBe(DEFAULT_SERVER_URL)
  })
})

/**
 * `buildOriginAllowlist` — a Payload `cors`/`csrf` listájának TISZTA építője
 * (src/env.ts), amit a src/payload.config.ts közvetlenül hív.
 *
 * Miért nyers bemenettel, külön tesztben: a bekötés-tesztben
 * (src/__tests__/payload-config.test.ts) az elvárt érték a resolverből jön, és
 * a teszt-környezetben nincs útvonal-előtagos gyökér — ott tehát a
 * „teljes URL vs. eredet" különbség NEM MÉRHETŐ, egy `[teljesURL]`-re rontott
 * bekötés is zöld maradna. Az ALÁBBI eset az, ami ezt megfogja.
 */
describe('buildOriginAllowlist', () => {
  it('útvonal-előtagos gyökérből CSAK az eredet kerül a listába', () => {
    // Ez a diszkrimináló eset: a teljes URL (`https://pelda.hu/app`) allowlist-
    // elemként SOSEM illeszkedne a böngésző Origin fejlécére.
    expect(buildOriginAllowlist('https://pelda.hu/app')).toEqual(['https://pelda.hu'])
    expect(buildOriginAllowlist('https://pelda.hu/app/')).toEqual(['https://pelda.hu'])
    expect(buildOriginAllowlist('https://pelda.hu/app?x=1#y')).toEqual(['https://pelda.hu'])
  })

  it('a portot MEGTARTJA (az eredet része), a záró perjelet elhagyja', () => {
    expect(buildOriginAllowlist('http://localhost:3000/')).toEqual(['http://localhost:3000'])
    expect(buildOriginAllowlist('https://pelda.hu:8443/app')).toEqual(['https://pelda.hu:8443'])
  })

  it('hiányzó vagy hibás értéknél a fejlesztői tartalék eredete, dobás NÉLKÜL', () => {
    const fallbackOrigin = new URL(DEFAULT_SERVER_URL).origin

    expect(buildOriginAllowlist(undefined)).toEqual([fallbackOrigin])
    expect(buildOriginAllowlist(null)).toEqual([fallbackOrigin])
    expect(buildOriginAllowlist('')).toEqual([fallbackOrigin])
    expect(buildOriginAllowlist('kineticare.hu')).toEqual([fallbackOrigin])
    expect(buildOriginAllowlist('ftp://kineticare.hu')).toEqual([fallbackOrigin])
  })

  /**
   * MINDEN hívás ÚJ tömböt ad: a Payload szanitálása a `csrf` tömbbe beleírhat
   * (node_modules/payload/dist/config/sanitize.js:340-342), közös referencia
   * mellett ez a `cors` listát is átírná.
   */
  it('minden hívás önálló tömböt ad vissza (a csrf-be a Payload beleír)', () => {
    const first = buildOriginAllowlist('https://pelda.hu')
    const second = buildOriginAllowlist('https://pelda.hu')

    expect(first).toEqual(second)
    expect(first).not.toBe(second)

    first.push('https://idegen.example')
    expect(second).toEqual(['https://pelda.hu'])
  })

  it('kineticare.hu primer mellett a www társ-eredet is a listán van', () => {
    expect(buildOriginAllowlist('https://kineticare.hu')).toEqual([
      'https://kineticare.hu',
      'https://www.kineticare.hu',
    ])
  })

  it('www.kineticare.hu primer mellett az apex is a listán van', () => {
    expect(buildOriginAllowlist('https://www.kineticare.hu')).toEqual([
      'https://www.kineticare.hu',
      'https://kineticare.hu',
    ])
  })

  it('nem-alapértelmezett port a társ-eredeten is megmarad', () => {
    expect(buildOriginAllowlist('https://kineticare.hu:8443/app')).toEqual([
      'https://kineticare.hu:8443',
      'https://www.kineticare.hu:8443',
    ])
  })

  it('extra eredetek a primer (és a társ) után, sorrendben, deduplikálva', () => {
    expect(
      buildOriginAllowlist(
        'https://shop.example.test',
        'https://kineticare.hu, https://www.kineticare.hu, https://kineticare.hu',
      ),
    ).toEqual(['https://shop.example.test', 'https://kineticare.hu', 'https://www.kineticare.hu'])
  })

  it('a társ-eredetet az extra lista nem ismétli', () => {
    expect(buildOriginAllowlist('https://kineticare.hu', 'https://www.kineticare.hu')).toEqual([
      'https://kineticare.hu',
      'https://www.kineticare.hu',
    ])
  })

  it('érvénytelen extra tokeneket kihagyja, nem dob', () => {
    expect(
      buildOriginAllowlist('https://pelda.hu', 'nem-url,ftp://x.hu,https://ok.example/app,'),
    ).toEqual(['https://pelda.hu', 'https://ok.example'])
  })

  it('üres extraRaw nem bővíti a listát', () => {
    expect(buildOriginAllowlist('https://pelda.hu', '')).toEqual(['https://pelda.hu'])
    expect(buildOriginAllowlist('https://pelda.hu', '   ')).toEqual(['https://pelda.hu'])
    expect(buildOriginAllowlist('https://pelda.hu', undefined)).toEqual(['https://pelda.hu'])
  })

  it('extraRaw mellett is minden hívás új tömb (nincs közös extra-referencia)', () => {
    const extras = 'https://a.example,https://b.example'
    const first = buildOriginAllowlist('https://pelda.hu', extras)
    const second = buildOriginAllowlist('https://pelda.hu', extras)

    expect(first).toEqual(second)
    expect(first).not.toBe(second)

    first.push('https://idegen.example')
    expect(second).toEqual(['https://pelda.hu', 'https://a.example', 'https://b.example'])
  })
})

describe('EMAIL_FROM — levélküldő mellett kötelező', () => {
  /**
   * MIÉRT ŐRIZZÜK: az `EMAIL_FROM` hiánya a `noreply@localhost` tartalékra esik
   * (src/lib/email/mask.ts). Levélküldő nélkül ez ártalmatlan, DE amint valaki
   * beállítja a RESEND_API_KEY-t, minden levél egy nem létező címről indulna,
   * a `sendMail` pedig sosem dob — a levelek CSENDBEN nem érkeznének meg.
   * Pontosan ez a hibakép, amit az audit az ingyenes kurzusnál mért.
   */
  it('RESEND_API_KEY mellett EMAIL_FROM nélkül HANGOSAN megáll', () => {
    vi.stubEnv('RESEND_API_KEY', DUMMY_ENV_VALUE)
    vi.stubEnv('EMAIL_FROM', '')
    expect(() => assertRequiredEnv()).toThrowError(/EMAIL_FROM/)
  })

  it('SMTP_HOST mellett ugyanígy', () => {
    vi.stubEnv('SMTP_HOST', 'dummy.example')
    vi.stubEnv('EMAIL_FROM', '')
    expect(() => assertRequiredEnv()).toThrowError(/EMAIL_FROM/)
  })

  it('e-mail-címnek NEM látszó értéket sem fogad el', () => {
    vi.stubEnv('RESEND_API_KEY', DUMMY_ENV_VALUE)
    vi.stubEnv('EMAIL_FROM', 'Kineticare')
    expect(() => assertRequiredEnv()).toThrowError(/EMAIL_FROM/)
  })

  it('rendes küldő-címmel elindul (név + cím alak is jó)', () => {
    vi.stubEnv('RESEND_API_KEY', DUMMY_ENV_VALUE)
    vi.stubEnv('EMAIL_FROM', 'Kineticare <noreply@dummy.example>')
    expect(() => assertRequiredEnv()).not.toThrow()
  })

  it('levélküldő NÉLKÜL az EMAIL_FROM továbbra sem kötelező', () => {
    // Fejlesztés és CI: a noop-provider fut, nincs mit elrontani.
    vi.stubEnv('EMAIL_FROM', '')
    expect(() => assertRequiredEnv()).not.toThrow()
  })
})

/**
 * w1-barion-platform (6): az éles címen (https://www.kineticare.hu) a
 * veszélyes kombinációk nem indulhatnak. Az éles napló (2026-09-24) szerint a
 * mai állapot egyiket sem sérti: barionEnvironment 'prod', a workerek futnak.
 * Az üzenet a változókat nevezi meg, az értékeket soha.
 */
describe('assertRequiredEnv — indulási őrök az éles címen', () => {
  const LIVE_URL = 'https://www.kineticare.hu'
  const SECRETISH_AGENT_KEY = 'dummy-agent-kulcs-ertek-nem-kerulhet-az-uzenetbe'

  function stubLiveTestBarion(): void {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_SERVER_URL', LIVE_URL)
    vi.stubEnv('BARION_ENVIRONMENT', 'test')
    vi.stubEnv('ENABLE_JOB_WORKERS', 'true')
  }

  function thrownMessage(run: () => void): string {
    try {
      run()
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
    return ''
  }

  it('teszt-Barion + bekapcsolt számlázás az éles címen → nem indul; változónevek, érték nélkül', () => {
    stubLiveTestBarion()
    vi.stubEnv('SZAMLAZZ_AGENT_KEY', SECRETISH_AGENT_KEY)
    vi.stubEnv('SZAMLAZZ_AFAKULCS', 'AAM')

    const message = thrownMessage(() => assertRequiredEnv(vi.fn(), vi.fn()))

    expect(message).toMatch(/nem indulhat el/)
    expect(message).toContain('BARION_ENVIRONMENT')
    expect(message).toContain('SZAMLAZZ_AGENT_KEY')
    expect(message).not.toContain(SECRETISH_AGENT_KEY)
    expect(message).not.toContain(DUMMY_GUID_POS_KEY)
  })

  it('ugyanez nem éles címen (staging) elindul', () => {
    stubLiveTestBarion()
    vi.stubEnv('NEXT_PUBLIC_SERVER_URL', DUMMY_SERVER_URL)
    vi.stubEnv('SZAMLAZZ_AGENT_KEY', SECRETISH_AGENT_KEY)
    vi.stubEnv('SZAMLAZZ_AFAKULCS', 'AAM')

    expect(() => assertRequiredEnv(vi.fn(), vi.fn())).not.toThrow()
  })

  it('kikapcsolt job-workerek az éles címen nyugtázás nélkül → nem indul, a nyugtázó változót megnevezi', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_SERVER_URL', LIVE_URL)
    vi.stubEnv('BARION_ENVIRONMENT', 'prod')
    vi.stubEnv('BARION_API_URL', DUMMY_BARION_PROD_API_URL)
    vi.stubEnv('BARION_POSKEY_PROD', DUMMY_GUID_POS_KEY)

    for (const value of [undefined, 'false', 'TRUE']) {
      vi.stubEnv('ENABLE_JOB_WORKERS', value)
      const message = thrownMessage(() => assertRequiredEnv(vi.fn(), vi.fn()))
      expect(message, String(value)).toMatch(/nem indulhat el/)
      expect(message).toContain('ENABLE_JOB_WORKERS')
      expect(message).toContain(`${JOB_WORKERS_OFF_CONFIRM_ENV}=igen`)
      expect(message).toContain('egyetlen számla sem áll ki')
    }
  })

  it('nyugtázással (JOB_WORKERS_OFF_CONFIRM=igen) elindul, de RIASZTÁS megy; más érték nem nyugtáz', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_SERVER_URL', LIVE_URL)
    vi.stubEnv('BARION_ENVIRONMENT', 'prod')
    vi.stubEnv('BARION_API_URL', DUMMY_BARION_PROD_API_URL)
    vi.stubEnv('BARION_POSKEY_PROD', DUMMY_GUID_POS_KEY)
    vi.stubEnv('ENABLE_JOB_WORKERS', undefined)

    vi.stubEnv(JOB_WORKERS_OFF_CONFIRM_ENV, 'true')
    expect(() => assertRequiredEnv(vi.fn(), vi.fn())).toThrowError(/nem indulhat el/)

    vi.stubEnv(JOB_WORKERS_OFF_CONFIRM_ENV, 'igen')
    const alert = vi.fn()
    expect(() => assertRequiredEnv(vi.fn(), alert)).not.toThrow()
    expect(alert.mock.calls.map((call) => String(call[0]))).toContainEqual(
      expect.stringMatching(
        /^RIASZTÁS: a job-workerek az éles címen tudatosan ki vannak kapcsolva/,
      ),
    )
  })

  it('nem éles címen a job-worker figyelmeztetés kimondja, hogy számla sem áll ki', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('BARION_ENVIRONMENT', 'test')
    vi.stubEnv('ENABLE_JOB_WORKERS', undefined)
    const warn = vi.fn()

    assertRequiredEnv(warn, vi.fn())

    const call = warn.mock.calls.find((entry) => entry[0] === 'job_workerek_kikapcsolva')
    expect(JSON.stringify(call?.[1])).toContain('egyetlen számla sem áll ki')
  })
})

describe('assertRequiredEnv — a SZAMLAZZ_AGENT_KEY kisbetűs kell legyen (r-szamlazz-14)', () => {
  it.each(['production', 'development'])(
    '%s: nagybetűs kulcs → RIASZTÁS a változó nevével, az érték nélkül',
    (nodeEnv) => {
      vi.stubEnv('NODE_ENV', nodeEnv)
      if (nodeEnv === 'production') {
        vi.stubEnv('BARION_ENVIRONMENT', 'test')
        vi.stubEnv('ENABLE_JOB_WORKERS', 'true')
      }
      vi.stubEnv('SZAMLAZZ_AFAKULCS', 'AAM')
      vi.stubEnv('SZAMLAZZ_AGENT_KEY', 'dummy-Nagybetus-Kulcs-Nem-Valodi')
      const alert = vi.fn()

      assertRequiredEnv(vi.fn(), alert)

      const matching = alert.mock.calls.filter((call) =>
        String(call[0]).includes('nagybetűt tartalmaz'),
      )
      expect(matching).toHaveLength(1)
      expect(String(matching[0]?.[0])).toMatch(/^RIASZTÁS/)
      expect(matching[0]?.[1]).toEqual({ valtozo: 'SZAMLAZZ_AGENT_KEY' })
      expect(JSON.stringify(alert.mock.calls)).not.toContain('Nagybetus')
    },
  )

  it('kisbetűs kulcsnál nincs ilyen riasztás', () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('SZAMLAZZ_AFAKULCS', 'AAM')
    vi.stubEnv('SZAMLAZZ_AGENT_KEY', 'dummy-kisbetus-kulcs-nem-valodi')
    const alert = vi.fn()

    assertRequiredEnv(vi.fn(), alert)

    expect(alert).not.toHaveBeenCalled()
  })
})
