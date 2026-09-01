/**
 * Jelszó-erősségi politika (OWASP A07 — Identification and Authentication
 * Failures).
 *
 * A Payload 3.88.0 auth-rendszere nem kínál natív minimumhossz-/komplexitási
 * beállítást (nincs passwordMinLength), ezért a szabályokat tiszta függvényként
 * itt definiáljuk, és a Users collection beforeChange hookjából érvényesítjük.
 *
 * A függvény szándékosan tiszta: nem függ Payloadtól, adatbázistól vagy
 * környezettől, így egyszerűen, mock nélkül unit-tesztelhető, és a kliensoldali
 * űrlapok is újrahasználhatják ugyanazokat a szabályokat.
 */

/** A jelszó minimális hossza Unicode kódpontban számítva. */
export const PASSWORD_MIN_LENGTH = 12

export interface PasswordPolicyInput {
  /** Az ellenőrizendő nyers jelszó. */
  readonly password: string
  /** A felhasználó e-mail-címe (ha ismert) — a local-part tiltva van a jelszóban. */
  readonly email?: string | null
}

/**
 * A hozzáfűzhető további szabályok helye: a politika bővítéséhez itt érdemes
 * új ellenőrzést felvenni (és a hozzá tartozó magyar hibaüzenetet), a
 * Users-hook és a tesztek ettől változatlanok maradhatnak.
 */
export function validatePasswordStrength({ password, email }: PasswordPolicyInput): string[] {
  const errors: string[] = []

  if ([...password].length < PASSWORD_MIN_LENGTH) {
    errors.push(`A jelszónak legalább ${PASSWORD_MIN_LENGTH} karakter hosszúnak kell lennie.`)
  }
  // Unicode betűosztályokkal ellenőrzünk, hogy az ékezetes magyar jelszavak
  // (pl. "Árvíztűrő...") is megfeleljenek a kis-/nagybetű-szabálynak.
  if (!/\p{Ll}/u.test(password)) {
    errors.push('A jelszónak tartalmaznia kell legalább egy kisbetűt.')
  }
  if (!/\p{Lu}/u.test(password)) {
    errors.push('A jelszónak tartalmaznia kell legalább egy nagybetűt.')
  }
  if (!/\p{Nd}/u.test(password)) {
    errors.push('A jelszónak tartalmaznia kell legalább egy számot.')
  }

  // Az e-mail-cím local-partja (a @ előtti rész) gyakori, könnyen kitalálható
  // jelszó-elem, ezért tiltott. Kevésbé szigorúan: nagybetű-érzéketlenül,
  // és csak értelmes hossz felett (a 1-2 karakteres local-part túl sok
  // ártatlan jelszót tiltana).
  const localPart = typeof email === 'string' ? email.split('@')[0]?.toLowerCase() : undefined
  if (localPart && localPart.length >= 3 && password.toLowerCase().includes(localPart)) {
    errors.push('A jelszó nem tartalmazhatja az e-mail-címedet.')
  }

  return errors
}

/**
 * Segédfüggvény a hookoknak: összefűzi a hibaüzeneteket egyetlen,
 * felhasználónak megjeleníthető magyar szöveggé.
 */
export function formatPasswordPolicyErrors(errors: readonly string[]): string {
  return errors.join(' ')
}
