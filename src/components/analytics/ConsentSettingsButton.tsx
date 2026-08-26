'use client'

import { dispatchConsentOpenEvent } from '@/lib/analytics/consent'
import { ctaLabel } from '@/lib/cta-vocabulary'

/**
 * ConsentSettingsButton — a süti-hozzájárulás visszavonási/módosítási felülete
 * (GDPR): a footer „Süti-beállítások" gombja, amely a ConsentBanner-t nyitja
 * újra ('kc:analytics-consent-open' esemény). A consent-állapotgép változatlan —
 * a banner meglévő döntései ugyanúgy írják a tárolót.
 * Szándékosan NEM külön oldal: a legkisebb mértékű, mindig elérhető felület.
 * NN/g, Cookie Permissions 101: a látogatónak később is meg kell tudnia
 */
export function ConsentSettingsButton() {
  return (
    <button type="button" onClick={() => dispatchConsentOpenEvent()}>
      {ctaLabel('cookie-settings-open')}
    </button>
  )
}
