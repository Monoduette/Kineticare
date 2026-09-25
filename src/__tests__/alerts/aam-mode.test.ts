import { describe, expect, it } from 'vitest'

import { aamEstimateApplies } from '../../lib/alerts/aam-mode'

/**
 * Codex P2 (PR #305, digest.ts:244): az AAM-keret becslése minden
 * `SZAMLAZZ_AFAKULCS`-értékre lefutott, ami nem `27` volt, a hiányzóra
 * (kikapcsolt számlázás) is. A napi összesítő és a „Figyelmet igényel" blokk
 * közös feltétele: csak a normalizált `AAM` (szóköz-levágás, utána a
 * támogatott kulcsok kis- és nagybetű-érzékeny listája, mint az
 * `assertRequiredEnv`-ben). A két hívó bekötését a digest-heartbeat és a
 * figyelmet-igenyel teszt a saját határán őrzi.
 */
describe('aamEstimateApplies', () => {
  it.each([
    ['hiányzó (kikapcsolt számlázás)', undefined, false],
    ['üres', '', false],
    ['csak szóköz', '   ', false],
    ['27', '27', false],
    ['27 szóközökkel', ' 27 ', false],
    ['AAM', 'AAM', true],
    ['AAM szóközökkel és sortöréssel', ' AAM\n', true],
    ['kisbetűs aam (induláskor is érvénytelen)', 'aam', false],
    ['vegyes Aam', ' Aam ', false],
  ] as const)('%s: %j → %s', (_nev, ertek, vart) => {
    expect(aamEstimateApplies(ertek)).toBe(vart)
  })
})
