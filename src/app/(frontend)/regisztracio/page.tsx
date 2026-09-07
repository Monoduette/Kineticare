import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getPayload } from 'payload'
import { headers } from 'next/headers'

import { Container } from '@/components/ui/Container'
import { Section } from '@/components/ui/Section'
import { RegisterForm } from '@/components/auth/RegisterForm'
import { ctaLabel } from '@/lib/cta-vocabulary'
import { DEFAULT_AUTH_RETURN_URL, sanitizeReturnUrl } from '@/lib/return-url'
import type { User } from '@/payload-types'
import { buildStaticPageMetadata } from '@/lib/seo'

import config from '../../../payload.config'

// INDEXELHETŐ (tulajdonosi döntés, 2026-09-07): a márkás keresés
// („kineticare belépés”) céllapja; canonical, leírás és megosztási kép a közös
// építőből. A sitemapben nem szerepel (vékony tartalom), de nincs tiltva.
export const metadata: Metadata = buildStaticPageMetadata({
  title: 'Regisztráció',
  description:
    'Regisztrálj a Kineticare oldalán: fiókkal éred el a megvett kézrehabilitációs kurzusokat, a rendeléseidet és a számláidat, egy helyen.',
  path: '/regisztracio',
})

interface RegisztracioPageProps {
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
 * /regisztracio — a fiók létrehozásának oldala.
 *
 * A returnUrl-paraméter a belépéssel azonos módon, a közös `sanitizeReturnUrl`
 * szűrővel megy át (open-redirect védelem), EGYSZER, még a redirect-ág előtt —
 * a redirect és a form (`window.location.href`) így ugyanazt az ellenőrzött
 * értéket kapja.
 */
export default async function RegisztracioPage({ searchParams }: RegisztracioPageProps) {
  const params = await searchParams
  const user = await getCurrentUser()
  const returnUrl = sanitizeReturnUrl(params.returnUrl, DEFAULT_AUTH_RETURN_URL)

  if (user !== null) {
    redirect(returnUrl)
  }

  return (
    <Section>
      <Container size="narrow">
        <h1>Regisztráció</h1>
        <p className="kc-auth-lead">
          Hozd létre a fiókodat: a kurzusaid, a rendeléseid és a lejátszásaid egy helyen lesznek.
        </p>
        <RegisterForm returnUrl={returnUrl} />
        {/* §3.2 #5: a belépés felirata MINDENHOL „Belépés" (P-1c, bevett
            egyszavas címke) — a fejlécben, a beküldő gombon és itt is
            (WCAG 2.2 · 3.2.4). A korábbi „Lépj be" negyedik alak volt. */}
        <p className="kc-auth-alt">
          Már van fiókod?{' '}
          <Link href={`/belepes?returnUrl=${encodeURIComponent(returnUrl)}`}>
            {ctaLabel('sign-in')}
          </Link>
        </p>
      </Container>
    </Section>
  )
}
