import type { LessonKind } from '@/lib/curriculum/curriculum'

/**
 * A lejátszó INLINE SVG-ikonjai.
 * A tananyag-rail sorai ikonokat viselnek (típus, státusz, melléklet), ami egy
 * 40 leckés kurzuson 100+ ikon. Egy külső ikon-csomag ezért mérhető
 * JS-terhelést hozna a fizetős tartalom LEGFONTOSABB oldalára, ráadásul saját
 * verziófüggést és a repóban máshol nem használt stílusnyelvet. Az itt élő pár
 * path a teljes igényt lefedi, fut szerveroldalon is, és nem terhel semmit.
 */

interface IconProps {
  className?: string
}

/** Közös SVG-váz: 24-es nézetdoboz, aktuális szövegszín, dekoratív. */
function iconProps(className: string | undefined, extra?: string) {
  return {
    'aria-hidden': true as const,
    className: [extra, className].filter(Boolean).join(' ') || undefined,
    focusable: 'false' as const,
    height: '1em',
    viewBox: '0 0 24 24',
    width: '1em',
    xmlns: 'http://www.w3.org/2000/svg',
  }
}

const strokeProps = {
  fill: 'none',
  stroke: 'currentColor',
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  strokeWidth: 1.8,
}

/** Videó-lecke: lejátszás-háromszög lekerekített kereten belül. */
export function VideoIcon({ className }: IconProps) {
  return (
    <svg {...iconProps(className, 'kc-player-icon')}>
      <rect height="15" rx="3" width="19" x="2.5" y="4.5" {...strokeProps} />
      <path d="M10 9.5 15 12l-5 2.5Z" {...strokeProps} fill="currentColor" />
    </svg>
  )
}

/** Szöveges lecke: dokumentum sorokkal. */
export function TextIcon({ className }: IconProps) {
  return (
    <svg {...iconProps(className, 'kc-player-icon')}>
      <path d="M6 3h8l4 4v14H6Z" {...strokeProps} />
      <path d="M14 3v4h4M9 12h6M9 16h6" {...strokeProps} />
    </svg>
  )
}

/** Külső link: nyíl, amely kilép a keretből. */
export function LinkIcon({ className }: IconProps) {
  return (
    <svg {...iconProps(className, 'kc-player-icon')}>
      <path d="M14 4h6v6M20 4l-8 8" {...strokeProps} />
      <path d="M18 14v5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 19V8a1.5 1.5 0 0 1 1.5-1.5H10" {...strokeProps} />
    </svg>
  )
}

/** A lecke típusának ikonja — a `kind` teljes lefedésével (nincs default ág). */
export function LessonKindIcon({ className, kind }: IconProps & { kind: LessonKind }) {
  if (kind === 'szoveg') {
    return <TextIcon className={className} />
  }
  if (kind === 'link') {
    return <LinkIcon className={className} />
  }
  return <VideoIcon className={className} />
}

/**
 * Lecke-státusz: ÜRES KÖR (nem kezdett) vagy TÖMÖR, pipás kör (kész).
 * A két állapot ALAKBAN is különbözik, nem csak színben (WCAG 1.4.1).
 */
export function LessonStatusIcon({ className, complete }: IconProps & { complete: boolean }) {
  if (!complete) {
    return (
      <svg {...iconProps(className, 'kc-player-icon kc-player-icon--status')}>
        <circle cx="12" cy="12" r="8.5" {...strokeProps} />
      </svg>
    )
  }
  return (
    <svg {...iconProps(className, 'kc-player-icon kc-player-icon--status')}>
      <circle cx="12" cy="12" fill="currentColor" r="9" />
      <path
        d="m7.8 12.2 2.8 2.8 5.6-5.6"
        fill="none"
        stroke="var(--kc-color-surface-raised)"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2.2"
      />
    </svg>
  )
}

/** Kész modul jelölése a modul-fejlécben. */
export function CheckIcon({ className }: IconProps) {
  return (
    <svg {...iconProps(className, 'kc-player-icon')}>
      <path d="m5 12.5 4.5 4.5L19 7" {...strokeProps} strokeWidth={2.2} />
    </svg>
  )
}

/** Akkordeon-chevron. A forgatást CSS végzi (nyitott állapotban 180°). */
export function ChevronIcon({ className }: IconProps) {
  return (
    <svg {...iconProps(className, 'kc-player-icon')}>
      <path d="m6 9.5 6 6 6-6" {...strokeProps} />
    </svg>
  )
}

/** Melléklet-jelölés (gemkapocs) a rail-sorban. */
export function AttachmentIcon({ className }: IconProps) {
  return (
    <svg {...iconProps(className, 'kc-player-icon')}>
      <path
        d="M18 11.5 12.2 17.3a3.6 3.6 0 0 1-5.1-5.1l6.6-6.6a2.4 2.4 0 0 1 3.4 3.4l-6.6 6.6a1.2 1.2 0 0 1-1.7-1.7l5.9-5.9"
        {...strokeProps}
      />
    </svg>
  )
}

/** Letöltés-ikon a „Letölthető anyagok" listában. */
export function DownloadIcon({ className }: IconProps) {
  return (
    <svg {...iconProps(className, 'kc-player-icon')}>
      <path d="M12 4v10m0 0 4-4m-4 4-4-4" {...strokeProps} />
      <path d="M5 17.5V19a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19v-1.5" {...strokeProps} />
    </svg>
  )
}

/** A mobil tananyag-panel bezáró ikonja. */
export function CloseIcon({ className }: IconProps) {
  return (
    <svg {...iconProps(className, 'kc-player-icon')}>
      <path d="m6 6 12 12M18 6 6 18" {...strokeProps} strokeWidth={2} />
    </svg>
  )
}

/** Nyíl-glifa az akciósáv gombjaihoz (dekoratív, a felirat hordozza a jelentést). */
export function ArrowIcon({ className, direction }: IconProps & { direction: 'előre' | 'vissza' }) {
  return (
    <svg {...iconProps(className, 'kc-player-icon')}>
      {direction === 'előre' ? (
        <path d="M4.5 12h15m0 0-5.5-5.5M19.5 12 14 17.5" {...strokeProps} />
      ) : (
        <path d="M19.5 12h-15m0 0L10 6.5M4.5 12 10 17.5" {...strokeProps} />
      )}
    </svg>
  )
}
