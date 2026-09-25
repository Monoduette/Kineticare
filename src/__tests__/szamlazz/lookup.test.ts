import { afterEach, describe, expect, it, vi } from 'vitest'

import { getSzamlazzConfig, parseAgentResponse, postInvoiceXml } from '../../lib/szamlazz/client'
import {
  buildInvoiceLookupXml,
  queryInvoiceByKulsoAzon,
  SZAMLAZZ_NOT_FOUND_CODE,
} from '../../lib/szamlazz/pdf'
import { postStornoXml } from '../../lib/szamlazz/storno'
import { SzamlazzApiError } from '../../lib/szamlazz/types'

/**
 * Bizonylat-lekérdezés (xmlszamlapdf / action-szamla_agent_pdf) egységtesztek —
 * az IDEMPOTENCIA-FELOLDÁS magja: a „kérés elment, válasz elveszett" esetben és
 * a 71/152-es duplikátum-jelzésnél ez adja vissza a már kiállt bizonylat számát.
 *
 * A hálózat MINDENHOL mockolt (vi.stubGlobal('fetch')) — ebből a suite-ból
 * egyetlen kérés sem mehet ki a valódi Számlázz.hu-ra.
 *
 * DUMMY érték, egyértelműen jelölve — NEM valódi Számla Agent kulcs.
 */
const DUMMY_AGENT_KEY = 'DUMMY-AGENT-KULCS-NEM-VALODI-TITOK'

const ORDER_NUMBER = 'KH-2026-000123'
const FOUND_INVOICE_NUMBER = 'KIN-2026-7'

/** A lekérdező XML multipart-mezőneve (a kiállítóé az action-xmlagentxmlfile). */
const LOOKUP_FIELD = 'action-szamla_agent_pdf'

// Az áfakulcs 2026-08-17 óta KÖTELEZŐ bekapcsolt számlázásnál (a csendes '27'
// alapértelmezés megszűnt) — a fixtúra ezért kimondja.
const ENABLED_CONFIG = getSzamlazzConfig({
  SZAMLAZZ_AGENT_KEY: DUMMY_AGENT_KEY,
  SZAMLAZZ_AFAKULCS: '27',
})

interface RecordedFetch {
  url: string
  method: string
  form: FormData | null
}

const calls: RecordedFetch[] = []

/** A globális fetch lecserélése rögzítő mockra — hálózati hívás nélkül. */
function stubFetch(respond: () => Response): void {
  vi.stubGlobal(
    'fetch',
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      calls.push({
        url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
        method: init?.method ?? 'GET',
        form: init?.body instanceof FormData ? init.body : null,
      })
      return respond()
    },
  )
}

function agentResponse(body: string, init: ResponseInit = {}): Response {
  return new Response(body, { status: 200, ...init })
}

/**
 * Olyan válasz, amelynek a FEJLÉCEI megérkeztek (status 200), de a TÖRZSE
 * olvasás közben szakad meg. Ez a valóságban két módon áll elő: az
 * AbortSignal.timeout a fejlécek UTÁN sül el, vagy a Railway privát hálózata
 * vágja el a TCP-kapcsolatot félúton. A `response.text()` ilyenkor NYERS
 * hibával utasít el — a kliensnek ezt kell retryable SzamlazzApiError-rá
 * osztályoznia, különben a hívó nem állítja sorba az újrapróbáló jobot.
 */
function bodyFailingResponse(error: Error): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(error)
    },
  })
  return new Response(stream, { status: 200 })
}

/** Törzs-olvasás közben elsülő időtúllépés (AbortSignal.timeout). */
function streamTimeoutError(): Error {
  const error = new Error('The operation was aborted due to timeout')
  error.name = 'TimeoutError'
  return error
}

/** Félbeszakadt stream (TCP-vágás) — a fetch nyers TypeError-t ad. */
function streamCutError(): Error {
  return new TypeError('terminated')
}

const SUCCESS_BODY =
  '<?xml version="1.0" encoding="UTF-8"?><xmlszamlavalasz>' +
  `<sikeres>true</sikeres><szamlaszam>${FOUND_INVOICE_NUMBER}</szamlaszam>` +
  '<pdf>RFVNTVktUERGLUJBU0U2NA==</pdf></xmlszamlavalasz>'

