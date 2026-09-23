import type {
  KurzusAkciosSzalag,
  KurzusOldalSzalag,
  KurzusSzakaszSzalag,
} from './kurzus-forras-szalag'
import type { SzalagLink } from './szerkeszto-szalag'

/**
 * A kurzusoldal forrás-szalagjai (modul-térkép H50/A19), a piszkozat-előnézetben.
 *
 * SZERVER-KOMPONENS, kliens-JS nélkül, a SzerkesztoSzalag.tsx mintájára és a
 * meglévő kc-szerkeszto-szalag osztályaival (szerkeszto-reteg.css): ugyanaz a
 * vizuális nyelv, mint a Szekciók szalagjain, így a szerkesztő a kurzusoldalon
 * is ugyanazt a jelet ismeri fel (WCAG 2.2 SC 3.2.4; NN/g, Consistency and
 * Standards, https://www.nngroup.com/articles/consistency-and-standards/). A
 * route csak `isPreview` mellett rendereli, a látogató HTML-jébe és
 * RSC-adatába semmi nem kerül belőle.
 *
 * ELHELYEZÉS. A szakasz-szalag a szakasza ELŐTT áll, a folyamban, a tartalmat
 * nem fedi (Sanity: overlays „only when draft mode is active”,
 * https://www.sanity.io/docs/visual-editing/visual-editing-overlays). A
 * kurzusoldal főhasábjában áll, ezért nincs benne `kc-container`: a szöveg a
 * hasáb szövegével egy vonalban kezdődik. A tartalék tartalmat (a kód
 * beépített szövegét) figyelmeztető felület jelzi, a jelentést a szöveg is
 * kimondja (SC 1.4.1).
 *
 * A linkek ugyanabban a lapban nyílnak (NN/g: „For the most part, always open
 * links in the same browser tab or window”,
 * https://www.nngroup.com/articles/new-browser-windows-and-tabs/).
 */

function Link({ link, masodlagos = false }: { link: SzalagLink; masodlagos?: boolean }) {
  return (
    <a
      className={`kc-szerkeszto-szalag__link${masodlagos ? ' kc-szerkeszto-szalag__link--masodlagos' : ''}`}
      href={link.href}
    >
      {link.felirat}
      {link.rejtettKontextus ? (
        <span className="kc-visually-hidden">{link.rejtettKontextus}</span>
      ) : null}
    </a>
  )
}

/** Egy szakasz forrás-szalagja: a szakasz neve, a forrás mondatban és a mező-mélylink. */
export function KurzusSzakaszForrasSzalag({ szalag }: { szalag: KurzusSzakaszSzalag }) {
  return (
    <div
      className={`kc-szerkeszto-szalag${szalag.tartalek ? ' kc-szerkeszto-szalag--figyelem' : ''}`}
    >
      <div className="kc-szerkeszto-szalag__belso">
        <p className="kc-szerkeszto-szalag__cimke">{szalag.cimke}</p>
        <p className="kc-szerkeszto-szalag__jelzes">{szalag.forrasMondat}</p>
        <p className="kc-szerkeszto-szalag__linkek">
          <Link link={szalag.link} />
          {szalag.masodikLink ? <Link link={szalag.masodikLink} masodlagos /> : null}
        </p>
      </div>
    </div>
  )
}

/** A lap tetején álló szalag: a teljes kurzus szerkesztője és a pipás sorok forrása. */
export function KurzusOldalForrasSzalag({ szalag }: { szalag: KurzusOldalSzalag }) {
  return (
    <div className="kc-szerkeszto-szalag kc-szerkeszto-szalag--oldal">
      <div className="kc-container kc-szerkeszto-szalag__belso">
        <p className="kc-szerkeszto-szalag__cimke">{szalag.cimke}</p>
        <p className="kc-szerkeszto-szalag__jelzes">{szalag.jelzes}</p>
        <p className="kc-szerkeszto-szalag__linkek">
          {szalag.linkek.map((link, index) => (
            <Link key={link.href} link={link} masodlagos={index > 0} />
          ))}
        </p>
      </div>
    </div>
  )
}

/**
 * Az akciós kurzus figyelmeztetése a lap tetején: az előnézet a normál
 * elrendezést mutatja, élesben az akciós jelenik meg (vezetői döntés: az
 * akciós nézet előnézetben nem kapcsol be, a vásárlási ág és a promó-logika
 * változatlan). Figyelmeztető felület, a jelentést a címke szövege is kimondja
 * (SC 1.4.1; GOV.UK Warning text,
 * https://design-system.service.gov.uk/components/warning-text/).
 */
export function KurzusAkciosSzalag({ szalag }: { szalag: KurzusAkciosSzalag }) {
  return (
    <div className="kc-szerkeszto-szalag kc-szerkeszto-szalag--figyelem">
      <div className="kc-container kc-szerkeszto-szalag__belso">
        <p className="kc-szerkeszto-szalag__cimke">{szalag.cimke}</p>
        <p className="kc-szerkeszto-szalag__jelzes">{szalag.szoveg}</p>
        <p className="kc-szerkeszto-szalag__linkek">
          <Link link={szalag.link} />
        </p>
      </div>
    </div>
  )
}
