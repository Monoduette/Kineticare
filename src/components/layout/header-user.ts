import { draftMode, headers } from 'next/headers'
import { getPayload } from 'payload'

import { hasStaffOrOwnerRole } from '../../access/roles'
import { logger } from '../../lib/logger'
import type { User } from '../../payload-types'

import config from '../../payload.config'

/**
 * A fejléc hitelesítési állapota — SZERVER-oldalon megállapítva.
 * A minta AZONOS a védett oldalakéval (`src/app/(frontend)/kurzusaim/page.tsx`,
 * `src/app/(frontend)/fiok/page.tsx`, `src/app/(frontend)/belepes/page.tsx`):
 * `payload.auth({ headers: await headers() })`. Szándékosan nem vezetünk be új
 * utat — egy második auth-mechanizmus két igazságot jelentene.
 *
 * A `szerkeszto` bit UGYANABBÓL az egy `payload.auth` hívásból jön (új
 * hitelesítési hívás, adatbázis-lekérdezés vagy kliensoldali kérés nincs): a
 * szerepkört a központi `hasStaffOrOwnerRole` dönti el (src/access/roles.ts).
 * Az `elonezet` a draft-süti (Next `draftMode()`, sütiolvasás, lekérdezés
 * nélkül): piszkozat-előnézetben a fejléc-belépő nem kell, ott az előnézet-sáv
 * visz vissza a szerkesztőbe.
 */
export interface HeaderAuthState {
  /** Van-e élő session. */
  signedIn: boolean
  /** Staff vagy owner szerepkörű-e a belépett felhasználó (a fejléc-belépő feltétele). */
  szerkeszto: boolean
  /** Piszkozat-előnézetben vagyunk-e (a `/next/preview` bekapcsolta a draft mode-ot). */
  elonezet: boolean
}

async function elonezetben(): Promise<boolean> {
  try {
    return (await draftMode()).isEnabled
  } catch {
    return false
  }
}

export async function getHeaderAuthState(): Promise<HeaderAuthState> {
  try {
    const payload = await getPayload({ config })
    const { user } = await payload.auth({ headers: await headers() })
    const felhasznalo = (user as User | null) ?? null
    const szerkeszto = hasStaffOrOwnerRole(felhasznalo)
    return {
      signedIn: felhasznalo !== null,
      szerkeszto,
      // A draft-sütit csak a jogosult ágban olvassuk: a látogatónak nem kell.
      elonezet: szerkeszto ? await elonezetben() : false,
    }
  } catch (error) {
    logger.warn('fejléc: a hitelesítési állapot lekérdezése sikertelen', {
      error: error instanceof Error ? error.message : String(error),
    })
    return { signedIn: false, szerkeszto: false, elonezet: false }
  }
}