function errorBody(code: string, message: string): string {
  return (
    '<?xml version="1.0" encoding="UTF-8"?><xmlszamlavalasz><sikeres>false</sikeres>' +
    `<hibak><hiba><hibakod>${code}</hibakod><hibauzenet>${message}</hibauzenet></hiba></hibak>` +
    '</xmlszamlavalasz>'
  )
}

/** A ténylegesen kiküldött lekérdező XML a multipart mezőből. */
async function sentLookupXml(index = 0): Promise<string> {
  const entry = calls[index]?.form?.get(LOOKUP_FIELD) ?? null
  expect(entry, `a lekérdező XML a ${LOOKUP_FIELD} mezőben utazik`).toBeInstanceOf(Blob)
  return entry instanceof Blob ? await entry.text() : ''
}

/** A dobott hiba kinyerése típusbiztosan (nem SzamlazzApiError esetén bukik). */
async function apiErrorOf(promise: Promise<unknown>): Promise<SzamlazzApiError> {
  let captured: unknown
  try {
    await promise
  } catch (error) {
    captured = error
  }
  expect(captured, 'SzamlazzApiError-t vártunk').toBeInstanceOf(SzamlazzApiError)
  if (!(captured instanceof SzamlazzApiError)) {
    throw new Error('TESZT-HIBA: a hívás nem SzamlazzApiError hibával állt le')
  }
  return captured
}

