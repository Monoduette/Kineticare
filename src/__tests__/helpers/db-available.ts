import net from 'node:net'

/**
 * Elérhető-e TÉNYLEGESEN a teszt-adatbázis?
 * A DB-függő tesztfájlok korábban csak a DATABASE_URI + PAYLOAD_SECRET env
 * MEGLÉTÉT nézték — a CI-kapu viszont álértékű DATABASE_URI-t exportál (a
 * production-buildhez kell), amely 127.0.0.1:5432-re mutat, ahol nem fut
 * Postgres. Az env-alapú kapcsoló így hamis pozitívot adott: a tesztek
 */

/** A CI-fail-closed hibaüzenet állandó előtagja — a teszt-őr erre illeszt. */
export const CI_DB_REQUIRED_PREFIX =
  'A DB-függő tesztek CI-ban nem hagyhatók ki, de az adatbázis nem érhető el:'

/** A hibaüzenet záró, teendőt megnevező része. */
const CI_DB_REQUIRED_HINT =
  'A CI `verify` jobjában Postgres service-konténer fut, a DATABASE_URI és a PAYLOAD_SECRET ' +
  'a job env-jéből jön, a sémát pedig az `npx payload migrate` lépés hozza létre ' +
  '(a dev-módú séma-push ki van kapcsolva, tehát séma CSAK migrációból keletkezik). ' +
  'Ellenőrizd, hogy mindhárom megvan-e a .github/workflows/ci.yml `verify` jobjában. ' +
  'A kihagyás azért nem engedhető meg, mert némán csökkentené a lefedettséget: ' +
  'az így kiiktatott őrök egyike a rendelés ár-snapshotját védi (a kliens ára sosem ' +
  'írhatja felül a szerver árát), ami a Barion-fizetés összegének egyetlen forrása.'

interface ProbeResult {
  readonly reachable: boolean
  /** Miért NEM érhető el — titkot sosem tartalmaz (a DATABASE_URI-t nem). */
  readonly reason?: string
}

/**
 * CI-futás-e?
 *
 * A GitHub Actions minden lépésnél `CI=true`-t exportál; más futtatók is ezt a
 * de facto szabványt követik. Az üres, `'false'` és `'0'` értéket
 * KIKAPCSOLTNAK vesszük — némelyik eszköz így jelzi a nem-CI futást, és egy
 * ilyen érték nem foszthatja meg a fejlesztőt a helyi, adatbázis nélküli
 * futástól.
 */
export function isContinuousIntegration(): boolean {
  const raw = process.env.CI
  if (typeof raw !== 'string') {
    return false
  }
  const value = raw.trim().toLowerCase()
  return value.length > 0 && value !== 'false' && value !== '0'
}

/** A tényleges elérhetőség-vizsgálat — env-ellenőrzés + TCP-próba. */
async function probeDatabase(): Promise<ProbeResult> {
  const uri = process.env.DATABASE_URI
  if (!uri) {
    return { reachable: false, reason: 'a DATABASE_URI környezeti változó nincs beállítva' }
  }
  if (!process.env.PAYLOAD_SECRET) {
    return { reachable: false, reason: 'a PAYLOAD_SECRET környezeti változó nincs beállítva' }
  }

  let host: string
  let port: number
  try {
    const parsed = new URL(uri)
    host = parsed.hostname || '127.0.0.1'
    port = parsed.port ? Number(parsed.port) : 5432
  } catch {
    // A nyers érték SZÁNDÉKOSAN nem kerül az üzenetbe: jelszót tartalmazhat.
    return { reachable: false, reason: 'a DATABASE_URI nem értelmezhető kapcsolati URL-ként' }
  }

  const target = `${host}:${port}`
  const reachable = await new Promise<boolean>((resolve) => {
    const socket = net.connect({ host, port })
    const finish = (result: boolean): void => {
      socket.destroy()
      resolve(result)
    }
    socket.setTimeout(1500, () => finish(false))
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
  })

  return reachable
    ? { reachable: true }
    : { reachable: false, reason: `a(z) ${target} címen nem fogad kapcsolatot adatbázis` }
}

/**
 * Elérhető-e a teszt-adatbázis?
 *
 * Helyben: `false` = a hívó `describe.skipIf`-je csendben kihagyja a blokkot.
 * CI-ban: nincs `false` — az elérhetetlen adatbázis DOB (lásd a fájl fejlécét).
 */
export async function isDatabaseAvailable(): Promise<boolean> {
  const { reachable, reason } = await probeDatabase()

  if (!reachable && isContinuousIntegration()) {
    throw new Error(`${CI_DB_REQUIRED_PREFIX} ${reason}. ${CI_DB_REQUIRED_HINT}`)
  }

  return reachable
}
