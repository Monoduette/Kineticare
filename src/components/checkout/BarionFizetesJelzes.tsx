import { Card } from '../ui/Card'
import { Container } from '../ui/Container'
import { Section } from '../ui/Section'

import '../../app/(frontend)/styles/blocks/barion-fizetes.css'

/**
 * Barion fizetési jelzés — hivatalos logósor a pénztárban (elfogadóhely-követelmény).
 * A gomb felirata érintetlen; a bizalmi szöveg a gomb mellett, elhatárolt kártyában.
 * Ingyenes ágon NEM jelenik meg (CheckoutForm dönt).
 */

/** A hivatalos logósor a `public/` alatt (a README rögzíti a forrást). */
export const BARION_LOGOSOR_SRC = '/assets/barion/barion-smart-banner-light.svg'

/** A csomagból származó, EREDETI rajzméret — az arány ebből jön (567 : 108). */
export const BARION_LOGOSOR_SZELESSEG = 567
export const BARION_LOGOSOR_MAGASSAG = 108

/**
 * Az `alt` a képen látható fizetési módokat sorolja fel, mert ez az információ
 * maga (WCAG 2.2 SC 1.1.1). A sorrend a logósorét követi.
 */
export const BARION_LOGOSOR_ALT =
  'Elfogadott fizetési módok: Barion, Mastercard, VISA, Apple Pay, Google Pay'

/** A címsor mindkét helyen AZONOS (WCAG 2.2 SC 3.2.4, konzisztens azonosítás). */
export const BARION_CIM = 'Biztonságos fizetés'

/** A kezdőlapi szekció címsorának azonosítója (a landmark neve). */
export const BARION_KEZDOLAP_CIM_ID = 'kc-barion-fizetes-cim'

/**
 * A kezdőlapi szöveg. Az MNB-engedélyszám a repó saját, tulajdonos által
 * jóváhagyott ÁSZF-szövegéből származik (`src/lib/legal-source/aszf.txt`),
 * hogy a vevői felület és a szerződés ne mondjon két különbözőt.
 */
export const BARION_KEZDOLAP_SZOVEG =
  'A kurzusokat bankkártyával fizeted ki, a Barion biztonságos fizetőoldalán. ' +
  'A kártyaadataidat a Kineticare nem látja és nem tárolja. ' +
  'A szolgáltatást nyújtó Barion Payment Zrt. a Magyar Nemzeti Bank felügyelete ' +
  'alatt álló intézmény, engedélyének száma: H-EN-I-1064/2013.'

/**
 * A pénztári szöveg. Azt mondja meg, MI TÖRTÉNIK a kattintás után (NN/g
 * Upfront Disclosure), és nem idézi a gomb feliratát (lásd a fejkomment 3.
 * pontját).
 */
export const BARION_PENZTAR_SZOVEG =
  'A fizetés a Barion biztonságos oldalán zajlik: a gombra kattintva odaviszünk, ' +
  'és a kártyaadataidat ott adod meg. Hozzánk nem jutnak el, és nem is tároljuk ' +
  'őket. A fizetés végén automatikusan visszatérsz a Kineticare oldalára.'

/** Hol áll a jelzés: a kezdőlap alján vagy a pénztárban, a fizetőgomb fölött. */
export type BarionJelzesHely = 'kezdolap' | 'penztar'

export interface BarionFizetesJelzesProps {
  hely: BarionJelzesHely
}

/**
 * A logósor képe. Külön függvény, hogy a két elrendezés BITRE ugyanazt a képet
 * és ugyanazt az `alt`-ot vigye — a jóváhagyás szempontjából a két oldalon
 * ugyanannak kell látszania.
 *
 * A `width`/`height` az EREDETI rajzméret: enélkül a böngésző a betöltésig nem
 * ismeri az arányt, és a kép beugrása elmozdítaná a fizetőgombot (elrendezés-
 * ugrás közvetlenül a kattintás előtt). A tényleges méretezés a CSS-é, arányosan.
 *
 * `loading="lazy"` NINCS a pénztári ágon: a kép a fizetőgomb mellett áll, tehát
 * a döntés pillanatában látszania kell.
 */
function BarionLogosor() {
  // Sima `<img>` és nem `next/image`: a hivatalos SVG-t változtatás nélkül,
  // újrakódolás nélkül kell kiszolgálni (Barion: „módosítás nélkül"), és a
  // next/image raszter-pipeline-ja SVG-re amúgy sem optimalizál. A repó más
  // helyein is ez a minta (HeroVideo poszter, CourseCard).
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a hivatalos SVG-t változtatás és újrakódolás nélkül kell kiszolgálni (Barion: „módosítás nélkül"), a next/image raszter-pipeline-ja SVG-re amúgy sem optimalizál
    <img
      alt={BARION_LOGOSOR_ALT}
      className="kc-barion__logosor"
      height={BARION_LOGOSOR_MAGASSAG}
      src={BARION_LOGOSOR_SRC}
      width={BARION_LOGOSOR_SZELESSEG}
    />
  )
}

export function BarionFizetesJelzes({ hely }: BarionFizetesJelzesProps) {
  if (hely === 'penztar') {
    // A pénztárban a jelzés a form KÁRTYA-nyelvét viszi (mint a számlázási és
    // az elállási blokk), és közvetlenül a fizetőgomb fölött áll — Baymard:
    // „placing 1-2 icons within the encapsulated area".
    // A címsor OSZTÁLY NÉLKÜLI h2: a `.kc-card > h2:not([class])` közös szabály
    // (styles/ui.css) adja neki a kártyacím-tipográfiát, ugyanazt, amit a
    // „Számlázási adatok" és az „Elállási jog" kap.
    return (
      <Card className="kc-barion kc-barion--penztar">
        <h2>{BARION_CIM}</h2>
        <BarionLogosor />
        <p className="kc-barion__szoveg">{BARION_PENZTAR_SZOVEG}</p>
      </Card>
    )
  }

  // Kezdőlap: halk bizalmi csík a lábléc fölött, a hitel-csík (CredentialsStrip)
  // bevált nyelvén — `flush` szekció felső hajszálvonallal. Azért `flush` és nem
  // sáv-háttér, mert a kezdőlap utolsó szekciója mindkét ágon (rögzített M1–M8
  // és CMS-szekciósor) más-más lehet: egy fix tint-háttér ott két tint sávot
  // olvasztana egybe. A hajszálvonal bármelyik előzmény után elhatárol.
  // A címsor az `.kc-eyebrow` felvezető-nyelvét viszi: a szintet nem méret,
  // hanem verzál + betűköz + akcent-szín jelöli (tokens.css három-méretes
  // skála). A verzál CSS-transzformáció, a DOM-szöveg mondatkezdő nagybetűs
  // marad (docs/ui-sztenderdek.md M-4).
  return (
    <Section
      aria-labelledby={BARION_KEZDOLAP_CIM_ID}
      className="kc-barion kc-barion--kezdolap"
      flush
    >
      <Container>
        <div className="kc-barion__inner">
          <h2 className="kc-eyebrow kc-barion__cim" id={BARION_KEZDOLAP_CIM_ID}>
            {BARION_CIM}
          </h2>
          <BarionLogosor />
          <p className="kc-barion__szoveg">{BARION_KEZDOLAP_SZOVEG}</p>
        </div>
      </Container>
    </Section>
  )
}