afterEach(() => {
  calls.length = 0
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('buildInvoiceLookupXml — xmlszamlapdf lekérdező séma', () => {
  const xml = buildInvoiceLookupXml({ agentKey: DUMMY_AGENT_KEY, kulsoAzon: ORDER_NUMBER })

  it('a gyökér xmlszamlapdf, az agentpdf névtérrel és az élő XSD-vel', () => {
    expect(xml).toContain('<xmlszamlapdf xmlns="http://www.szamlazz.hu/xmlszamlapdf"')
    expect(xml).toContain('https://www.szamlazz.hu/szamla/docs/xsds/agentpdf/xmlszamlapdf.xsd')
  })

  it('élő-XSD-kompatibilis tag-sorrend: szamlaagentkulcs → valaszVerzio(2) → szamlaKulsoAzon', () => {
    // A sorrend kötött: az XSD sequence-e szerinti sorrendtől eltérve a
    // Számlázz.hu séma-hibával utasítaná el a lekérdezést.
    const order = ['<szamlaagentkulcs>', '<valaszVerzio>', '<szamlaKulsoAzon>']
    let previousIndex = -1
    for (const tag of order) {
      const index = xml.indexOf(tag)
      expect(index, tag).toBeGreaterThan(previousIndex)
      previousIndex = index
    }
    // valaszVerzio=2: a válasz ugyanaz az xmlszamlavalasz, mint kiállításnál.
    expect(xml).toContain('<valaszVerzio>2</valaszVerzio>')
    expect(xml).toContain(`<szamlaKulsoAzon>${ORDER_NUMBER}</szamlaKulsoAzon>`)
  })

  it('a bizonylatot KIZÁRÓLAG a külső azonosító jelöli ki (szamlaszam/rendelesSzam nélkül)', () => {
    // A rendelesSzam több bizonylatot is takarhat (számla + stornó + helyesbítő),
    // arra a rendszer a LEGUTOLSÓT adná vissza — a kulsoAzon a pontos kulcs.
    expect(xml).not.toContain('<rendelesSzam>')
    expect(xml).not.toContain('<szamlaszam>')
  })

  it('XML-escape a kulsoAzon-ban (a & és a < entitásként megy ki)', () => {
    const escaped = buildInvoiceLookupXml({
      agentKey: DUMMY_AGENT_KEY,
      kulsoAzon: 'KH-2026-000123&<HELYESBITO>',
    })
    expect(escaped).toContain(
      '<szamlaKulsoAzon>KH-2026-000123&amp;&lt;HELYESBITO&gt;</szamlaKulsoAzon>',
    )
    expect(escaped).not.toContain('&<HELYESBITO>')
  })
})

describe('queryInvoiceByKulsoAzon — bizonylat-lekérdezés (mockolt fetch)', () => {
  it('siker: a válasz számlaszáma jön vissza; a POST a config apiUrl-jére megy', async () => {
    stubFetch(() => agentResponse(SUCCESS_BODY))

    const result = await queryInvoiceByKulsoAzon(ORDER_NUMBER, ENABLED_CONFIG)

    expect(result).toEqual({ szamlaszam: FOUND_INVOICE_NUMBER })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.method).toBe('POST')
    // ZÁRÓ PERJELLEL: a perjel nélküli alak redirectje a POST-ot GET-té
    // silányítaná, és a multipart törzs (benne az XML) elveszne.
    expect(calls[0]?.url).toBe(ENABLED_CONFIG.apiUrl)
    expect(calls[0]?.url).toBe('https://www.szamlazz.hu/szamla/')
  })

  it('a-szamlazz-5: a v2-válasz bruttó és nettó végösszege is visszajön (az átvétel előtti egyeztetéshez)', async () => {
    // A hivatalos „Bizonylat lekérése PDF-ben" válaszminta (valaszVerzio=2).
    stubFetch(() =>
      agentResponse(
        '<?xml version="1.0" encoding="UTF-8"?><xmlszamlavalasz xmlns="http://www.szamlazz.hu/xmlszamlavalasz">' +
          `<sikeres>true</sikeres><szamlaszam>${FOUND_INVOICE_NUMBER}</szamlaszam>` +
          '<szamlanetto>30000</szamlanetto><szamlabrutto>38100</szamlabrutto><pdf>JVBERi0xLjQK</pdf>' +
          '</xmlszamlavalasz>',
      ),
    )

    const result = await queryInvoiceByKulsoAzon(ORDER_NUMBER, ENABLED_CONFIG)

    expect(result).toEqual({
      szamlaszam: FOUND_INVOICE_NUMBER,
      szamlanetto: 30000,
      szamlabrutto: 38100,
    })
  })

  it('a lekérdező XML az action-szamla_agent_pdf mezőben utazik, az agent-kulcs a bodyban', async () => {
    stubFetch(() => agentResponse(SUCCESS_BODY))

    await queryInvoiceByKulsoAzon(ORDER_NUMBER, ENABLED_CONFIG)

    const form = calls[0]?.form
    expect(form, 'multipart/form-data törzs').toBeInstanceOf(FormData)
    expect(form?.has(LOOKUP_FIELD)).toBe(true)
    // A kiállító mezőnevét (action-xmlagentxmlfile) itt NEM használjuk: azzal a
    // Számlázz.hu új bizonylatot próbálna kiállítani a lekérdezés helyett.
    expect(form?.has('action-xmlagentxmlfile')).toBe(false)

    const xml = await sentLookupXml()
    expect(xml).toContain(`<szamlaagentkulcs>${DUMMY_AGENT_KEY}</szamlaagentkulcs>`)
    expect(xml).toContain(`<szamlaKulsoAzon>${ORDER_NUMBER}</szamlaKulsoAzon>`)
    // Az agent-kulcs SOSEM kerülhet az URL-be (naplókban, proxykon átmenne).
    expect(calls[0]?.url).not.toContain(DUMMY_AGENT_KEY)
  })

  it('7-es hibakód: nincs ilyen bizonylat → null (NEM hiba)', async () => {
    stubFetch(() =>
      agentResponse(
        errorBody(SZAMLAZZ_NOT_FOUND_CODE, 'Nincs a megadott azonosítóhoz tartozó bizonylat.'),
      ),
    )

    // Ez a normál eset az ELSŐ kiállítási kísérlet retry-ja előtt: a bizonylat
    // tényleg nem jött létre, a hívó nyugodtan beküldheti a számlát.
    await expect(queryInvoiceByKulsoAzon(ORDER_NUMBER, ENABLED_CONFIG)).resolves.toBeNull()
  })

  it('más agent-hiba (3 — hibás bejelentkezés): SzamlazzApiError, végleges', async () => {
    stubFetch(() => agentResponse(errorBody('3', 'Sikertelen bejelentkezés.')))

    const error = await apiErrorOf(queryInvoiceByKulsoAzon(ORDER_NUMBER, ENABLED_CONFIG))
    expect(error.kind).toBe('agent')
    expect(error.retryable).toBe(false)
    expect(error.agentErrors[0]?.code).toBe('3')
  })

  it('szlahu_down fejléc: karbantartás → retryable hiba (a body sikere sem számít)', async () => {
    stubFetch(() => agentResponse(SUCCESS_BODY, { headers: { szlahu_down: '1' } }))

    const error = await apiErrorOf(queryInvoiceByKulsoAzon(ORDER_NUMBER, ENABLED_CONFIG))
    expect(error.retryable).toBe(true)
    expect(error.kind).toBe('http')
  })

  it('HTTP 500: retryable http-hiba a státuszkóddal (4xx viszont végleges)', async () => {
    stubFetch(() => agentResponse('<html>Szerverhiba</html>', { status: 500 }))
    const serverError = await apiErrorOf(queryInvoiceByKulsoAzon(ORDER_NUMBER, ENABLED_CONFIG))
    expect(serverError.kind).toBe('http')
    expect(serverError.httpStatus).toBe(500)
    expect(serverError.retryable).toBe(true)

    vi.unstubAllGlobals()
    calls.length = 0
    stubFetch(() => agentResponse('<html>Hibás kérés</html>', { status: 400 }))
    const clientError = await apiErrorOf(queryInvoiceByKulsoAzon(ORDER_NUMBER, ENABLED_CONFIG))
    expect(clientError.httpStatus).toBe(400)
    expect(clientError.retryable).toBe(false)
  })

  it('kikapcsolt integrációnál invalid_data hiba, hálózati hívás NÉLKÜL', async () => {
    stubFetch(() => {
      throw new Error('TESZT-HIBA: kikapcsolt integrációnál nem mehet ki kérés')
    })

    const error = await apiErrorOf(queryInvoiceByKulsoAzon(ORDER_NUMBER, getSzamlazzConfig({})))
    expect(error.kind).toBe('invalid_data')
    expect(error.retryable).toBe(false)
    expect(calls).toHaveLength(0)
  })
})

/**
 * F6 — a válasz-TÖRZS olvasása közben keletkező hiba osztályozása.
 *
 * A fejlécek megérkezése után a stream még elszakadhat (timeout a törzs
 * olvasása közben, TCP-vágás félúton). Osztályozás nélkül ez nyers
 * TypeError-ként lépne ki: elveszne a `retryable` jelzés, a refund-folyamat nem
 * állítaná sorba az újrapróbáló jobot, és a bizonylat NÉMÁN elveszne.
 */
describe('törzs-olvasási hiba osztályozása (F6)', () => {
  it('lekérdezés: időtúllépés a törzs olvasása közben → retryable timeout-hiba', async () => {
    stubFetch(() => bodyFailingResponse(streamTimeoutError()))

    const error = await apiErrorOf(queryInvoiceByKulsoAzon(ORDER_NUMBER, ENABLED_CONFIG))
    expect(error.kind).toBe('timeout')
    expect(error.retryable).toBe(true)
    // Magyar üzenet, a hívó ágának megnevezésével.
    expect(error.message).toContain('bizonylat-lekérdezés')
  })

  it('lekérdezés: félbeszakadt stream (nyers TypeError) → retryable network-hiba', async () => {
    stubFetch(() => bodyFailingResponse(streamCutError()))

    const error = await apiErrorOf(queryInvoiceByKulsoAzon(ORDER_NUMBER, ENABLED_CONFIG))
    expect(error.kind).toBe('network')
    expect(error.retryable).toBe(true)
    expect(error.message).toContain('terminated')
  })

  it('lekérdezés: a strukturált agent-hiba VÁLTOZATLAN marad (nem lesz belőle network)', async () => {
    // A 71-es (duplikátum) besorolásnak túl kell élnie a törzs-védelmet:
    // újracsomagolva a hívó idempotencia-feloldása állna le.
    stubFetch(() => agentResponse(errorBody('71', 'Már létező rendelésszám.')))

    const error = await apiErrorOf(queryInvoiceByKulsoAzon(ORDER_NUMBER, ENABLED_CONFIG))
    expect(error.kind).toBe('duplicate')
    expect(error.agentErrors[0]?.code).toBe('71')
  })

  it('számla-beküldés: időtúllépés a törzs olvasása közben → retryable timeout-hiba', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    stubFetch(() => bodyFailingResponse(streamTimeoutError()))

    const error = await apiErrorOf(postInvoiceXml('<xmlszamla/>', ENABLED_CONFIG))
    expect(error.kind).toBe('timeout')
    expect(error.retryable).toBe(true)
  })

  it('számla-beküldés: félbeszakadt stream → retryable network-hiba', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    stubFetch(() => bodyFailingResponse(streamCutError()))

    const error = await apiErrorOf(postInvoiceXml('<xmlszamla/>', ENABLED_CONFIG))
    expect(error.kind).toBe('network')
    expect(error.retryable).toBe(true)
  })

  it('számla-beküldés: a duplikátum-besorolás VÁLTOZATLAN marad', async () => {
    stubFetch(() => agentResponse(errorBody('152', 'Már létező rendelésszám.')))

    const error = await apiErrorOf(postInvoiceXml('<xmlszamla/>', ENABLED_CONFIG))
    expect(error.kind).toBe('duplicate')
    expect(error.retryable).toBe(false)
  })
})

