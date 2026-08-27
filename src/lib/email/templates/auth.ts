import { ctaLabel } from '../../cta-vocabulary'
import type { EmailTemplate } from '../types'
import { escapeHtml, renderLayout } from './layout'

/** Welcome (regisztráció) sablon. */
export function welcomeEmail(input: { name: string; loginUrl: string }): EmailTemplate {
  const name = input.name.trim() || 'Felhasználó'
  return {
    subject: 'Üdvözöl a Kineticare!',
    ...renderLayout({
      heading: 'Sikeres regisztráció',
      paragraphsHtml: [
        `Kedves ${escapeHtml(name)}!`,
        'Köszönjük a regisztrációt a Kineticare oldalán. A fiókod elkészült, a kurzusokat belépés után éred el.',
      ],
      paragraphsText: [
        `Kedves ${name}!`,
        'Köszönjük a regisztrációt a Kineticare oldalán. A fiókod elkészült, a kurzusokat belépés után éred el.',
      ],
      cta: { label: ctaLabel('sign-in'), url: input.loginUrl },
    }),
  }
}

/** Reset (elfelejtett jelszó) sablon. */
export function resetPasswordEmail(input: {
  name?: string | null
  resetUrl: string
}): EmailTemplate {
  const greeting = input.name?.trim() ? `Kedves ${input.name.trim()}!` : 'Szia!'
  return {
    subject: 'Jelszó visszaállítása',
    ...renderLayout({
      heading: 'Jelszó visszaállítása',
      paragraphsHtml: [
        escapeHtml(greeting),
        'Jelszó-visszaállítást kértél a fiókodhoz. Az alábbi gombbal állíthatsz be új jelszót. A jelszó után a kurzusaid megnyílnak, külön belépés nem kell. A link korlátozott ideig érvényes.',
        'Ha nem te kérted a visszaállítást, hagyd figyelmen kívül ezt a levelet. A jelszavad nem változik.',
      ],
      paragraphsText: [
        greeting,
        'Jelszó-visszaállítást kértél a fiókodhoz. Az alábbi linken állíthatsz be új jelszót. A jelszó után a kurzusaid megnyílnak, külön belépés nem kell. A link korlátozott ideig érvényes.',
        'Ha nem te kérted a visszaállítást, hagyd figyelmen kívül ezt a levelet. A jelszavad nem változik.',
      ],
      cta: { label: ctaLabel('password-reset-set'), url: input.resetUrl },
    }),
  }
}

/** Verify (e-mail-cím megerősítése) sablon. */
export function verifyEmail(input: { name?: string | null; verifyUrl: string }): EmailTemplate {
  const greeting = input.name?.trim() ? `Kedves ${input.name.trim()}!` : 'Szia!'
  return {
    subject: 'Erősítsd meg az e-mail-címed',
    ...renderLayout({
      heading: 'E-mail-cím megerősítése',
      paragraphsHtml: [
        escapeHtml(greeting),
        'A fiókod használatához erősítsd meg az e-mail-címed az alábbi gombbal.',
        'Ha nem te regisztráltál, hagyd figyelmen kívül ezt a levelet.',
      ],
      paragraphsText: [
        greeting,
        'A fiókod használatához erősítsd meg az e-mail-címed az alábbi linken.',
        'Ha nem te regisztráltál, hagyd figyelmen kívül ezt a levelet.',
      ],
      cta: { label: 'E-mail-cím megerősítése', url: input.verifyUrl },
    }),
  }
}

/** Contact-staff (kapcsolat-értesítő a stábnak) sablon. */
export function contactStaffEmail(input: {
  name: string
  email: string
  message: string
  submittedAt: string
}): EmailTemplate {
  return {
    subject: `Új kapcsolatfelvétel: ${input.name}`,
    ...renderLayout({
      heading: 'Új üzenet érkezett a kapcsolat űrlapról',
      paragraphsHtml: [
        `<strong>Név:</strong> ${escapeHtml(input.name)}`,
        `<strong>E-mail:</strong> ${escapeHtml(input.email)}`,
        `<strong>Beküldve:</strong> ${escapeHtml(input.submittedAt)}`,
        `<strong>Üzenet:</strong><br />${escapeHtml(input.message).replace(/\n/g, '<br />')}`,
      ],
      paragraphsText: [
        `Név: ${input.name}`,
        `E-mail: ${input.email}`,
        `Beküldve: ${input.submittedAt}`,
        '',
        'Üzenet:',
        input.message,
      ],
    }),
  }
}
