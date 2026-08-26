/**
 * CourseJumpNav — „Ugrás:" horgony-chipek a kurzusoldal fő szakaszaira.
 * Miért: az NN/g 11 fős vizsgálatában a résztvevők 9/11 aránya ismerte és
 * használta a lapon belüli linkeket, és konkrét információigény esetén
 * azonnal odanyúltak; a GOV.UK a harmonika ELŐTT is ezt javasolja
 * (docs/ux-belso-oldalak-kutatas.md K11, B2.3, B5.5).
 * A chipek CSAK a ténylegesen létező szakaszokra mutatnak — üres horgony
 */
export interface CourseJumpTarget {
  id: string
  label: string
}

export interface CourseJumpNavProps {
  targets: CourseJumpTarget[]
}

export function CourseJumpNav({ targets }: CourseJumpNavProps) {
  if (targets.length < 2) {
    return null
  }
  return (
    <nav aria-label="Ugrás az oldal szakaszaira" className="kc-course-jump">
      <span aria-hidden="true" className="kc-course-jump__label">
        Ugrás:
      </span>
      <ul role="list">
        {targets.map((target) => (
          <li key={target.id}>
            <a className="kc-course-jump__chip" href={`#${target.id}`}>
              {target.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}
