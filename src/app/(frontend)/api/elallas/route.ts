import { getPayload } from 'payload'

import { createWithdrawalHandler } from '../../../../lib/withdrawal/route-handler'
import config from '../../../../payload.config'

/**
 * POST /api/elallas: az elállási funkció (45/2014. Korm. rendelet 22. §
 * (1a)–(1c)) beküldése.
 *
 * A handler a src/lib/withdrawal/route-handler.ts-ben él (függőség-
 * injekcióval, egységtesztelhetően); itt csak a valódi config bekötése
 * történik, az ingyenes kurzus igénylésének mintájára.
 */
export const POST = createWithdrawalHandler({
  getPayload: () => getPayload({ config }),
})
