/**
 * Payload custom admin-nézet keret-szabálya.
 *
 * A 3.88.0 a custom view-path-okat nyilvános admin-route-ként kezeli
 * (`isCustomAdminView`), ezért a Root view auth-átirányítása kimarad. A
 * `DefaultTemplate` user / i18n nélkül 500-at adhat. Be nem jelentkezett
 * látogatónál a keret KIMARAD; bejelentkezett (akár customer) user megkapja
 * az admin-keretet a magyar elutasító szöveg körül.
 */
export function shouldWrapAdminChrome(user: unknown): boolean {
  return user != null && typeof user === 'object'
}
