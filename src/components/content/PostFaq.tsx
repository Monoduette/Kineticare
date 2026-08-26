import { faqPageJsonLd } from '../../lib/seo'
import { JsonLd } from './JsonLd'
import type { PostFaqItem } from './post-article'

import '../../app/(frontend)/styles/blocks/faq.css'
import '../../app/(frontend)/styles/blocks/post-view.css'

/**
 * PostFaq — „Gyakori kérdések" a cikk törzsének végén.
 * állapotot. A cikkoldal NEM új harmonikát épít, hanem ugyanazokat az
 * A `faqPageJsonLd` ugyanazt a tömböt kapja, amit a látható lista — így a
 */
export interface PostFaqProps {
  items: ReadonlyArray<PostFaqItem>
}

/** A szekció címsorának horgonya; foglalt id (post-outline.ts). */
export const POST_FAQ_HEADING_ID = 'gyakori-kerdesek'

/** A szekció látható címe — azonos a kezdőlapi és kurzusoldali GYIK-ével. */
export const POST_FAQ_HEADING = 'Gyakori kérdések'

export function PostFaq({ items }: PostFaqProps) {
  if (items.length === 0) {
    return null
  }
  return (
    <section aria-labelledby={POST_FAQ_HEADING_ID} className="kc-faq kc-post-faq">
      <JsonLd data={faqPageJsonLd(items)} />
      <h2 className="kc-faq__title" id={POST_FAQ_HEADING_ID}>
        {POST_FAQ_HEADING}
      </h2>
      <div className="kc-faq__list">
        {/* A kulcs a sorszámból jön (a FaqBlock bevált mintája): a kérdés
            szövege nem garantáltan egyedi, két azonos kérdés React-kulcs-
            ütközést adna. */}
        {items.map((item, index) => (
          <details className="kc-faq__item" key={`kerdes-${index}`}>
            <summary className="kc-faq__question">{item.question}</summary>
            <p className="kc-faq__answer">{item.answer}</p>
          </details>
        ))}
      </div>
    </section>
  )
}
