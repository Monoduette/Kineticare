import { SzekcioHorgonyIgazito } from './SzekcioHorgonyIgazito'
import {
  ARLISTA_NEM_ISMERHETO,
  ARLISTA_TEENDO,
  SZERKESZTEM_FELIRAT,
  type OldalSzalag,
  type SzalagLink,
  type SzekcioSzalag,
} from './szerkeszto-szalag'

/**
 * A frontend „Szerkesztem” szalagja (modul-térkép A3; H09, H02, H29).
 *
 * SZERVER-KOMPONENS, kliens-JS nélkül: sima `<a>` a szerkesztő pontos sorára.
 * Csak piszkozat-előnézetben renderelődik (a route `draftMode()`-ja dönt, azt
 * pedig csak a staff/owner-kapus `/next/preview` kapcsolja be), így a
 * látogató HTML-jébe és RSC-adatába semmi nem kerül belőle.
 *
 * ELHELYEZÉS. Minden CMS-szekció ELŐTT, a folyamban áll, a tartalmat nem fedi
 * (Sanity: overlays „only when draft mode is active”,
 * https://www.sanity.io/docs/visual-editing/visual-editing-overlays). A
 * rejtett vezérlőt a szerkesztők ritkábban találják meg, mint a láthatót
 * (NN/g, Hamburger Menus and Hidden Navigation Hurt UX Metrics,
 * https://www.nngroup.com/articles/hamburger-menus/), ezért a szalag mindig
 * látszik, nem csak hoverre, ahogy a Drupal kontextuális linkjei.
 *
 * UGYANABBAN A LAPBAN NYÍLIK. NN/g: „For the most part, always open links in
 * the same browser tab or window” (https://www.nngroup.com/articles/new-browser-windows-and-tabs/).
 * A szerkesztő a Vissza gombbal az előnézetre tér vissza. Új lap egy második
 * szerkesztőt nyitna ugyanarra a dokumentumra, a Payload dokumentumzára
 * ugyanannak a felhasználónak nem jelez (a mérés a jelentésben).
 *
 * AKADÁLYMENTESSÉG. A link látható szövege „Szerkesztem”, az akadálymentes
 * neve ezzel KEZDŐDIK (WCAG 2.2 SC 2.5.3: „A best practice is to have the
 * text of the label at the start of the name.”), utána vizuálisan rejtett
 * kontextus nevezi meg a szekciót (SC 2.4.4, C7 technika). A szalag címkéje
 * betűre az admin sorcímkéje (SC 3.2.4). A rejtettséget szöveg mondja ki
 * (SC 1.4.1). A kontraszt, az érintési cél és a fókusz mérése a
 * szerkeszto-reteg.css fejkommentjében.
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

export interface SzerkesztoSzalagProps {
  szalag: SzekcioSzalag
  /**
   * H29: a rendelői árlista felismerése nem sikerült (a RenderBlocks
   * `felismerRendeloiArlista` hívásának null eredménye).
   */
  arlistaNemIsmerheto?: boolean
}

/** Egy CMS-szekció szalagja: sorcímke, „Szerkesztem”, szükség szerint forrás és figyelmeztetés. */
export function SzerkesztoSzalag({ szalag, arlistaNemIsmerheto = false }: SzerkesztoSzalagProps) {
  const osztaly = [
    'kc-szerkeszto-szalag',
    szalag.rejtett ? 'kc-szerkeszto-szalag--rejtett' : null,
    arlistaNemIsmerheto ? 'kc-szerkeszto-szalag--figyelem' : null,
  ]
    .filter((resz): resz is string => resz !== null)
    .join(' ')
  return (
    <div className={osztaly} id={szalag.horgonyId}>
      <div className="kc-container kc-szerkeszto-szalag__belso">
        <p className="kc-szerkeszto-szalag__cimke">{szalag.cimke}</p>
        {szalag.rejtettMagyarazat ? (
          <p className="kc-szerkeszto-szalag__jelzes">
            <strong>{szalag.rejtettMagyarazat.cim}.</strong> {szalag.rejtettMagyarazat.szoveg}{' '}
            {szalag.rejtettMagyarazat.teendo}
          </p>
        ) : null}
        {arlistaNemIsmerheto ? (
          <p className="kc-szerkeszto-szalag__jelzes">
            <strong>{ARLISTA_NEM_ISMERHETO}</strong> {ARLISTA_TEENDO}
          </p>
        ) : null}
        {szalag.forras && !szalag.rejtett ? (
          <p className="kc-szerkeszto-szalag__jelzes">{szalag.forras.cim}.</p>
        ) : null}
        <p className="kc-szerkeszto-szalag__linkek">
          <Link
            link={{
              felirat: SZERKESZTEM_FELIRAT,
              rejtettKontextus: szalag.rejtettKontextus,
              href: szalag.href,
            }}
          />
          {szalag.forras?.link ? (
            <Link
              link={{
                felirat: szalag.forras.link.felirat,
                rejtettKontextus: '',
                href: szalag.forras.link.href,
              }}
              masodlagos
            />
          ) : null}
        </p>
      </div>
    </div>
  )
}

/** A lap tetején álló szalag: a teljes oldal (vagy a hubon a két dokumentum) szerkesztője. */
export function SzerkesztoOldalSzalag({ szalag }: { szalag: OldalSzalag }) {
  return (
    <div className="kc-szerkeszto-szalag kc-szerkeszto-szalag--oldal">
      <SzekcioHorgonyIgazito />
      <div className="kc-container kc-szerkeszto-szalag__belso">
        <p className="kc-szerkeszto-szalag__cimke">{szalag.cimke}</p>
        <p className="kc-szerkeszto-szalag__linkek">
          {szalag.linkek.map((link, index) => (
            <Link key={link.href} link={link} masodlagos={index > 0} />
          ))}
        </p>
      </div>
    </div>
  )
}
