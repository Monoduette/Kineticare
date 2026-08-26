import { Container } from '../../ui/Container'
import { Section } from '../../ui/Section'

import '../../../app/(frontend)/styles/blocks/faq.css'

/**
 * Faq — gyakori kérdések (audit M8/K7: ellenérv-kezelés a vásárlás előtt).
 * Statikus magyar szöveg az audit által azonosított kérdésekkel. A natív
 * <details>/<summary> kliens-oldali JS nélkül is működik (SSR-barát).
 * A válaszok óvatosak: műtét utáni helyzetben mindig a kezelőorvos/gyógytornász
 * jóváhagyása az irányadó — orvosi ígéretet nem teszünk.
 * STÍLUS: a szekció a KÖZÖS GYIK-stíluslapot viseli (styles/blocks/faq.css) —
 */

/**
 * Exportált, hogy a kezdőlap FAQPage JSON-LD-je UGYANEBBŐL a forrásból épüljön.
 * Így a strukturált adat és a látható szöveg nem tud szétcsúszni — az eltérő
 * schema és oldalszöveg a leggyakoribb ok, amiért a keresők elvetik a rich
 * resultot, az AI pedig téves választ idéz.
 */
export const FAQ_ITEMS: ReadonlyArray<{ question: string; answer: string }> = [
  {
    question: 'Műtét után is végezhetem a gyakorlatokat?',
    answer:
      'A kurzusok általános rehabilitációs programok. Műtét után mindig a kezelőorvosod vagy gyógytornászod jóváhagyásával kezdj bele. Ha bizonytalan vagy, írj nekünk a kapcsolat oldalon, és segítünk eligazodni.',
  },
  {
    question: 'Fájdalmasak a gyakorlatok?',
    answer:
      'Nem kell, hogy fájjanak. A gyakorlatokat a saját tűrőképességedhez igazítod; éles fájdalom esetén hagyd abba, és kérj szakmai segítséget.',
  },
  {
    question: 'Mennyi időt vesz igénybe naponta?',
    answer:
      'Napi 10–15 perc is elég: a rövid, rendszeres gyakorlás hozza a tartós eredményt, nem az egyszeri nagy erőfeszítés.',
  },
  {
    question: 'Szükségem van eszközökre a gyakorlatokhoz?',
    answer:
      'Nem. A gyakorlatok többsége saját testsúllyal, otthon található eszközökkel végezhető. Ahol bármi kell, azt a videóban jelezzük.',
  },
]

export function Faq() {
  return (
    <Section className="kc-faq" variant="default">
      <Container size="narrow">
        <h2 className="kc-faq__title">Gyakori kérdések</h2>
        <div className="kc-faq__list">
          {FAQ_ITEMS.map((item) => (
            <details className="kc-faq__item" key={item.question}>
              <summary className="kc-faq__question">{item.question}</summary>
              <p className="kc-faq__answer">{item.answer}</p>
            </details>
          ))}
        </div>
      </Container>
    </Section>
  )
}
