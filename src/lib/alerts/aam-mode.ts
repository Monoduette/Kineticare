/**
 * Kell-e az alanyi adómentes keret becslése (napi összesítő és a „Figyelmet
 * igényel" blokk közös feltétele).
 *
 * Csak akkor, ha a `SZAMLAZZ_AFAKULCS` normalizált értéke pontosan `AAM`. A
 * normalizálás a meglévő szabály: szélső szóközök levágása
 * (`assertRequiredEnv`, Számlázz-kliens `readEnv`), utána kis- és
 * nagybetű-érzékeny összevetés, mint az `isSzamlazzVatMode`-ban (a `satisfies`
 * a támogatott kulcsok típusához köti a literált). Hiányzó kulcsnál
 * (kikapcsolt számlázás), `27`-nél és minden más értéknél nincs becslés: a
 * keret csak alanyi adómentes eladónál értelmes, és kikapcsolt számlázás
 * mellett egy „0 Ft a keretből" sor hamis megnyugtatás volna.
 */

import type { SzamlazzVatMode } from '../szamlazz/types'

export function aamEstimateApplies(vatMode: string | undefined): boolean {
  return vatMode?.trim() === ('AAM' satisfies SzamlazzVatMode)
}
