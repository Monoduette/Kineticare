import { getPayload } from 'payload'

import { createUserProgressHandler } from '../../../../../lib/admin/user-progress-handler'
import config from '../../../../../payload.config'

/**
 * GET /api/admin/user-progress?users=<id,id,…> — a Felhasználók-lista
 * „Megvásárolt kurzusok" oszlopának haladás-adata: kurzusonként hány
 * százalékon áll az adott vevő, és milyen állapotban van.
 * A handler az src/lib/admin/user-progress-handler.ts-ben él
 * (függőség-injekcióval, egységtesztelhetően); itt csak a valódi config
 * bekötése történik — a kurzus-haladás végpontjának
 */
export const GET = createUserProgressHandler({
  getPayload: () => getPayload({ config }),
})
