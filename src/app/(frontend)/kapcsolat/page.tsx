import type { Metadata } from 'next'

import { RenderBlocks } from '@/components/blocks/RenderBlocks'
import { Container } from '@/components/ui/Container'
import { Section } from '@/components/ui/Section'
import { getAppointmentSectionContext } from '@/lib/appointment/section'
import { getPageBySlug } from '@/lib/cms'
import './kapcsolat.css'

export const metadata: Metadata = {
  title: 'Kapcsolat',
  description:
    'Kérj időpontot rendelői kezelésre üzenetben, vagy hívd közvetlenül a gyógytornászainkat. Rendelőink címe és elérhetőségei egy helyen.',
  openGraph: {
    title: 'Kapcsolat',
    description:
      'Kérj időpontot rendelői kezelésre üzenetben, vagy hívd közvetlenül a gyógytornászainkat. Rendelőink címe és elérhetőségei egy helyen.',
  },
}

/**
 * /kapcsolat — dedikált route; CMS szekciósor a kapcsolat slugú oldalból.
 * Üres layout esetén: cím + bevezető + üzenetküldő űrlap (mai viselkedés).
 */
const CONTACT_PAGE_SLUG = 'kapcsolat'

export default async function KapcsolatPage() {
  const page = await getPageBySlug(CONTACT_PAGE_SLUG)
  const layout = page?.layout ?? []
  const appointment = await getAppointmentSectionContext(layout)

  return (
    <>
      {/* Lapfej széles konténerben — igazítva a szekciókhoz (nem narrow). */}
      <Section>
        <Container>
          <h1>Kapcsolat</h1>
        </Container>
      </Section>

      {layout.length > 0 ? (
        <RenderBlocks
          appointment={appointment}
          layout={layout}
          posts={[]}
          products={[]}
          testimonials={[]}
        />
      ) : null}

    </>
  )
}
