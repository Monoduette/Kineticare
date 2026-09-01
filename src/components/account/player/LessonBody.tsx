import { Button } from '@/components/ui/Button'
import { RichText } from '@/components/lexical/RichText'
import type { CurriculumLesson } from '@/lib/curriculum/curriculum'

import { DownloadIcon } from './icons'

/**
 * A LECKE TÖRZSE a színpadon: a szöveges tartalom, a külső link kártyája és a
 * letölthető mellékletek.
 * Ez a rész SEMMIT nem tud a lejátszó-állapotról (jegy, iframe, időzítő) — tehát
 * nincs is szüksége rá. Külön tartva a `CoursePlayer` a lejátszási lánccal
 * foglalkozik, ez pedig a tartalommal; a szöveges és link-leckék így akkor is
 * hibátlanul megjelennek, ha a videó-ág éppen hibába fut.
 */

export interface LessonBodyProps {
  lesson: CurriculumLesson
}

export function LessonBody({ lesson }: LessonBodyProps) {
  const hasContent = lesson.content !== null
  const hasAttachments = lesson.attachments.length > 0
  const isLink = lesson.kind === 'link' && lesson.url !== null

  if (!hasContent && !hasAttachments && !isLink) {
    return null
  }

  return (
    <div className="kc-player-body">
      {isLink && lesson.url !== null ? (
        <div className="kc-player-body__link-card">
          <p className="kc-player-body__link-text">
            Ez a lecke egy külső oldalra visz. A link új lapon nyílik, a kurzus itt marad
            megnyitva.
          </p>
          <Button href={lesson.url} openInNewTab>
            Megnyitom: {lesson.title}
          </Button>
        </div>
      ) : null}

      {hasContent ? <RichText className="kc-player-body__text" content={lesson.content} /> : null}

      {hasAttachments ? (
        <section aria-labelledby="kc-player-mellekletek" className="kc-player-body__attachments">
          <h2 className="kc-player-body__attachments-title" id="kc-player-mellekletek">
            Letölthető anyagok
          </h2>
          <ul className="kc-player-body__attachment-list">
            {lesson.attachments.map((attachment, index) => (
              <li className="kc-player-body__attachment" key={`${attachment.label}-${index}`}>
                {attachment.url === null ? (
                  // A média-rekord nincs (még) feltöltve: a sor MEGMARAD, de nem
                  // ígér működő letöltést — a néma eltüntetés a szerkesztőnek is
                  // elrejtené a hibát.
                  <span className="kc-player-body__attachment-missing">
                    <DownloadIcon />
                    {/* Kettőspont, nem gondolatjel: docs/ui-sztenderdek.md §3.1 */}
                    {attachment.label}: a fájl feltöltése folyamatban
                  </span>
                ) : (
                  <a
                    className="kc-player-body__attachment-link"
                    download
                    href={attachment.url}
                    rel="noopener noreferrer"
                  >
                    <DownloadIcon />
                    <span>{attachment.label}</span>
                    <span className="kc-sr-only">(letöltés)</span>
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