/**
 * Nem-2xx válaszok (r-szamlazz-13): a hibakód a szlahu_* fejlécből és a
 * törzsből is kiolvasandó, és az átmeneti státusz (408/425/429/5xx)
 * újrapróbálható. Korábban minden nem-2xx válasz OLVASÁS NÉLKÜL, csak a
 * státusz alapján dobott, és a 408/429 végleges 'failed' számlát okozott.
 */
describe('nem-2xx válaszok: a hibakód nem vész el, az átmeneti státusz retryable', () => {
  it('429 (sebességkorlát) és 408, 425: retryable http-hiba — lekérdezésnél és beküldésnél is', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    for (const status of [408, 425, 429]) {
      calls.length = 0
      vi.unstubAllGlobals()
      stubFetch(() => agentResponse('<html>Too Many Requests</html>', { status }))
      const lookupError = await apiErrorOf(queryInvoiceByKulsoAzon(ORDER_NUMBER, ENABLED_CONFIG))
      expect(lookupError.kind, String(status)).toBe('http')
      expect(lookupError.httpStatus, String(status)).toBe(status)
      expect(lookupError.retryable, String(status)).toBe(true)

      const postError = await apiErrorOf(postInvoiceXml('<xmlszamla/>', ENABLED_CONFIG))
      expect(postError.retryable, String(status)).toBe(true)

      const stornoError = await apiErrorOf(postStornoXml('<xmlszamlast/>', ENABLED_CONFIG))
      expect(stornoError.retryable, String(status)).toBe(true)
    }
  })

  it('403 (tiltás) HTML-törzzsel: végleges http-hiba', async () => {
    stubFetch(() => agentResponse('<html>Forbidden</html>', { status: 403 }))
    const error = await apiErrorOf(queryInvoiceByKulsoAzon(ORDER_NUMBER, ENABLED_CONFIG))
    expect(error.kind).toBe('http')
    expect(error.retryable).toBe(false)
  })

  it('400 + szlahu_error_code fejléc: a hivatalos kód-osztályozás él, a kód NEM vész el', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    stubFetch(() =>
      agentResponse('', {
        status: 400,
        headers: { szlahu_error_code: '3', szlahu_error: 'Sikertelen+bejelentkez%C3%A9s' },
      }),
    )
    const error = await apiErrorOf(postInvoiceXml('<xmlszamla/>', ENABLED_CONFIG))
    expect(error.kind).toBe('agent')
    expect(error.httpStatus).toBe(400)
    expect(error.agentErrors).toEqual([{ code: '3', message: 'Sikertelen bejelentkezés' }])
    expect(error.retryable).toBe(false)
  })

  it('503 + végleges agent-kód a törzsben: agent-hiba a kóddal, de az 5xx miatt RETRYABLE', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    stubFetch(() => agentResponse(errorBody('57', 'XML beolvasási hiba'), { status: 503 }))
    const error = await apiErrorOf(postInvoiceXml('<xmlszamla/>', ENABLED_CONFIG))
    expect(error.kind).toBe('agent')
    expect(error.httpStatus).toBe(503)
    expect(error.agentErrors[0]?.code).toBe('57')
    expect(error.retryable).toBe(true)
  })

  it('404 + 7-es kód a törzsben: a lekérdezés „nincs találat"-ot ad (null), nem hibát', async () => {
    stubFetch(() =>
      agentResponse(errorBody(SZAMLAZZ_NOT_FOUND_CODE, 'Nincs ilyen bizonylat.'), { status: 404 }),
    )
    await expect(queryInvoiceByKulsoAzon(ORDER_NUMBER, ENABLED_CONFIG)).resolves.toBeNull()
  })

  it('nem-2xx válasz olvashatatlan törzzsel: a státusz dönt (500 → retryable)', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new TypeError('terminated'))
      },
    })
    stubFetch(() => new Response(stream, { status: 500 }))
    const error = await apiErrorOf(queryInvoiceByKulsoAzon(ORDER_NUMBER, ENABLED_CONFIG))
    expect(error.kind).toBe('http')
    expect(error.httpStatus).toBe(500)
    expect(error.retryable).toBe(true)
  })
})

