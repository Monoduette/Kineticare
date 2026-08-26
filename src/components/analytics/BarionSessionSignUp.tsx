'use client'

import { useEffect } from 'react'

import {
  BARION_SIGNUP,
  browserSnapshotStorage,
  claimBarionSessionSignUp,
  trackSignUp,
} from '@/lib/analytics/barion-events'

/**
 * BarionSessionSignUp — az IMPLICIT, munkamenet-nyitó `signUp`.
 * komponens NEM küld második eseményt ugyanarra a belépésre.
 */
export interface BarionSessionSignUpProps {
  /** A fejléc szerver-oldalon megállapított hitelesítési bitje. */
  signedIn: boolean
}

export function BarionSessionSignUp({ signedIn }: BarionSessionSignUpProps): null {
  useEffect(() => {
    if (!signedIn) {
      return
    }
    if (!claimBarionSessionSignUp(browserSnapshotStorage())) {
      return
    }
    trackSignUp(BARION_SIGNUP.persistentLogin)
  }, [signedIn])
  return null
}
