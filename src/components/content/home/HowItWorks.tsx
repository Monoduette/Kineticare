import {
  HOW_IT_WORKS_STEP1_FIXED,
  rewriteVisitorDashLeftover,
} from '../../../lib/gondolatjel-leftover'
import { Container } from '../../ui/Container'
import { Section } from '../../ui/Section'

import '../../../app/(frontend)/styles/blocks/how-it-works.css'

/**
 * HowItWorks — „Így működik az online kurzus" 3 lépésben (audit M5/K6).
 * A mechanizmus (megveszem → azonnal nézem → otthon gyakorlok) a legfontosabb
 * ellenérv-csökkentő egy videókurzusnál. Statikus magyar szöveg — a Katák
 * hangneme: szakmai, meleg, bizalomépítő (nincs marketing-hype).
 * Megjelenés: a landing számozott-sor nyelve (hajszálvonalas sorok, nagy
 * halvány serif sorszám) — a stílus a styles/blocks/how-it-works.css-ben él.
 */

export interface HowItWorksStep {
  title: string
  text: string
}

const STEPS: HowItWorksStep[] = [
  {
    title: 'Kiválasztod a kurzust',
    text: HOW_IT_WORKS_STEP1_FIXED,
  },
  {
    title: 'Azonnal hozzáférsz',
    text: 'A videós anyagokat a fiókodban éred el, saját tempódban, amikor neked megfelel.',
  },
  {
    title: 'Otthon gyakorolsz',
    text: 'A gyakorlatok lépésről lépésre vezetnek, naponta néhány perc is elég a haladáshoz.',
  },
]

export interface HowItWorksProps {
  /** Cím-felülírás a `howItWorks` blokkból — üresen a beépített cím marad. */
  title?: string
  /** Lépés-felülírás a blokkból; üresen/hiányozva a beépített 3 lépés jön. */
  steps?: HowItWorksStep[]
  id?: string
  variant?: 'default' | 'tint' | 'dark'
}

export function HowItWorks({ title, steps, id, variant = 'default' }: HowItWorksProps = {}) {
  const heading = title?.trim() || 'Így működik az online kurzus'
  const shownSteps = steps && steps.length > 0 ? steps : STEPS

  return (
    <Section className="kc-how" id={id} variant={variant}>
      <Container>
        <div className="kc-how__grid">
          <div className="kc-how__head">
            <h2 className="kc-section-title">{heading}</h2>
          </div>
          <ol className="kc-how__list">
            {shownSteps.map((step, index) => (
              <li className="kc-how__row" key={step.title}>
                {/* A sorrendet a rendezett lista hordozza — a látható sorszám dekoratív. */}
                <p aria-hidden="true" className="kc-how__num">
                  {index + 1}
                </p>
                <div className="kc-how__body">
                  <h3 className="kc-how__step-title">{step.title}</h3>
                  {/* Élő CMS-maradék: U+2014 → vessző, pontos egyezés. */}
                  <p className="kc-how__text">{rewriteVisitorDashLeftover(step.text)}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </Container>
    </Section>
  )
}
