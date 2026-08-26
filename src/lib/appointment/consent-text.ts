/**
 * Időpontkérés hozzájárulás szövege — egy forrás (űrlap + admin). Nem CMS: jogi
 * nyilatkozat. Linkelt és sima változat; egészségügyi adat nevesítve (GDPR 9. cikk).
 */
export const APPOINTMENT_PRIVACY_POLICY_PATH = '/adatvedelem'

export const APPOINTMENT_CONSENT_TEXT = {
  before:
    'Hozzájárulok, hogy a Kineticare az itt megadott adataimat, beleértve az általam esetlegesen leírt egészségügyi adatokat is, az időpontkérésem intézése céljából kezelje az ',
  linkLabel: 'Adatkezelési és adatvédelmi szabályzat',
  after: ' szerint. A hozzájárulás bármikor visszavonható.',
} as const

/** Link nélküli, összefűzött változat (admin-mezőfelirat). */
export const APPOINTMENT_CONSENT_LABEL = `${APPOINTMENT_CONSENT_TEXT.before}${APPOINTMENT_CONSENT_TEXT.linkLabel}${APPOINTMENT_CONSENT_TEXT.after}`
