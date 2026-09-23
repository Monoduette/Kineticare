'use client'

import { useAuth, useConfig, useFormFields } from '@payloadcms/ui'
import { useEffect, useState, type JSX } from 'react'

/**
 * Link a kiválasztott szerző adatlapjára, a Szerző mező alatt (modul-térkép
 * H52; Oldalak, Blogbejegyzések).
 *
 * Miért kell: a lap alján álló szerzői doboz neve, végzettsége, bemutatkozása
 * és arcképe nem az oldalon, hanem a Felhasználók között, a munkatárs
 * adatlapján él (src/components/content/post-article.ts authorPersonOf: a
 * `name`, `credentials`, `bioShort`, `portrait` mezők), és a vásárlók
 * tömegében nehéz megtalálni. NN/g, Recognition Rather Than Recall: a
 * felület mutassa meg, hol a szükséges dolog, ne a szerkesztő emlékezzen rá
 * (https://www.nngroup.com/articles/recognition-and-recall/).
 *
 * A név egy REST-kérésből jön (a Users olvasási szabálya `isSelfOrAdmin`, a
 * munkatárs és a tulajdonos minden adatlapot lát). Az írási szabály szűkebb
 * (src/access/users-update.ts canUpdateUser: a tulajdonos mindenkit, a
 * munkatárs csak magát és a vásárlókat): ezért a felirat csak annak mondja,
 * hogy „itt írod át”, aki tényleg át tudja írni. A szabályt nem módosítjuk,
 * a teszt readFileSync-kel köti a sorához.
 *
 * Új lapon nyílik: a szerkesztő automatikus mentése nem kérdez rá a
 * távozásra (@payloadcms/ui dist/views/Edit/index.js: a
 * `preventLeaveWithoutSaving` automatikus mentésnél hamis), így az épp gépelt
 * szöveg a másik lap miatt nem vész el. Az „(új lapon)” jelzés a feliratban áll
 * (WCAG 2.2 G201). Stílus: a B1 `.kc-admin-notice` linksora (24 px-es cél,
 * aláhúzás).
 */

interface SzerzoUser {
  id?: number | string
  role?: string | null
}

/** A relationship-mező értékéből az azonosító (szám, szöveg vagy `{ id }`). */
export function szerzoAzonosito(ertek: unknown): string | null {
  if (typeof ertek === 'number' && Number.isFinite(ertek)) return String(ertek)
  if (typeof ertek === 'string' && ertek.trim().length > 0) return ertek.trim()
  if (typeof ertek === 'object' && ertek !== null && 'id' in ertek) {
    return szerzoAzonosito((ertek as { id?: unknown }).id)
  }
  return null
}

/** Átírhatja-e a bejelentkezett felhasználó a szerző adatlapját (canUpdateUser tükre). */
export function atirhatja(user: SzerzoUser | null | undefined, szerzoId: string): boolean {
  if (!user) return false
  if (user.role === 'owner') return true
  return user.id !== undefined && String(user.id) === szerzoId
}

export interface AdatlapSzoveg {
  /** A link felirata (a célját önmagában is megmondja, WCAG 2.2 SC 2.4.4). */
  link: string
  /** Ha a bejelentkezett felhasználó nem írhatja át: ki tudja. */
  megjegyzes: string | null
}

export function adatlapFelirat(nev: string | null, irhato: boolean): AdatlapSzoveg {
  const kie = nev ? `${nev} adatlapja` : 'a kiválasztott munkatárs adatlapja'
  return irhato
    ? { link: `A szerzői doboz szövegét itt írod át: ${kie} (új lapon)`, megjegyzes: null }
    : {
        link: `A szerzői doboz szövege itt van: ${kie} (új lapon)`,
        megjegyzes: 'Átírni a tulajdonos vagy a szerző maga tudja.',
      }
}

export function adatlapHref(adminRoute: string, id: string): string {
  return `${adminRoute.replace(/\/+$/, '')}/collections/users/${encodeURIComponent(id)}`
}

export interface AuthorProfileLinkViewProps {
  szoveg: AdatlapSzoveg
  href: string
}

export function AuthorProfileLinkView({ szoveg, href }: AuthorProfileLinkViewProps): JSX.Element {
  return (
    <div className="kc-admin-notice kc-szerzo-adatlap">
      <ul className="kc-admin-notice__linkek">
        <li>
          <a href={href} rel="noopener noreferrer" target="_blank">
            {szoveg.link}
          </a>
        </li>
      </ul>
      {szoveg.megjegyzes ? <p className="kc-admin-notice__szoveg">{szoveg.megjegyzes}</p> : null}
    </div>
  )
}

export function AuthorProfileLink(): JSX.Element | null {
  const { config } = useConfig()
  const { user } = useAuth<SzerzoUser>()
  const id = szerzoAzonosito(useFormFields(([fields]) => fields?.author?.value))
  const [nev, setNev] = useState<{ id: string; nev: string | null } | null>(null)

  useEffect(() => {
    if (id === null) return
    let aktiv = true
    const api = `${config.serverURL ?? ''}${config.routes.api}`
    fetch(`${api}/users/${encodeURIComponent(id)}?depth=0&select[name]=true`, {
      credentials: 'include',
    })
      .then((valasz) => (valasz.ok ? valasz.json() : null))
      .then((adat: unknown) => {
        if (!aktiv) return
        const name =
          typeof adat === 'object' && adat !== null ? (adat as { name?: unknown }).name : null
        setNev({ id, nev: typeof name === 'string' && name.trim() ? name.trim() : null })
      })
      .catch(() => {
        if (aktiv) setNev({ id, nev: null })
      })
    return () => {
      aktiv = false
    }
  }, [config.routes.api, config.serverURL, id])

  if (id === null) return null
  const ismertNev = nev !== null && nev.id === id ? nev.nev : null
  return (
    <AuthorProfileLinkView
      szoveg={adatlapFelirat(ismertNev, atirhatja(user, id))}
      href={adatlapHref(config.routes.admin, id)}
    />
  )
}
