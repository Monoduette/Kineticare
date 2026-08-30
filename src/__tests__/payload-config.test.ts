import type { Payload } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'

import { buildOriginAllowlist } from '../env'
import configPromise from '../payload.config'

/** A szanitált config típusa — a Payload `SanitizedConfig`-ja, importálás nélkül. */
type SanitizedPayloadConfig = Awaited<typeof configPromise>

/**
 * A Media `url` mezőinek afterRead hookja — CSAK az az argumentum-részhalmaz,
 * amit a Payload implementációja ténylegesen olvas
 * (node_modules/payload/dist/uploads/getBaseFields.js:98-107 és :190-197).
 */
interface UrlAfterReadArgs {
  collection: { slug: string }
  data: Record<string, unknown>
  originalDoc: Record<string, unknown>
  req: { payload: { config: SanitizedPayloadConfig } }
  value: unknown
}

type UrlAfterReadHook = (args: UrlAfterReadArgs) => unknown

/** Mezőfa-csomópont a bejáráshoz (a méretek beágyazott csoportokban ülnek). */
interface FieldNode {
  name?: string
  fields?: FieldNode[]
  hooks?: { afterRead?: UrlAfterReadHook[] }
}

/**
 * A mezőfa ÖSSZES `url` nevű mezőjének afterRead hookja, útvonal-címkével.
 *
 * A gyökér-`url` és a `sizes.<méret>.url` mezők ugyanazt a hibát hordozzák,
 * ezért mindegyiket meg kell mérni — a címke miatt a bukás megmondja, melyiket.
 */
function collectUrlAfterReadHooks(
  fields: readonly unknown[],
  prefix = '',
): Array<{ path: string; hook: UrlAfterReadHook }> {
  const found: Array<{ path: string; hook: UrlAfterReadHook }> = []
  for (const rawField of fields) {
    const field = rawField as FieldNode
    const path = field.name ? `${prefix}${field.name}` : prefix
    if (field.name === 'url') {
      for (const hook of field.hooks?.afterRead ?? []) {
        found.push({ path, hook })
      }
    }
    if (Array.isArray(field.fields)) {
      found.push(...collectUrlAfterReadHooks(field.fields, `${path}.`))
    }
  }
  return found
}

/** Tesztadat a hook-hívásokhoz — DB nélkül, csak fájlnevek kellenek. */
const FILENAME = 'kineticare-kep.jpg'
const SIZES_DATA: Record<string, { filename: string }> = {
  xs: { filename: 'kineticare-kep-320x200.jpg' },
  sm: { filename: 'kineticare-kep-640x400.jpg' },
  md: { filename: 'kineticare-kep-1280x800.jpg' },
  lg: { filename: 'kineticare-kep-1920x1200.jpg' },
  og: { filename: 'kineticare-kep-1200x630.jpg' },
}

/**
 * Smoke-teszt: a payload.config betöltődik, és a várt collection-slugok
 * (saját + ecommerce plugin) léteznek a végleges, szanitált konfigban.
 */
