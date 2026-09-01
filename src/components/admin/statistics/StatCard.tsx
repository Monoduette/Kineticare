import { cardLabelStyle, cardStyle, cardValueStyle } from './styles'

/**
 * Összesítő kártya — a CourseProgressPanel StatCard mintája (érték felül,
 * címke alul). A `valueColor` a figyelmet kérő értéknek szól (pl. sikertelen
 * fizetés): a szín KIEGÉSZÍTŐ jelzés, az információt maga a címke szövege
 * hordozza (WCAG 2.2 SC 1.4.1 Use of Color:
 * https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html).
 */
export function StatCard({
  label,
  value,
  valueColor,
}: {
  label: string
  value: string
  valueColor?: string
}) {
  return (
    <div className="kc-as-card" style={cardStyle}>
      <span
        style={valueColor === undefined ? cardValueStyle : { ...cardValueStyle, color: valueColor }}
      >
        {value}
      </span>
      <span style={cardLabelStyle}>{label}</span>
    </div>
  )
}
