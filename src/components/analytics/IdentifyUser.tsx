'use client'

import { useEffect } from 'react'

import { identifyUser, whenPostHogConsentReady } from '@/lib/analytics/posthog'

/**
 * IdentifyUser — a bejelentkezett vevő azonosítása a fiók-oldalakon.
 *
 * MIÉRT KELL. Az azonosítás eddig csak a belépés pillanatában futott
 * (LoginForm, RegisterForm). Ha a vevő akkor még nem adott hozzájárulást
 * (a banner a belépés után jött, vagy elutasította és később elfogadta),
 * vagy egy másik eszközön a tartós munkamenetével jön vissza, a PostHog
 * soha nem kapta meg az azonosítót. Mérve 2026-11-26: a /kurzusaim oldalak
 * 35 munkamenetéből 24 névtelen maradt, így a tanulási tölcsér eseményei
 * (course_started, lesson_completed) vevőhöz nem köthetők, és a „hányan
 * fejezték be” kérdésre a PostHog nem ad választ.
 *
 * MŰKÖDÉS. A hozzájárulásra vár (whenPostHogConsentReady). A süti nélküli
 * mérés (elutasítás után) nem indítja el: ott azonosítani nem szabad, és egy
 * ezen a lapon később adott elfogadás után fut le.
 * A posthog-js `identify` ugyanarra az azonosítóra nem küld újabb eseményt
 * (1.430.3, posthog-core.js `identify`: `$identify` csak névtelenből
 * azonosítottba váltáskor megy ki), ezért minden oldalbetöltéskor nyugodtan
 * hívható. Hozzájárulás nélkül semmi nem megy ki (posthog.ts `runIdentityOp`).
 *
 * ADAT. Csak a Payload users.id megy át, ugyanaz, mint a belépéskori
 * azonosításnál; e-mail, név soha. Az azonosító a szerveren hitelesített
 * munkamenetből jön, a látogató nem írhatja át más vevőére.
 */
export interface IdentifyUserProps {
  userId: number
}

export function IdentifyUser({ userId }: IdentifyUserProps): null {
  useEffect(() => whenPostHogConsentReady(() => void identifyUser(userId)), [userId])
  return null
}
