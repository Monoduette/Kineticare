import {
  BRAND_LOGO_ALT,
  BRAND_LOGO_HORIZONTAL_TAGLINE,
  BRAND_LOGO_HORIZONTAL_TAGLINE_WHITE,
} from '../../lib/brand-logo'

/**
 * A Payload saját logója helyett a Kineticare-é az admin belépő oldalán
 * (és a jelszó-visszaállító, első-felhasználó nézeteken), amelyeket a
 * Payload a `graphics.Logo` komponenssel rajzol
 * (@payloadcms/next/dist/elements/Logo).
 *
 * A Payload admin világos és sötét témát is ismer (`<html data-theme>`),
 * ezért két kép készül: a színes a világos, a fehér a sötét háttérre. A
 * custom.scss mindig csak az aktuális témáét mutatja; a `display: none`
 * kép a kisegítő technológiák elől is rejtve marad, így egy név hangzik el.
 * A logók a `public/assets/brand/` alatt változtatás nélkül szolgált
 * SVG-k (src/lib/brand-logo.ts).
 */
export function KineticareLogo() {
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- SVG-logó bitre azonosan, next/image nélkül (src/lib/brand-logo.ts) */}
      <img
        alt={BRAND_LOGO_ALT}
        className="kc-admin-logo kc-admin-logo--vilagos"
        height={BRAND_LOGO_HORIZONTAL_TAGLINE.height}
        src={BRAND_LOGO_HORIZONTAL_TAGLINE.src}
        width={BRAND_LOGO_HORIZONTAL_TAGLINE.width}
      />
      {/* eslint-disable-next-line @next/next/no-img-element -- lásd fent */}
      <img
        alt={BRAND_LOGO_ALT}
        className="kc-admin-logo kc-admin-logo--sotet"
        height={BRAND_LOGO_HORIZONTAL_TAGLINE_WHITE.height}
        src={BRAND_LOGO_HORIZONTAL_TAGLINE_WHITE.src}
        width={BRAND_LOGO_HORIZONTAL_TAGLINE_WHITE.width}
      />
    </>
  )
}

/**
 * A Payload ikonja helyett a Kineticare-é a fejléc kezdő-linkjében
 * (`graphics.Icon`, @payloadcms/ui StepNav, 18×18 px-es doboz). Ugyanaz a
 * kép, mint a böngészőfül ikonja (src/app/icon.svg, saját fehér mezővel, így
 * mindkét témán látszik).
 *
 * Az `alt` üres: a link az Irányítópultra visz, és a hozzáférhető nevét a
 * Payload a köré tett `title="Irányítópult"`-ból adja. A „Kineticare” alt
 * ezt felülírná, és a link mást mondana, mint ahova visz (WCAG 2.2 SC 2.4.4).
 */
export function KineticareIcon() {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- SVG-ikon bitre azonosan, next/image nélkül
    <img alt="" className="kc-admin-ikon" height={32} src="/icon.svg" width={32} />
  )
}
