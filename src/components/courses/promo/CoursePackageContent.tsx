import type { CoursePackageData, CoursePackageIcon } from '../../../lib/course-package'

const ICON_FILES: Record<CoursePackageIcon, string> = {
  play: 'play',
  video: 'video',
  clock: 'clock',
  shield: 'shield-check',
  book: 'book-open',
  file: 'file-text',
  users: 'users-round',
}

export function CoursePackageContent({
  data,
  enhanced = false,
}: {
  data: CoursePackageData
  enhanced?: boolean
}) {
  const split = Math.ceil(data.items.length / 2)
  const groups = enhanced ? [data.items.slice(0, split), data.items.slice(split)] : [data.items]
  return (
    <div className={enhanced ? 'kc-course-package' : undefined}>
      <h2 className="kc-course-section__title" id={enhanced ? 'csomag-cim' : undefined}>
        {data.heading}
      </h2>
      <div
        className={enhanced ? 'kc-course-fit' : undefined}
        data-columns={enhanced ? (data.items.length > 1 ? '2' : '1') : undefined}
      >
        {groups
          .filter((group) => group.length > 0)
          .map((group, groupIndex) => (
            <ul
              className={enhanced ? 'kc-course-package__list' : undefined}
              key={groupIndex}
              role="list"
            >
              {group.map((item, index) => (
                <li className={enhanced ? 'kc-course-package__item' : undefined} key={index}>
                  {enhanced ? (
                    <span aria-hidden="true" className="kc-course-package__icon">
                      <span
                        style={{
                          maskImage: `url(/assets/icons/course-package/${ICON_FILES[item.icon]}.svg)`,
                          WebkitMaskImage: `url(/assets/icons/course-package/${ICON_FILES[item.icon]}.svg)`,
                        }}
                      />
                    </span>
                  ) : null}
                  <p className={enhanced ? 'kc-course-package__text' : undefined}>
                    <strong>{item.title}</strong>
                    {item.description ? <> {item.description}</> : null}
                  </p>
                </li>
              ))}
            </ul>
          ))}
      </div>
    </div>
  )
}
