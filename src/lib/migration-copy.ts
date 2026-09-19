/**
 * Az átállási levél és a két belépési céllap közös, állapotfüggetlen szövege.
 * Nem következtet hozzáférésre a címzettlistából, és nem érvényteleníti
 * szóban a már aktivált fiók jelszavát.
 * GOV.UK: világos következő lépés és személyre szóló üzenet;
 * https://www.gov.uk/service-manual/design/sending-emails-and-text-messages
 * NN/g: pontos, segítő hibamagyarázat;
 * https://www.nngroup.com/articles/error-message-guidelines/
 */
export const MIGRATION_ACCOUNT_GUIDANCE =
  'Ha még nem állítottál be jelszót az új felületen, kérj hozzá linket ugyanazzal az e-mail-címmel, amellyel korábban vásároltál vagy az ingyenes kurzusra regisztráltál.'

export const MIGRATION_EXISTING_PASSWORD_NOTE =
  'Ha az új felületen már beállítottál jelszót, azzal továbbra is beléphetsz.'

export const MIGRATION_COURSES_NOTE =
  'A fiókodhoz tartozó kurzusokat belépés után a Kurzusaim oldalon találod.'

export const MIGRATION_MISSING_COURSE_NOTE =
  'Ha valamelyik korábbi kurzusod hiányzik, ne vásárold meg újra, hanem írj nekünk.'