describe('payload.config', () => {
  it('tartalmazza a várt collection-slugokat', async () => {
    const config = await configPromise

    const slugs = (config.collections ?? []).map((collection) => collection.slug)

    const expectedSlugs = [
      // saját collectionök
      'users',
      'media',
      'pages',
      'posts',
      'menus',
      'categories',
      'testimonials',
      // ecommerce plugin collectionjei
      'products',
      'carts',
      'transactions',
      'orders',
    ]

    for (const slug of expectedSlugs) {
      expect(slugs).toContain(slug)
    }

    // Kikapcsolt plugin-felületek: nincs addresses és nincs variants-collection.
    expect(slugs).not.toContain('addresses')
    expect(slugs).not.toContain('variants')
    expect(slugs).not.toContain('variantTypes')
    expect(slugs).not.toContain('variantOptions')

    // T-019: a feltöltési méretkorlát globálisan 10 MB (bájtban).
    expect(config.upload?.limits?.fileSize).toBe(10485760)
  })

  /**
   * K1: a 10 MB-os feltöltési korlát (T-019) önmagában NÉMÁN csonkolna — a
   * multipart-parser `truncated: true`-val fogadná el a túlméretes fájlt, és a
   * feltöltés sikeresnek látszana egy hibás fájllal. Az `abortOnLimit: true`
   * kapcsolja elutasításra: 413 + a `responseOnLimit` magyar üzenet
   * (payload/dist/uploads/fetchAPI-multipart/processMultipart.js — a config
   * upload-blokkja 1:1-ben a parser opcióira megy,
   * utilities/addDataAndFileToRequest.js).
   */
  it('a túlméretes feltöltés 413-as ELUTASÍTÁST kap (abortOnLimit), magyar üzenettel (K1)', async () => {
    const config = await configPromise

    expect(config.upload?.limits?.fileSize).toBe(10485760)
    expect(config.upload?.abortOnLimit).toBe(true)
    expect(config.upload?.responseOnLimit).toBe(
      'A fájl mérete meghaladja a megengedett 10 MB-os korlátot.',
    )
  })

  /**
   * C1/A2 biztonsági zárás: a GraphQL API-nak KIKAPCSOLVA kell maradnia. A
   * beépített resetPasswordUser/forgotPasswordUser mutációk a
   * resetPasswordOperation-ön át megkerülnék a szerveroldali jelszó-politikát
   * (src/lib/security/reset-password-route.ts) és az IP-alapú kérés-korlátot.
   * Visszakapcsolás előtt ezekre őrt kell építeni.
   */
  it('a GraphQL API le van tiltva (jelszó-politika + rate-limit megkerülhetetlensége)', async () => {
    const config = await configPromise

    expect(config.graphQL?.disable).toBe(true)
  })

  /**
   * CORS/CSRF-engedélylista a publikus gyökér EREDETÉHEZ kötve.
   *
   * Beállítás nélkül a `csrf` üres, az `extractJWT` pedig üres listánál MINDEN
   * eredetről elfogadja a süti-tokent
   * (node_modules/payload/dist/auth/extractJWT.js:21 és :27). A lista a
   * `NEXT_PUBLIC_SERVER_URL`-ből származik (src/env.ts) — ugyanabból a
   * forrásból, mint a storefront `metadataBase`-e és az SEO-segédek gyökere,
   * hogy a védett és a hirdetett cím ne csúszhasson szét.
   *
   * Az elvárt értéket a resolverből vesszük, nem beégetve: így a teszt attól
   * függetlenül a bekötést méri, hogy a futtató környezetben be van-e állítva a
   * `NEXT_PUBLIC_SERVER_URL` (CI-ben nincs, a fejlesztői gépen lehet). Magának a
   * `buildOriginAllowlist`-nek a SZŰKÍTÉSÉT — az útvonal-előtag levágását — a
   * src/__tests__/security/env-assert.test.ts méri, mert az az eset a
   * teszt-környezetben sosem áll elő magától.
   */
  it('a CORS/CSRF-engedélylista a publikus gyökér EREDETÉHEZ van kötve', async () => {
    const config = await configPromise

    // Az allowlist az EREDETET tartalmazza (primer + kineticare társ + extra).
    // A két hívás KÜLÖN tömb, mert a Payload a csrf-be beleírhat.
    const expected = buildOriginAllowlist(
      process.env.NEXT_PUBLIC_SERVER_URL,
      process.env.EXTRA_ALLOWED_ORIGINS,
    )
    expect(config.cors).toEqual(expected)
    expect(config.cors).not.toBe(config.csrf)
    for (const origin of expected) {
      expect(config.csrf).toContain(origin)
    }

    /*
     * Tartalmi állítás a korábbi VAK `expect(config.cors).not.toBe('*')` helyett:
     * a `cors` TÖMB, egy tömb pedig sosem azonos a `'*'` stringgel — az a sor
     * akkor is teljesült volna, ha a lista mindent átenged. Amit ténylegesen
     * meg kell követelni: a lista nem üres, és minden eleme PONTOSAN egy eredet
     * (nincs benne útvonal, záró perjel és nincs benne a „mindent enged" `'*'`).
     */
    expect(Array.isArray(config.cors)).toBe(true)
    const corsOrigins = config.cors as string[]
    expect(corsOrigins.length).toBeGreaterThan(0)
    for (const origin of corsOrigins) {
      expect(origin).not.toBe('*')
      expect(origin).toBe(new URL(origin).origin)
    }
  })

  /**
   * A `serverURL` SZÁNDÉKOSAN ÜRES — ez döntés, nem feledékenység.
   *
   * Beállítva ELTÖRNÉ AZ ÖSSZES CMS-KÉPET: a Media `url` és `sizes.*.url`
   * mezőinek afterRead hookja `relative: false` + a config `serverURL`-jével
   * hívja a `generateFilePathOrURL`-t, ami ilyenkor ABSZOLÚT URL-t ad vissza
   * (node_modules/payload/dist/utilities/formatAdminURL.js). A storefront
   * viszont a `next/image`-nek adja tovább (src/components/content/MediaImage.tsx),
   * és a next.config.ts-ben NINCS `images.remotePatterns` → a `/_next/image`
   * élesben 400-at ad. A védelmet ez nem gyengíti: az `extractJWT` a `csrf`,
   * a `headersWithCors` pedig a `cors` listát nézi — egyik sem a `serverURL`-t.
   *
   * A hatás mérése a következő tesztben (a hook tényleges kimenetén) van; itt
   * maga a beállítás rögzül, hogy egy „hiányzik, pótoljuk" reflex ne írja vissza.
   */
  it('a serverURL szándékosan ÜRES (a Payload alapértelmezése) — nem feledékenység', async () => {
    const config = await configPromise

    expect(config.serverURL).toBe('')
  })

  /**
   * REGRESSZIÓS TESZT: a Media `url` mezők GYÖKÉR-RELATÍV utat adnak vissza.
   *
   * Ez fogja meg magát a hibát, nem a beállítást: a szanitált configból
   * kiszedjük a media collection `url` mezőinek afterRead hookjait (a gyökér-
   * URL-ét és a méretekét is), lefuttatjuk őket, és megköveteljük, hogy a
   * kimenet `/`-rel kezdődjön. Adatbázis nem kell — a hook tiszta
   * útvonal-számítás.
   *
   * Ha a `serverURL` visszakerül a configba, ez a teszt BUKIK: a hook abszolút
   * URL-t adna, amit a `next/image` `images.remotePatterns` nélkül 400-zal
   * utasít el.
   */
  it('a Media url-mezői GYÖKÉR-RELATÍV utat adnak (a next/image nem 400-zik)', async () => {
    const config = await configPromise

    const media = (config.collections ?? []).find((collection) => collection.slug === 'media')
    expect(media).toBeDefined()

    const hooks = collectUrlAfterReadHooks(media?.fields ?? [])
    // A gyökér-URL + mind a hat méret hookja meglegyen. Ha a Payload átalakítja
    // a mezőfát (vagy egy méret kiesik a Media collectionből), inkább bukjon,
    // mint hogy némán 0 hookon „menjen át" a teszt.
    expect(hooks.map((entry) => entry.path)).toEqual([
      'url',
      'sizes.xs.url',
      'sizes.sm.url',
      'sizes.md.url',
      'sizes.lg.url',
      'sizes.og.url',
    ])

    for (const { path, hook } of hooks) {
      const result = hook({
        collection: { slug: 'media' },
        data: { filename: FILENAME, sizes: SIZES_DATA },
        originalDoc: { filename: FILENAME, sizes: SIZES_DATA },
        req: { payload: { config } },
        value: undefined,
      })

      expect(typeof result, path).toBe('string')
      const url = result as string
      expect(url.startsWith('/'), `${path} → ${url}`).toBe(true)
      // A next/image a saját eredetről szolgált, gyökér-relatív utat kezeli
      // loader-konfiguráció nélkül; abszolút („távoli") forrásra 400 jön.
      expect(/^https?:\/\//i.test(url), `${path} → ${url}`).toBe(false)
      expect(url, path).toContain('/media/file/')
    }
  })

  /**
   * Magyar admin felület: a staff („a lányok") nem szakember, ezért az admin
   * alapnyelve magyar. A fallbackLanguage a döntő beállítás — a nem szerkesztett
   * kulcsok is ezen a nyelven jelennek meg —, az `en` pedig választható marad.
   * A teszt őrzi, hogy az i18n-blokk ne essen ki a configból.
   */
  it('az admin felület magyar (i18n fallback: hu, en választható)', async () => {
    const config = await configPromise

    expect(config.i18n.fallbackLanguage).toBe('hu')

    const supported = Object.keys(config.i18n.supportedLanguages ?? {})
    expect(supported).toContain('hu')
    expect(supported).toContain('en')
  })

  /** A böngészőfülön látszó cím-utótag (admin.meta) — szintén magyar felület. */
  it('az admin cím-utótagja be van állítva', async () => {
    const config = await configPromise

    expect(config.admin?.meta?.titleSuffix).toBe(' – Kineticare admin')
  })

  /**
   * Az e-mail-adapter E-MAIL-KULCS NÉLKÜL is inicializálható.
   *
   * Ez a teszt maga a bizonyíték: a tesztkörnyezetben nincs RESEND_API_KEY és
   * nincs SMTP_HOST sem, mégis betöltődik a config és felépül az adapter. A
   * provider ilyenkor `noop`-ra esik (egyszeri figyelmeztetéssel), tehát a
   * boot, a tesztek és a CI e-mail-konfiguráció nélkül is működik.
   */
  it('az e-mail-adapter e-mail-kulcs nélkül is felépül (a boot nem bukik el)', async () => {
    const config = await configPromise

    expect(process.env.RESEND_API_KEY).toBeUndefined()
    expect(typeof config.email).toBe('function')

    const adapter = (
      config.email as unknown as (args: { payload: unknown }) => {
        name: string
        sendEmail: unknown
      }
    )({ payload: {} })
    expect(adapter.name).toBe('kineticare-provider')
    expect(typeof adapter.sendEmail).toBe('function')
  })

  /**
   * A Railway privát hálózata elvágja a tétlen TCP-kapcsolatokat. Keepalive és
   * idle-timeout nélkül a `pg` a halott socketet használja újra, és a kérés a
   * TCP retransmission-timeoutig (~45 mp) áll, majd „Connection terminated
   * unexpectedly" hibával dől el — emiatt akadt el az admin user létrehozása.
   * Ez a teszt őrzi, hogy a pool-hangolás ne essen ki a konfigból.
   */
  it('a Postgres-pool tétlen-kapcsolat elleni beállításai a helyükön vannak', async () => {
    const config = await configPromise

    const adapter = (
      config.db as unknown as { init: (args: { payload: unknown }) => { poolOptions?: unknown } }
    ).init({ payload: {} })
    const poolOptions = adapter.poolOptions as Record<string, unknown>

    expect(poolOptions.keepAlive).toBe(true)
    expect(poolOptions.keepAliveInitialDelayMillis).toBe(10_000)
    expect(poolOptions.idleTimeoutMillis).toBe(30_000)
    expect(poolOptions.connectionTimeoutMillis).toBe(10_000)
    expect(poolOptions.statement_timeout).toBe(30_000)
    expect(poolOptions.query_timeout).toBe(30_000)
  })

  it('a request tranzakciók READ COMMITTED izolációt használnak', async () => {
    const config = await configPromise
    const adapter = (
      config.db as unknown as {
        init: (args: { payload: unknown }) => { transactionOptions?: unknown }
      }
    ).init({ payload: {} })

    expect(adapter.transactionOptions).toEqual({ isolationLevel: 'read committed' })
  })

  /**
   * C13 — a 2026-08-06-i sorzár-incidens: egy nyitva maradt, TÉTLEN tranzakció
   * zárolta a `users` sort, és minden írás/bejelentkezés befagyott (olvasás
   * közben gyors maradt). A statement_timeout ezen nem segít, mert az a futó
   * lekérdezést öli meg — itt viszont éppen nem futott lekérdezés. Az
   * `idle_in_transaction_session_timeout` a kapcsolat startup-paramétereként
   * megy át a Postgresnek, így DB-oldali ALTER SYSTEM nélkül is minden
   * pool-kapcsolatra érvényes. Ez a teszt őrzi, hogy ne essen ki a configból.
   */
  it('a pool kapcsolat-szinten kikényszeríti az idle_in_transaction_session_timeout-ot', async () => {
    const config = await configPromise

    const adapter = (
      config.db as unknown as { init: (args: { payload: unknown }) => { poolOptions?: unknown } }
    ).init({ payload: {} })
    const poolOptions = adapter.poolOptions as Record<string, unknown>

    expect(poolOptions.idle_in_transaction_session_timeout).toBe(60_000)
    // A tétlen tranzakcióra szabott korlát a futó lekérdezésé fölött van, hogy
    // a normál (aktív) hosszú műveletekbe — migráció, seed — ne szóljon bele.
    expect(poolOptions.idle_in_transaction_session_timeout).toBeGreaterThan(
      poolOptions.statement_timeout as number,
    )
  })

  /**
   * A pool `error` eseményét le KELL kezelni: a Railway privát hálója elvágja a
   * tétlen TCP-kapcsolatokat, és a kezeletlen esemény `uncaughtException`-ként
   * viszi el a Next.js szerverfolyamatot (CLAUDE.md 7. üzemeltetési tanulság).
   * A regisztráció korábban az űrlap-seedelő mellékhatásaként futott — ez a
   * teszt őrzi, hogy önálló, az induláskori lánc ELSŐ lépése maradjon, és
   * akkor is megtörténjen, ha a seedelő elhasal (pl. migráció előtti DB).
   */
  it('induláskor regisztrálja a Postgres-pool error-handlerét', async () => {
    const config = await configPromise
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const on = vi.fn()
    const fakePayload = {
      db: { pool: { on } },
      // A seedelő első lépése — a hibája (best-effort ág) nem akadályozhatja meg
      // a handler regisztrációját.
      find: async () => {
        throw new Error('nincs adatbázis')
      },
    } as unknown as Payload

    try {
      await config.onInit?.(fakePayload)
    } finally {
      logSpy.mockRestore()
    }

    expect(on).toHaveBeenCalledWith('error', expect.any(Function))
  })
})

/**
 * A `push: false` a postgres-adapterben azt zárja ki, hogy a dev-módú drizzle
 * séma-push interaktív, TÁBLATÖRLÉST kínáló promptot adjon — amin minden
 * nem-interaktív futás (script, CI, ügynök) némán, örökre megakad (mérve:
 * a GET /admin 90 mp után is válasz nélkül, a folyamat ep_poll-ban). A séma
 * egyetlen útja a verziózott migrációs lánc (CLAUDE.md 3. tilos zóna).
 */
describe('postgres-adapter — a dev-push kikapcsolva marad', () => {
  it('a payload.config.ts tartalmazza a push: false kapcsolót', () => {
    const source = readFileSync(new URL('../payload.config.ts', import.meta.url), 'utf8')
    expect(source).toMatch(/push:\s*false/)
    expect(source).not.toMatch(/push:\s*true/)
  })
})
