/**
 * Hírlevél hozzájárulás szövege — egy forrás (lábléc + admin). Linkelt és sima változat.
 */
export const PRIVACY_POLICY_PATH = '/adatvedelem'

export const NEWSLETTER_CONSENT_TEXT = {
  before:
    'Hozzájárulok, hogy a Kineticare hírlevelet küldjön a megadott e-mail-címemre, és hogy adataimat az ',
  linkLabel: 'Adatkezelési és adatvédelmi szabályzat',
  after: ' szerint kezelje. A hozzájárulás bármikor visszavonható.',
} as const

/** Link nélküli, összefűzött változat (admin-mezőfelirat). */
export const NEWSLETTER_CONSENT_LABEL = `${NEWSLETTER_CONSENT_TEXT.before}${NEWSLETTER_CONSENT_TEXT.linkLabel}${NEWSLETTER_CONSENT_TEXT.after}`
