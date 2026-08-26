import { faqPageJsonLd } from '../../lib/seo'
import type { BlockFaq } from '../../payload-types'
import { JsonLd } from '../content/JsonLd'
import { Container } from '../ui/Container'
import { Section } from '../ui/Section'

import '../../app/(frontend)/styles/blocks/faq.css'

/**
 * FaqBlock — GYIK (szekció-rendszer terv 2. katalógus, M8; renderelés: 5. pont).
 * A meglévő kezdőlapi `home/Faq.tsx` akadálymentes mintáját követi: natív
 * `details`/`summary`, tehát kliens-oldali JS nélkül is nyitható-csukható, és a
 * képernyőolvasó is kapja az összecsukott/kinyitott állapotot.
 * A FAQPage JSON-LD UGYANEBBŐL a listából készül (terv 5. pont), ezért a
 * strukturált adat és a látható szöveg sosem tud szétcsúszni — az eltérés a
 */
export interface FaqBlockProps {
  block: BlockFaq
}

export function FaqBlock({ block }: FaqBlockProps) {
  const items = (block.items ?? [])
    .map((item) => ({
      id: item.id,
      question: item.question?.trim() ?? '',
      answer: item.answer?.trim() ?? '',
    }))
    .filter((item) => item.question.length > 0 && item.answer.length > 0)

  if (items.length === 0) {
    return null
  }

  const settings = block.sectionSettings
  const anchorId = settings?.anchorId?.trim() || undefined
  const variant =
    settings?.hatter === 'tint' ? 'tint' : settings?.hatter === 'sotet' ? 'dark' : 'default'
  const headingId = `faq-cim-${block.id ?? 'fo'}`
  const heading = block.heading?.trim() ?? ''

  return (
    <>
      <JsonLd
        data={faqPageJsonLd(
          items.map((item) => ({ question: item.question, answer: item.answer })),
        )}
      />
      <Section
        aria-labelledby={heading.length > 0 ? headingId : undefined}
        className="kc-faq"
        id={anchorId}
        variant={variant}
      >
        <Container size="narrow">
          {heading.length > 0 ? (
            <h2 className="kc-faq__title" id={headingId}>
              {heading}
            </h2>
          ) : null}
          <div className="kc-faq__list">
            {items.map((item, index) => (
              <details className="kc-faq__item" key={item.id ?? `kerdes-${index}`}>
                <summary className="kc-faq__question">{item.question}</summary>
                <p className="kc-faq__answer">{item.answer}</p>
              </details>
            ))}
          </div>
        </Container>
      </Section>
    </>
  )
}
