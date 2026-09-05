import type { Metadata } from 'next'
import { draftMode } from 'next/headers'
import { cache } from 'react'

import { DemoCourseLanding } from '@/components/campaign/DemoCourseLanding'
import { PreviewBar } from '@/components/preview/PreviewBar'
import { getPageBySlug } from '@/lib/cms'
import { DEMO_COURSE_PATH, DEMO_COURSE_SLUG } from '@/lib/demo-course-route'
import { buildPageMetadata } from '@/lib/seo'

export const dynamic = 'force-dynamic'

const campaignPage = cache((draft: boolean) => getPageBySlug(DEMO_COURSE_SLUG, { draft }))

export async function generateMetadata(): Promise<Metadata> {
  const { isEnabled } = await draftMode()
  const page = await campaignPage(isEnabled)
  return {
    ...buildPageMetadata(
      page ?? {
        title: 'Képzeletbeli akciós kurzus',
        excerpt:
          'Ismerd meg a Kineticare online kézrehabilitációs kurzusának bemutatóoldalát: modulok, olvasható tananyagminta és válaszok a kérdéseidre.',
      },
      DEMO_COURSE_PATH,
    ),
    // A demo kozzetetele nem eles ajanlat. A noindex a CMS statuszatol fuggetlen.
    robots: { index: false, follow: true, googleBot: { index: false, follow: true } },
  }
}

export default async function DemoCoursePage() {
  const { isEnabled } = await draftMode()
  const page = await campaignPage(isEnabled)
  return (
    <>
      {isEnabled ? <PreviewBar path={DEMO_COURSE_PATH} /> : null}
      <DemoCourseLanding page={page} />
    </>
  )
}