/**
 * CDATA a lekérdezés válaszában (a-szamlazz-8): a hivatalos hibaminta a
 * hibaüzenetet CDATA-ba teszi; ha a kód is abban jön (és nincs fejléc), a
 * 7-es „nincs találat" nem bukhat el — különben MINDEN számla a legelső
 * beküldés előtti lekérdezésen akadna el.
 */
describe('queryInvoiceByKulsoAzon — CDATA és értelmezhetetlen 200-as törzs', () => {
  it('CDATA-ba csomagolt 7-es kód fejléc nélkül: null (nincs találat)', async () => {
    stubFetch(() =>
      agentResponse(
        '<?xml version="1.0" encoding="UTF-8"?><xmlszamlavalasz><sikeres>false</sikeres>' +
          '<hibakod><![CDATA[7]]></hibakod><hibauzenet><![CDATA[Nincs ilyen bizonylat.]]></hibauzenet>' +
          '</xmlszamlavalasz>',
      ),
    )
    await expect(queryInvoiceByKulsoAzon(ORDER_NUMBER, ENABLED_CONFIG)).resolves.toBeNull()
  })

  it('CDATA-s számlaszám a találatban: a jelölés nélküli szám jön vissza', async () => {
    stubFetch(() =>
      agentResponse(
        '<xmlszamlavalasz><sikeres>true</sikeres>' +
          `<szamlaszam><![CDATA[${FOUND_INVOICE_NUMBER}]]></szamlaszam></xmlszamlavalasz>`,
      ),
    )
    await expect(queryInvoiceByKulsoAzon(ORDER_NUMBER, ENABLED_CONFIG)).resolves.toEqual({
      szamlaszam: FOUND_INVOICE_NUMBER,
    })
  })

  it('200-as HTML-karbantartási oldal: bizonytalan, RETRYABLE (nem végleges)', async () => {
    stubFetch(() => agentResponse('<html><body>Karbantartás</body></html>'))
    const error = await apiErrorOf(queryInvoiceByKulsoAzon(ORDER_NUMBER, ENABLED_CONFIG))
    expect(error.kind).toBe('invalid_response')
    expect(error.retryable).toBe(true)
  })
})

