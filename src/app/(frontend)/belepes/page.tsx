import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getPayload } from 'payload'
import { headers } from 'next/headers'

import { Container } from '@/components/ui/Container'
import { Section } from '@/components/ui/Section'
import { LoginForm } from '@/components/auth/LoginForm'
import { ctaLabel } from '@/lib/cta-vocabulary'
import { DEFAULT_AUTH_RETURN_URL, forgotPasswordHref, sanitizeReturnUrl } from '@/lib/return-url'
import type { User } from '@/payload-types'

import config from '../../../payload.config'

export const metadata: Metadata = {
  title: 'Belépés',
  description: 'Lépj be a Kineticare fiókodba a kurzusaid és a rendeléseid eléréséhez.',
}

interface BelepesPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

async function getCurrentUser(): Promise<User | null> {
  try {
    const payload = await getPayload({ config })
    const { user } = await payload.auth({ headers: await headers() })
    return (user as User | null) ?? null
  } catch {
    return null
  }
}

/**
 * /belepes — a bejelentkezés oldala.
 *
 * A returnUrl-paraméterrel tér vissza oda, ahonnan jött (a checkoutból is
 * érkezhet — open-redirect ellen védve: csak belső útvonal fogadott).
 *
 * A szűrés a közös `sanitizeReturnUrl`-lel történik, EGYSZER, még a redirect-ág
 * előtt: a redirect és a form (`window.location.href`) így garantáltan ugyanazt
 * az ellenőrzött értéket kapja. A puszta `startsWith('/')` kevés lenne — a
 * `//evil.example` és a `/\evil.example` protokoll-relatív, azaz idegen eredetű.
 */
export default async function BelepesPage({ searchParams }: BelepesPageProps) {
  const params = await searchParams
  const user = await getCurrentUser()
  const returnUrl = sanitizeReturnUrl(params.returnUrl, DEFAULT_AUTH_RETURN_URL)

  if (user !== null) {
    redirect(returnUrl)
  }

  return (
    <Section>
      <Container size="narrow">
        <h1>Belépés</h1>
        <p className="kc-auth-lead">
          Lépj be a fiókodba a kurzusaid, a rendeléseid és a lejátszásaid eléréséhez.
        </p>
        <LoginForm returnUrl={returnUrl} />
        {/* A két hivatkozás felirata a §3.2 szótárból: #6 („Regisztráció" —
            a nav-menü és a beküldő gomb is így nevezi, WCAG 2.2 · 3.2.4) és
            #37 („Elfelejtetted a jelszavad?" — a cél oldal H1 címe, GOV.UK:
            „Consider using the title of the page the link goes to as your
            link text"). A korábbi „Regisztrálj" harmadik alak volt ugyanarra a
            cselekvésre. */}
        <p className="kc-auth-alt">
          Még nincs fiókod?{' '}
          <Link href={`/regisztracio?returnUrl=${encodeURIComponent(returnUrl)}`}>
            {ctaLabel('sign-up')}
          </Link>
          {' · '}
          <Link href={forgotPasswordHref(returnUrl)}>{ctaLabel('password-reset-start')}</Link>
        </p>
      </Container>
    </Section>
  )
}
