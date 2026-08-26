import '../../app/(frontend)/styles/blocks/post-view.css'

/**
 * PostToc — tartalomjegyzék a cikk elején („Ezen az oldalon").
 * Az első hat tétel mindig látszik; a többi natív details mögött.
 * Nem ragadós: a fejléc mellett WCAG 2.4.11 kockázat lenne.
 * Görgetés/fókusz: globális AnchorScroll intézi.
 */
export interface PostTocProps {
  /** A cikk H2-szakaszai dokumentum-sorrendben (post-outline.ts). */
  items: ReadonlyArray<{ id: string; text: string }>
}

/** A jegyzék saját címsorának horgonya; foglalt id (post-outline.ts). */
const TOC_HEADING_ID = 'tudastar-toc-cim'

/** Nyitás nélkül látható tételek száma (GYIK-maximummal egyezik). */
export const TOC_ELONEZET_TETEL = 6

export function PostToc({ items }: PostTocProps) {
  if (items.length === 0) {
    return null
  }
  // Egyetlen tételért nem nyitunk harmonikát: hét tételnél a „További 1
  // szakasz" nyitó ugyanannyi helyet kér, mint maga a tétel.
  const elonezet = items.length <= TOC_ELONEZET_TETEL + 1 ? items.length : TOC_ELONEZET_TETEL
  const lathato = items.slice(0, elonezet)
  const tovabbi = items.slice(elonezet)
  return (
    <nav aria-labelledby={TOC_HEADING_ID} className="kc-post-toc">
      <h2 className="kc-post-toc__title" id={TOC_HEADING_ID}>
        Ezen az oldalon
      </h2>
      <ol className="kc-post-toc__list">
        {lathato.map((item) => (
          <li key={item.id}>
            <a href={`#${item.id}`}>{item.text}</a>
          </li>
        ))}
      </ol>
      {tovabbi.length > 0 ? (
        <details className="kc-post-toc__tobbi">
          {/* A felirat MEGNEVEZI, mi van mögötte (GOV.UK Details: a nyitó
              mondja meg, mit tár fel), és a darabszámmal a lap szerkezetének
              képe akkor is megvan, ha a látogató nem nyitja ki. */}
          <summary className="kc-post-toc__nyito">További {tovabbi.length} szakasz</summary>
          {/* A `start` folytatja a számozást: a sorrend információ. */}
          <ol className="kc-post-toc__list" start={elonezet + 1}>
            {tovabbi.map((item) => (
              <li key={item.id}>
                <a href={`#${item.id}`}>{item.text}</a>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </nav>
  )
}
