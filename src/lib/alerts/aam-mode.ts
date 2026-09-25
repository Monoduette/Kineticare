/**
 * Kell-e az alanyi adómentes keret becslése (napi összesítő és a „Figyelmet
 * igényel" blokk közös feltétele).
 *
 * Csak akkor, ha a `SZAMLAZZ_AFAKULCS` normalizált értéke pontosan `AAM`. A
 * normalizálás a meglévő szabály: szélső szóközök levágása
 * (`assertRequiredEnv`, Számlázz-kliens `readEnv`), utána a támogatott kulcsok
 * listája (`isSzamlazzVatMode`, kis- és nagybetű-érzékeny). Hiányzó kulcsnál
 * (kikapcsolt számlázás), `27`-nél és minden más értéknél nincs becslés: a
 * keret csak alanyi adómentes eladónál értelmes, és kikapcsolt számlázás
 * mellett egy „0 Ft a keretből" sor hamis megnyugtatás volna.
 */

import { isSzamlazzVatMode } from '../../env'

export function aamEstimateApplies(vatMode: string | undefined): boolean {
  const normalized = vatMode?.trim()
  return normalized !== undefined && isSzamlazzVatMode(normalized) && normalized === 'AAM'
}
