import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { ALERT_CODES } from '../../lib/alerts/classify'

/**
 * Minden riasztás-levél azt írja, hogy a tulajdonosi kézikönyv riasztási
 * fejezete kódonként leírja a teendőt (alerts/mail.ts). Ez az őr ezt az
 * ígéretet teszi végrehajthatóvá: a katalógus minden kódja szerepel a 11-es
 * runbookban (W1B-8). Új kód a katalógusban runbook-sor nélkül itt bukik.
 */

const RUNBOOK = 'docs/uzemeltetes/11-riasztas-es-ugyelet.md'

describe('riasztáskód-katalógus és a 11-es runbook', () => {
  it('a katalógus minden kódja kódként (backtickben) áll a runbookban', () => {
    const runbook = readFileSync(join(process.cwd(), RUNBOOK), 'utf8')
    const missing = Object.values(ALERT_CODES).filter((code) => !runbook.includes(`\`${code}\``))
    expect(missing).toEqual([])
  })
})
