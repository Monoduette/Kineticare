/**
 * Haladás-vizualizációk — lineáris sáv és kör (ring).
 * MIKOR MELYIK (a kutatás alapján, docs-referencia a PR-leírásban):
 * - `ProgressBar` (lineáris): kurzus-fejléc, modul-lista, admin hallgatói tábla.
 * Egymás alatt a HOSSZ-összehasonlítás pontosabb, mint a szögé, ezért
 * listában és táblázatban mindig sáv van.
 * - `ProgressRing` (kör): kizárólag KOMPAKT, ismétlődő helyen — kurzuskártya
 */

export interface ProgressBarProps {
  /** 0–100 közötti, egész százalék. A komponens is beszorítja a tartományba. */
  percent: number
  /**
   * A képernyőolvasónak szánt, kész mondat („12 lecke kész a 18-ból”).
   * Ha hiányzik, a százalék hangzik el.
   */
  valueText?: string
  /**
   * A folyamatjelző HOZZÁFÉRHETŐ NEVE — mit mér ez a sáv („Kéztorna otthon —
   * haladás”). Név nélkül több kártyás listában a felolvasott érték
   * („67 százalék”) nem köthető kurzushoz (code review-találat).
   */
  label?: string
  /** Vékonyabb változat a kurzus-fejléc alsó élére. */
  size?: 'sm' | 'md'
  className?: string
}

const clampPercent = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.min(100, Math.max(0, Math.round(value)))
}

export function ProgressBar({ className, label, percent, size = 'md', valueText }: ProgressBarProps) {
  const value = clampPercent(percent)
  const classes = ['kc-progress-bar', size === 'sm' ? 'kc-progress-bar--sm' : null, className]
    .filter(Boolean)
    .join(' ')
  return (
    <div
      aria-label={label}
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={value}
      aria-valuetext={valueText}
      className={classes}
      role="progressbar"
    >
      <span className="kc-progress-bar__fill" style={{ inlineSize: `${value}%` }} />
    </div>
  )
}

export interface ProgressRingProps {
  /** 0–100 közötti, egész százalék. */
  percent: number
  /** Átmérő pixelben (kompakt helyre 40–48, táblasorba 28–32). */
  size?: number
  /** A kör közepére írt szöveg; alapértelmezés a százalék. `null` = üres közép. */
  label?: string | null
  /** Kész állapot — külön szín, hogy a 100% ránézésre elkülönüljön. */
  complete?: boolean
  className?: string
}

/**
 * SVG-kör `stroke-dasharray`/`stroke-dashoffset` technikával, −90 fokkal
 * elforgatva, hogy a kitöltés 12 óránál kezdődjön.
 *
 * A komponens EGÉSZÉBEN dekoratív (`aria-hidden`) — a hívó felelőssége, hogy a
 * ring mellett szövegesen is ott legyen az adat.
 */
export function ProgressRing({
  className,
  complete = false,
  label,
  percent,
  size = 44,
}: ProgressRingProps) {
  const value = clampPercent(percent)
  const stroke = size <= 32 ? 3 : 4
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - value / 100)
  const text = label === null ? null : (label ?? `${value}%`)

  return (
    <span
      aria-hidden="true"
      className={['kc-progress-ring', complete ? 'kc-progress-ring--complete' : null, className]
        .filter(Boolean)
        .join(' ')}
      style={{ inlineSize: `${size}px`, blockSize: `${size}px` }}
    >
      <svg focusable="false" height={size} viewBox={`0 0 ${size} ${size}`} width={size}>
        <circle
          className="kc-progress-ring__track"
          cx={size / 2}
          cy={size / 2}
          fill="none"
          r={radius}
          strokeWidth={stroke}
        />
        <circle
          className="kc-progress-ring__fill"
          cx={size / 2}
          cy={size / 2}
          fill="none"
          r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          strokeWidth={stroke}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      {text === null ? null : <span className="kc-progress-ring__label">{text}</span>}
    </span>
  )
}
