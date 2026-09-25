'use server'

/**
 * A pénztár Turnstile site key-je — SZERVER-AKCIÓ.
 *
 * MIÉRT AKCIÓ ÉS NEM PROP: a `CheckoutForm` kliens-komponens, a site key
 * (`TURNSTILE_SITE_KEY`) pedig futásidejű szerver-env (a többi űrlap is a
 * szerver-oldali szülőtől kapja, lásd NewsletterSignup.tsx). A /penztar lapja
 * ennek a csomagnak a hatókörén kívül esik, ezért a kulcsot a komponens maga
 * kéri el. Ha a lap a jövőben propként adja át (`turnstileSiteKey`), az
 * akció nem fut le.
 *
 * A site key NYILVÁNOS adat (a Cloudflare a böngészőbe szánja, a widget a
 * lapba rajzolja), tehát a kiadása nem szivárogtat titkot; a secret
 * (`TURNSTILE_SECRET_KEY`) ide soha nem kerül.
 */
export async function readCheckoutTurnstileSiteKey(): Promise<string | null> {
  const raw = process.env.TURNSTILE_SITE_KEY
  if (typeof raw !== 'string') {
    return null
  }
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : null
}
