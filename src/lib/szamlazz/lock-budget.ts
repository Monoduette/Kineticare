import { SzamlazzApiError, type SzamlazzClientConfig } from './types'

/**
 * Az advisory-zár alatti Számlázz.hu-hívások KÖZÖS időkerete.
 *
 * A zár-tranzakció (advisory-lock.ts) a védett szakasz teljes ideje alatt
 * tétlen, és a Postgres `idle_in_transaction_session_timeout` (60 s,
 * payload.config.ts) leöli. Ha ez egy beküldés közben történik, a zár
 * elengedődik, és egy második futó a beküldés előtti lekérdezésen át
 * (a bizonylat még nincs meg) dupla számlát vagy helyesbítőt küldhet be.
 * A hívásonkénti 15 s-os plafon (SZAMLAZZ_MAX_TIMEOUT_MS) ez ellen önmagában
 * nem elég: a helyesbítő a beküldés előtt akár három hívást is végez (új és
 * régi kulcsú lekérdezés, az eredeti számla áfakulcsa), a számla kettőt.
 *
 * Szabályok:
 * - lekérdezés: a timeout a hívásonkénti plafon és a hátralévő keret
 *   kisebbike; ha a keret elfogyott, újrapróbálható hiba (beküldés nincs);
 * - beküldés: CSAK akkor indul, ha a teljes hívásonkénti timeout belefér a
 *   keretbe (a rövidített POST-timeout bizonytalan kimenetet és elégetett
 *   kísérletet adna). Az ellenőrzés KÉTSZER fut:
 *   - korán (reservePost), a beküldés előtti írások (helyesbítőnél az
 *     igénylés-nyugta, mindkettőnél a pending-/kísérlet-írás) ELŐTT, az
 *     írásokra szánt tartalékkal: különben újrapróbálható hiba igénylés és
 *     kísérlet-növelés nélkül;
 *   - közvetlenül a beküldés pillanatában (forPost): az írások is
 *     megakadhatnak (sorzár, pool-várakozás, halott socket; CLAUDE.md 6–7.),
 *     és a korai ellenőrzés eredménye ilyenkor elavult. Ha itt már nem fér
 *     bele, a beküldés NEM indul el (újrapróbálható hiba, kérés nem ment ki).
 *
 * A 45 s-os keret a 60 s-os tétlenségi korlát alatt 15 s tartalékot hagy a
 * beküldés utáni állapotírásra. A beküldés utáni hívásoknak (71/152-feloldás)
 * a zár már nem véd beküldést: ha nekik nem marad keret, a hiba újrapróbálható,
 * és a következő futás a beküldés előtti lekérdezéssel dönt.
 */
export const LOCKED_SECTION_HTTP_BUDGET_MS = 45_000

/** Ennél rövidebb hátralévő keretre lekérdezés sem indul (értelmetlenül rövid timeout). */
export const MIN_QUERY_BUDGET_MS = 1_000

/**
 * A korai beküldés-ellenőrzés tartaléka a beküldés előtti adatbázis-írásokra
 * (néhány ms a szokásos eset; a tartalék a ritka akadást fogja, hogy a késői
 * ellenőrzés csak kivételesen bukjon, már elvégzett igénylés után).
 */
export const PRE_POST_WRITES_RESERVE_MS = 5_000

export interface LockBudget {
  /** Konfiguráció egy lekérdezéshez (a timeout a hátralévő kerethez igazítva). */
  forQuery(): SzamlazzClientConfig
  /**
   * Korai ellenőrzés a beküldés előtti írások ELŐTT: a teljes beküldési
   * timeout és az írások tartaléka (PRE_POST_WRITES_RESERVE_MS) belefér-e;
   * különben újrapróbálható hiba.
   */
  reservePost(): void
  /**
   * Konfiguráció a beküldéshez, KÖZVETLENÜL a beküldés hívásában: csak teljes
   * timeouttal; különben újrapróbálható hiba, és a beküldés nem indul el.
   */
  forPost(): SzamlazzClientConfig
}

function budgetExhausted(remainingMs: number, what: string): SzamlazzApiError {
  return new SzamlazzApiError({
    message:
      `A zár alatti Számlázz.hu-időkeret elfogyott (${Math.max(0, remainingMs)} ms maradt), a(z) ${what} nem indult el; ` +
      'ez a kérés nem ment ki a Számlázz.hu-ba.',
    kind: 'timeout',
    retryable: true,
  })
}

/**
 * A keret a létrehozás pillanatától számít: a hívó közvetlenül a zár
 * megszerzése után hozza létre.
 */
export function createLockBudget(config: SzamlazzClientConfig): LockBudget {
  const deadline = Date.now() + LOCKED_SECTION_HTTP_BUDGET_MS
  const requirePost = (reserveMs: number): void => {
    const remaining = deadline - Date.now()
    if (remaining < config.timeoutMs + reserveMs) {
      throw budgetExhausted(remaining, 'beküldés')
    }
  }
  return {
    forQuery() {
      const remaining = deadline - Date.now()
      if (remaining < MIN_QUERY_BUDGET_MS) {
        throw budgetExhausted(remaining, 'lekérdezés')
      }
      return remaining < config.timeoutMs ? { ...config, timeoutMs: remaining } : config
    },
    reservePost() {
      requirePost(PRE_POST_WRITES_RESERVE_MS)
    },
    forPost() {
      requirePost(0)
      return config
    },
  }
}
