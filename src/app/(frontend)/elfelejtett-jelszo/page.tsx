import type { Metadata } from 'next'
import Link from 'next/link'

import { Container } from '@/components/ui/Container'
import { Section } from '@/components/ui/Section'
import { ForgotPasswordForm } from '@/components/auth/ForgotPasswordForm'

export const metadata: Metadata = {
  title: 'Elfelejtett jelszó',
  description: 'Kérj jelszó-visszaállító linket az e-mail-címedre.',
}

/**
 * A MÁSODIK bekezdés az ÁTKÖLTÖZTETETT vevő biztonsági hálója.
 * A systeme.io-ról áthozott vevő fő útja a `/belepes-atallas` lap (oda visz az
 * átállási levél). Aki a levelet nem kapta meg, elvesztette vagy nem hisz neki,
 * a MEGSZOKOTT úton érkezik: fejléc → Belépés → régi jelszó → „Hibás e-mail-cím
 * vagy jelszó." → „Elfelejtetted a jelszavad?". Erre a lapra tehát olyan ember
 * is beesik, aki NEM felejtette el a jelszavát.
 */
export default function ElfelejtettJelszoPage() {
  return (
    <Section>
      <Container size="narrow">
        <h1>Elfelejtetted a jelszavad?</h1>
        <p className="kc-auth-lead">
          Add meg az e-mail-címedet, és küldünk egy jelszó-visszaállító linket. Ha a cím létezik
          a rendszerünkben, a link néhány percen belül megérkezik.
        </p>
        <p className="kc-auth-lead">
          Ha korábban a régi Kineticare-oldalon vásároltál, az ottani jelszavad itt nem működik:
          az másik rendszer volt. Add meg ugyanazt az e-mail-címet, amellyel vásároltál, és itt
          állíthatsz be újat. A megvásárolt kurzusaid megvannak, újra fizetned nem kell.
        </p>
        <ForgotPasswordForm />
        {/* Önállóan álló link: a `.kc-auth-actions` sor adja a 44 px-es
            célfelületet. A korábbi `.kc-auth-alt` MONDATBA ágyazott linkeknek
            való, és itt 117,1 × 18 CSS px-es célt adott (mérve) — a WCAG 2.2 ·
            2.5.8 24 × 24-es küszöbe alatt, „Inline" kivétel nélkül. */}
        <div className="kc-auth-actions">
          <Link href="/belepes">Vissza a belépéshez</Link>
        </div>
      </Container>
    </Section>
  )
}
