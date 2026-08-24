import { faqPageJsonLd } from '../../lib/seo'
import { JsonLd } from './JsonLd'
import type { PostFaqItem } from './post-article'

import '../../app/(frontend)/styles/blocks/faq.css'
import '../../app/(frontend)/styles/blocks/post-view.css'

/**
 * PostFaq — „Gyakori kérdések" a cikk törzsének végén.
 *
 * ═══ MIÉRT UGYANAZ A NYELV, MINT A TÖBBI GYIK-EN ═══
 * A kezdőlap és a kurzusoldal GYIK-je natív `details`/`summary` elemekből áll
 * (`src/components/blocks/FaqBlock.tsx`, `styles/blocks/faq.css`): kliens-JS
 * nélkül is nyitható, és a képernyőolvasó megkapja az összecsukott/kinyitott
 * állapotot. A cikkoldal NEM új harmonikát épít, hanem ugyanazokat az
 * osztályokat viseli — WCAG 2.2 **3.2.4** (Consistent Identification): ugyanaz
 * a dolog ugyanúgy nézzen ki és ugyanúgy hívják.
 *
 * Miért nem a `FaqBlock` újrahívása: az egy teljes `Section`-t renderel
 * blokk-beállításokkal (háttér, horgony, saját szekció-ritmus). Itt a GYIK a
 * CIKK TÖRZSÉNEK része, a szűk konténerben, a Lexical-törzs után. A sablon
 * nem injektál Források-szekciót a GYIK elé.
 *
 * ═══ A STRUKTURÁLT ADAT UGYANEBBŐL A LISTÁBÓL KÉSZÜL ═══
 * A `faqPageJsonLd` ugyanazt a tömböt kapja, amit a látható lista — így a
 * kettő fizikailag nem tud szétcsúszni. Ez a leggyakoribb ok, amiért a
 * keresők elvetik a rich resultot (Google, *Structured data general
 * policies*: https://developers.google.com/search/docs/appearance/structured-data/sd-policies).
 *
 * A FAQ rich result megjelenését a Google 2023 augusztusa óta „well-known,
 * authoritative government and health websites" körére szűkítette
 * (https://developers.google.com/search/blog/2023/08/howto-faq-changes) — a
 * markup ettől függetlenül helyes és hasznos: a kérdés-válasz párokat az
 * AI-válaszok és az egyéb kereső-felületek is ebből olvassák
 * (docs/seo-geo-llm.md 2. fejezet).
 *
 * ═══ ORVOSI TARTALOM ═══
 * A válaszok a cikk törzsének állításait ismétlik, ugyanazokkal a
 * forrásokkal; forrás nélküli klinikai állítás GYIK-ben sem állhat. A
 * tartalmi felelősség a szerkesztőé, a felületé a korlát: hiányos tétel
 * (üres kérdés vagy válasz) sem a listába, sem a sémába nem kerül be.
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
