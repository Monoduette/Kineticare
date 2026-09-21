import {
  groupCourseDescription,
  type CourseDescriptionDocument,
} from '../../../lib/course-description-layout'
import { LexicalContent } from '../LexicalContent'

export function CourseDescriptionContent({ content }: { content: CourseDescriptionDocument }) {
  const sections = groupCourseDescription(content)
  const chunk = (children: CourseDescriptionDocument['root']['children']) => ({
    ...content,
    root: { ...content.root, children },
  })
  return (
    <div className="kc-course-description">
      {sections.map((section, sectionIndex) => (
        <div className="kc-course-description__section" key={sectionIndex}>
          {section.lead.length > 0 ? (
            <LexicalContent className="kc-course-description__lead" content={chunk(section.lead)} />
          ) : null}
          {section.groups.length > 0 ? (
            <div
              className={
                section.columns === 2
                  ? 'kc-course-fit kc-course-description__groups'
                  : section.columns === 3
                    ? 'kc-course-steps kc-course-description__groups'
                    : 'kc-course-description__groups'
              }
              data-columns={section.columns}
            >
              {section.groups.map((group, index) => (
                <LexicalContent
                  className="kc-course-description__group"
                  content={chunk(group)}
                  key={index}
                />
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  )
}
