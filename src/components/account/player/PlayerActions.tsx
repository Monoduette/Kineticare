import { ArrowIcon } from './icons'
import type { PrimaryAction, SecondaryAction } from './navigation'

/**
 * A LEJÁTSZÓ ALSÓ AKCIÓSÁVJA — a „mi a következő lépésem?" kérdés egyetlen,
 * mindig elérhető válasza.
 * A régi felület minden epizódnál külön „Megjelölöm megnézettnek" gombot
 * kínált, a továbblépés pedig a listából ment — két külön mozdulat ugyanarra a
 * szándékra. Itt EGY elsődleges gomb van, ami az állapot szerint jelöl ÉS lép
 * (`primaryAction`, navigation.ts). A felirata tartalmazza a CÉLT
 */

export interface PlayerActionsProps {
  previous: SecondaryAction | null
  primary: PrimaryAction | null
  /** Épp fut-e a szerverhívás (jelölés) — a dupla kattintás ellen. */
  busy: boolean
  onPrevious: (lessonRef: string) => void
  onPrimary: () => void
}

export function PlayerActions({
  busy,
  onPrevious,
  onPrimary,
  previous,
  primary,
}: PlayerActionsProps) {
  if (previous === null && primary === null) {
    return null
  }

  return (
    <div className="kc-player-actions">
      {previous === null ? (
        <span className="kc-player-actions__spacer" />
      ) : (
        <button
          aria-label={previous.ariaLabel}
          className="kc-player-actions__previous"
          onClick={() => onPrevious(previous.targetRef)}
          type="button"
        >
          <ArrowIcon direction="vissza" />
          <span className="kc-player-actions__label">{previous.label}</span>
        </button>
      )}

      {primary === null ? null : (
        <button
          aria-label={primary.ariaLabel}
          /**
           * `aria-disabled`, NEM `disabled`. A code review mérte: a gomb a
           * mentés alatt (busy) és a „minden kész" állapotban is pont akkor
           * válik `disabled`-dé, amikor rajta a billentyűzet-fókusz — a
           * böngésző ilyenkor a fókuszt a body-ra ejti, a képernyőolvasós
           * vevő pedig elveszíti, hol járt. Az `aria-disabled` megtartja a
           * fókuszt és bejelenti a letiltottságot; a tényleges védelem a
           * kattintás-kapu (a kezelő ilyenkor nem csinál semmit).
           */
          aria-disabled={primary.disabled || busy}
          className={[
            'kc-player-actions__primary',
            primary.kind === 'course-complete' ? 'kc-player-actions__primary--done' : null,
            primary.disabled || busy ? 'kc-player-actions__primary--inactive' : null,
          ]
            .filter(Boolean)
            .join(' ')}
          onClick={() => {
            if (!primary.disabled && !busy) {
              onPrimary()
            }
          }}
          type="button"
        >
          <span className="kc-player-actions__primary-text">
            {primary.moduleHint === null ? null : (
              <span aria-hidden="true" className="kc-player-actions__hint">
                {primary.moduleHint}
              </span>
            )}
            <span className="kc-player-actions__label">
              {busy ? 'Mentés…' : primary.label}
            </span>
          </span>
          {primary.kind === 'course-complete' ? null : <ArrowIcon direction="előre" />}
        </button>
      )}
    </div>
  )
}
