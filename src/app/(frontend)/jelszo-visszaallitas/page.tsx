import type { Metadata } from 'next'
import Link from 'next/link'

import { Container } from '@/components/ui/Container'
import { Section } from '@/components/ui/Section'
import { ResetPasswordForm } from '@/components/auth/ResetPasswordForm'
import { ctaLabel } from '@/lib/cta-vocabulary'
import { DEFAULT_AUTH_RETURN_URL, forgotPasswordHref, sanitizeReturnUrl } from '@/lib/return-url'

export const metadata: Metadata = {
  title: 'Új jelszó beállítása',
  description: 'Állíts be új jelszót a visszaállító linkkel.',
}

interface ResetPasswordPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function ResetPasswordPage({ searchParams }: ResetPasswordPageProps) {
  const params = await searchParams
  const token = typeof params.token === 'string' ? params.token : null
  const returnUrl = sanitizeReturnUrl(params.returnUrl, DEFAULT_AUTH_RETURN_URL)

  return (
    <Section>
      <Container size="narrow">
        <h1>Új jelszó beállítása</h1>
        {/* NN/g, Error-Message Guidelines: „Merely stating the problem is
            also not enough; offer some potential remedies." — ezért áll a
            token-hiba mellett továbblépés. A felirat a §3.2 #37 szótári sora:
            ugyanaz a cselekvés (a visszaállítás KEZDEMÉNYEZÉSE), ugyanaz a
            szó, mint a belépőlapon (WCAG 2.2 · 3.2.4). A korábbi „Új link
            kérése" második alak volt ugyanerre a célra. */}
        {token ? (
          <ResetPasswordForm returnUrl={returnUrl} token={token} />
        ) : (
          <div className="kc-auth-error" role="alert">
            <p>
              Hiányzik a visszaállító token a hivatkozásból, ezért nem tudjuk megnyitni az űrlapot.
              Indítsd újra a visszaállítást, és a friss linkkel próbáld meg ismét.
            </p>
            <Link href={forgotPasswordHref(returnUrl)}>{ctaLabel('password-reset-start')}</Link>
          </div>
        )}
      </Container>
    </Section>
  )
}
