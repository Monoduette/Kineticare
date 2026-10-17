'use client'

import { useSyncExternalStore, type ReactNode } from 'react'

import { readRememberedResetToken, ResetPasswordForm } from './ResetPasswordForm'

/** A tároló nem jelez változást: a jegyet csak a lap első renderje olvassa. */
function subscribe(): () => void {
  return () => {}
}

/** A szerveren (és a hidratálás első renderjén) még nem tudjuk, van-e jegy. */
function serverSnapshot(): undefined {
  return undefined
}

export interface ResetPasswordRestoreProps {
  returnUrl: string
  /** A hiányzó jegy hibaüzenete, ha a lapfülben sincs megjegyzett jegy. */
  children: ReactNode
}

/**
 * A visszaállító lap token nélküli ága. Hozzájárulás esetén az analitika a
 * jegyet az SDK indulása előtt kiveszi a címsorból
 * (`scrubSensitiveQueryFromAddressBar`, src/lib/analytics/posthog.ts), ezért
 * a lap újratöltése, vagy a mobilböngésző által a háttérben eldobott fül
 * visszaállítása jegy nélkül kéri a lapot. Az űrlap a jegyet a lapfül
 * munkamenet-tárolójában megjegyzi; ha ott van, az űrlap jelenik meg, és a
 * felhasználónak nem kell újra megnyitnia az e-mailt.
 *
 * Amíg a tárolót nem olvastuk (szerver, hidratálás), a hibaüzenet helyet
 * foglal, de nem látszik (auth.css, `scripting: enabled`), így nem villan fel.
 */
export function ResetPasswordRestore({ returnUrl, children }: ResetPasswordRestoreProps) {
  const token = useSyncExternalStore(subscribe, readRememberedResetToken, serverSnapshot)
  if (token) {
    return <ResetPasswordForm returnUrl={returnUrl} token={token} />
  }
  return (
    <div className="kc-reset-restore" data-checked={token === undefined ? undefined : ''}>
      {children}
    </div>
  )
}