/**
 * F12 — a végpont-normalizálás nem dobhatja el a query stringet: egy
 * '…/agent?env=test' proxy-végpontból elhagyott paraméterrel ÉLES bizonylat
 * keletkezne teszt-szándék mellett (miközben az elgépelt URL-re szándékosan
 * hangos hiba van).
 */
describe('getSzamlazzConfig — URL-normalizálás (F12)', () => {
  it('a query string megmarad a záró perjel mellett', () => {
    const config = getSzamlazzConfig({ SZAMLAZZ_API_URL: 'https://proxy.example/agent?env=test' })
    expect(config.apiUrl).toBe('https://proxy.example/agent/?env=test')
  })

  it('több paraméter és meglévő záró perjel esetén is változatlan a query', () => {
    const config = getSzamlazzConfig({
      SZAMLAZZ_API_URL: 'https://proxy.example/agent/?env=test&mod=1',
    })
    expect(config.apiUrl).toBe('https://proxy.example/agent/?env=test&mod=1')
  })

  it('query nélkül nem kerül üres kérdőjel az URL végére', () => {
    expect(getSzamlazzConfig({}).apiUrl).toBe('https://www.szamlazz.hu/szamla/')
  })

  it('beágyazott felhasználónév/jelszó: hangos konfigurációs hiba, a jelszó kiírása nélkül', () => {
    // DUMMY értékek, egyértelműen jelölve — NEM valódi hitelesítő adatok.
    const withCredentials = 'https://DUMMY-FELHASZNALO:DUMMY-JELSZO-NEM-VALODI@proxy.example/agent'

    expect(() => getSzamlazzConfig({ SZAMLAZZ_API_URL: withCredentials })).toThrowError(
      /felhasználónevet vagy jelszót/,
    )
    // A hibaüzenet naplóba is kerülhet: a beágyazott jelszó nem szerepelhet benne.
    let message = ''
    try {
      getSzamlazzConfig({ SZAMLAZZ_API_URL: withCredentials })
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    expect(message).not.toContain('DUMMY-JELSZO-NEM-VALODI')
  })

  it('csak felhasználónév (jelszó nélkül) esetén is dob', () => {
    expect(() =>
      getSzamlazzConfig({ SZAMLAZZ_API_URL: 'https://DUMMY-FELHASZNALO@proxy.example/agent' }),
    ).toThrowError(/SZAMLAZZ_API_URL/)
  })
})

/**
 * F13 — a `szlahu_error` fejléc értéke URL-kódolt (hivatalos A6). Dekódolás
 * nélkül a rendelés *LastError mezőjében az ügyintéző
 * 'Sikertelen+bejelentkez%C3%A9s'-t látna.
 */
describe('parseAgentResponse — szlahu_error fejléc URL-dekódolása (F13)', () => {
  it('a kódolt fejléc olvasható magyar mondatként kerül a hibába', () => {
    let captured: unknown
    try {
      parseAgentResponse(
        '',
        new Headers({
          szlahu_error: 'Sikertelen+bejelentkez%C3%A9s',
          szlahu_error_code: '3',
        }),
      )
    } catch (error) {
      captured = error
    }
    expect(captured).toBeInstanceOf(SzamlazzApiError)
    if (!(captured instanceof SzamlazzApiError)) {
      throw new Error('TESZT-HIBA: a fejléc-hiba nem SzamlazzApiError')
    }
    expect(captured.agentErrors[0]).toEqual({ code: '3', message: 'Sikertelen bejelentkezés' })
    expect(captured.message).toContain('Sikertelen bejelentkezés')
    expect(captured.message).not.toContain('%C3%A9')
  })

  it('hibás kódolásnál a nyers érték marad (a hibaüzenet nem veszhet el)', () => {
    let captured: unknown
    try {
      parseAgentResponse('', new Headers({ szlahu_error: 'Hib%GG+kodolas' }))
    } catch (error) {
      captured = error
    }
    expect(captured).toBeInstanceOf(SzamlazzApiError)
    if (!(captured instanceof SzamlazzApiError)) {
      throw new Error('TESZT-HIBA: a fejléc-hiba nem SzamlazzApiError')
    }
    expect(captured.agentErrors[0]?.message).toBe('Hib%GG+kodolas')
  })
})
