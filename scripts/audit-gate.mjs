// npm audit kapu: high és critical szinttől bukás, név szerinti, lejáró kivételekkel.
//
// MIÉRT NEM ELÉG A `npm audit --audit-level=high`: annak nincs kivétel-kezelése.
// Ha egy figyelmeztetéshez még NINCS javított csomagváltozat (2026-10-05: a
// `braces` GHSA-vfj7-8cjw-p6xm, minden kiadás érintett), a kapu minden PR-en és
// a main-en is piros, és nincs mivel zöldre hozni. A kivétel ezért:
//   - csak egy konkrét advisoryra és csomagra szól (nem szintre, nem csomagra),
//   - kötelező indoklás és lejárati dátum tartozik hozzá (lejárat után újra bukik),
//   - minden más high/critical tétel ugyanúgy bukást okoz, mint eddig.
// Hibás vagy hiányzó audit-kimenetnél (hálózati hiba, registry-hiba) a kapu
// bukik: nem enged át olyat, amit nem látott.
//
// Használat (ci.yml):
//   npm audit --json > audit.json || true
//   node scripts/audit-gate.mjs audit.json audit-kivetelek.json

import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const BLOKKOLO_SZINTEK = new Set(['high', 'critical'])

function advisoryAzonosito(advisory) {
  const url = typeof advisory.url === 'string' ? advisory.url : ''
  const talalat = url.match(/GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}/i)
  return talalat ? talalat[0] : String(advisory.source ?? url)
}

/**
 * A vulnerability-bejegyzés mögötti advisoryk, a `via` láncot (csomagnevek)
 * végigkövetve. Egy tranzitív bejegyzés (pl. `@payloadcms/next`) a súlyosságát
 * a lánc végén álló advisorytól örökli.
 */
function gyokerAdvisoryk(nev, vulnerabilities, latott = new Set()) {
  if (latott.has(nev)) return []
  latott.add(nev)
  const bejegyzes = vulnerabilities[nev]
  if (!bejegyzes || !Array.isArray(bejegyzes.via)) return []
  return bejegyzes.via.flatMap((via) =>
    typeof via === 'string'
      ? gyokerAdvisoryk(via, vulnerabilities, latott)
      : [{ ...via, csomag: via.name ?? nev }],
  )
}

/**
 * @param {unknown} report az `npm audit --json` kimenete
 * @param {Array<{ id: string, csomag: string, lejar: string, indok: string }>} kivetelek
 * @param {string} ma ÉÉÉÉ-HH-NN
 */
export function auditKapu(report, kivetelek, ma) {
  if (
    !report ||
    typeof report !== 'object' ||
    'error' in report ||
    !('vulnerabilities' in report) ||
    typeof report.vulnerabilities !== 'object' ||
    report.vulnerabilities === null
  ) {
    return {
      rendben: false,
      blokkolo: [],
      engedett: [],
      lejart: [],
      elavult: [],
      hiba: 'Az npm audit kimenete hibás vagy hiányos, a kapu nem enged át.',
    }
  }

  const vulnerabilities = report.vulnerabilities
  const blokkolo = new Map()
  const engedett = new Map()
  const lejart = new Map()
  const hasznalt = new Set()

  for (const [nev, bejegyzes] of Object.entries(vulnerabilities)) {
    if (!BLOKKOLO_SZINTEK.has(bejegyzes?.severity)) continue
    const gyokerek = gyokerAdvisoryk(nev, vulnerabilities).filter((a) =>
      BLOKKOLO_SZINTEK.has(a.severity),
    )
    if (gyokerek.length === 0) {
      blokkolo.set(`${nev}:ismeretlen`, { csomag: nev, id: 'ismeretlen advisory' })
      continue
    }
    for (const advisory of gyokerek) {
      const id = advisoryAzonosito(advisory)
      const kulcs = `${advisory.csomag}:${id}`
      const kivetel = kivetelek.find((k) => k.id === id && k.csomag === advisory.csomag)
      if (!kivetel) {
        blokkolo.set(kulcs, { csomag: advisory.csomag, id, cim: advisory.title })
      } else if (kivetel.lejar < ma) {
        lejart.set(kulcs, { csomag: advisory.csomag, id, lejar: kivetel.lejar })
        hasznalt.add(kivetel)
      } else {
        engedett.set(kulcs, { csomag: advisory.csomag, id, lejar: kivetel.lejar })
        hasznalt.add(kivetel)
      }
    }
  }

  return {
    rendben: blokkolo.size === 0 && lejart.size === 0,
    blokkolo: [...blokkolo.values()],
    engedett: [...engedett.values()],
    lejart: [...lejart.values()],
    elavult: kivetelek.filter((k) => !hasznalt.has(k)),
  }
}

function kivetelekBetoltese(utvonal) {
  const adat = JSON.parse(readFileSync(utvonal, 'utf8'))
  if (!Array.isArray(adat)) throw new Error(`${utvonal}: tömböt vártam.`)
  for (const k of adat) {
    const hianyzo = ['id', 'csomag', 'lejar', 'indok'].filter(
      (mezo) => typeof k?.[mezo] !== 'string' || k[mezo].trim() === '',
    )
    if (hianyzo.length > 0) {
      throw new Error(`${utvonal}: hiányzó mező(k) egy kivételben: ${hianyzo.join(', ')}.`)
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(k.lejar)) {
      throw new Error(`${utvonal}: a lejárat formája ÉÉÉÉ-HH-NN legyen (${k.id}).`)
    }
  }
  return adat
}

function main([reportUtvonal, kivetelUtvonal]) {
  if (!reportUtvonal || !kivetelUtvonal) {
    console.error('Használat: node scripts/audit-gate.mjs <audit.json> <kivetelek.json>')
    return 2
  }
  let report
  try {
    report = JSON.parse(readFileSync(reportUtvonal, 'utf8'))
  } catch (hiba) {
    console.error(`Az audit-kimenet nem olvasható: ${hiba instanceof Error ? hiba.message : hiba}`)
    return 1
  }
  const kivetelek = kivetelekBetoltese(kivetelUtvonal)
  const eredmeny = auditKapu(report, kivetelek, new Date().toISOString().slice(0, 10))

  if (eredmeny.hiba) console.error(eredmeny.hiba)
  for (const t of eredmeny.engedett) {
    console.log(`KIVÉTEL (lejár: ${t.lejar}): ${t.csomag} ${t.id}`)
  }
  for (const k of eredmeny.elavult) {
    console.log(`ELAVULT KIVÉTEL, törölhető: ${k.csomag} ${k.id}`)
  }
  for (const t of eredmeny.lejart) {
    console.error(`LEJÁRT KIVÉTEL (${t.lejar}): ${t.csomag} ${t.id}`)
  }
  for (const t of eredmeny.blokkolo) {
    console.error(`HIGH/CRITICAL: ${t.csomag} ${t.id}${t.cim ? ` (${t.cim})` : ''}`)
  }
  console.log(eredmeny.rendben ? 'Audit-kapu: rendben.' : 'Audit-kapu: BUKÁS.')
  return eredmeny.rendben ? 0 : 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2))
}
