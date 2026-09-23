'use client'

import { useConfig, useDocumentInfo, useFormFields } from '@payloadcms/ui'
import { useEffect, useState, type JSX } from 'react'

import {
  hubBlogbejegyzesbol,
  hubOldalbol,
  nevelo,
  Nevelo,
  OLDAL_FAJTA_FELIRAT,
} from '../../lib/admin/kotott-cimek'
import type { HubOldal } from '../../lib/tudastar/hub-oldalak'

/**
 * A Tudástár-hub ikerdokumentuma (modul-térkép H05): a 8 hub-Oldal és a
 * párjuk, a blogbejegyzés tetején, mezőnként kimondva, mi honnan jön.
 *
 * A route kódja szerint (src/app/(frontend)/[slug]/page.tsx, csak olvasva):
 * ha a pár blogbejegyzés közzé van téve, a lapon a PostArticle rajzolja a
 * blogbejegyzést (látható cikk, GYIK, a JSON-LD leírása, képe és
 * kulcsszavai: resolveSeoDescription(post), resolveOgImageUrl(post),
 * post.seoKeywords), a metaadat viszont az Oldalé
 * (`buildPageMetadata(page, …)`: <title>, meta description, keywords,
 * og:image). Ha a blogbejegyzés nincs közzétéve (vagy nincs meg), a lap az
 * Oldal saját mezőire esik vissza. A /blog/<webcím> cím csak KÖZZÉTETT
 * hub-Oldalnál irányít át (blog/[slug]/page.tsx hubraIranyit). Az
 * állításokat a hub-oldal-jelzes.test.tsx readFileSync-őre köti a sorokhoz.
 *
 * A hub-Oldal mezői NEM rejtettek: tartalékok, ha a blogbejegyzés nincs
 * közzétéve. A pár állapotát és címét egy REST-kérés adja; amíg nem érkezik
 * meg, a doboz feltételes alakban beszél (igaz marad mindkét esetre).
 *
 * NN/g, Visibility of System Status (https://www.nngroup.com/articles/visibility-system-status/):
 * „systems should always keep users informed about what is going on”. WCAG
 * 2.2 SC 3.2.4 Consistent Identification: a doboz a mezőket a címkéjükön és
 * a „Mi ez” oszlop nevén („Tudástár-cikk tükre”) nevezi. Stílus: a B1
 * `.kc-admin-notice` szerződése; statikus, élő régió nélkül.
 */

export interface ParAdat {
  id: number | string
  cim: string
  kozzeteve: boolean
}

export interface HubSzoveg {
  cim: string
  bekezdesek: string[]
}

/** A hub-Oldal tetején álló doboz. `par`: undefined = még tölt, null = nincs meg. */
export function hubOldalSzoveg(
  hub: HubOldal,
  par: ParAdat | null | undefined,
  oldalKozzeteve: boolean,
): HubSzoveg {
  const blog = `/blog/${hub.cikkSlug}`
  const forras = par
    ? `${Nevelo(par.cim)} „${par.cim}” blogbejegyzésből`
    : `A ${blog} blogbejegyzésből`
  const bekezdesek = [
    `${forras} jön a lapon látható szöveg, a GYIK és a Google strukturált adata.`,
    'Ebből az oldalból jön a közzététel, a böngészőfül címe, a Google-leírás, a kulcsszavak és a megosztási kép.',
  ]
  if (par === null) {
    bekezdesek.push(
      `A ${blog} blogbejegyzés nincs meg a Blogbejegyzések között, ezért a lapon ennek az oldalnak a saját mezői jelennek meg.`,
    )
  } else if (par === undefined) {
    bekezdesek.push(
      'Ha a blogbejegyzés nincs közzétéve, a lapon ennek az oldalnak a saját mezői jelennek meg.',
    )
  } else if (!par.kozzeteve) {
    bekezdesek.push(
      'A blogbejegyzés most nincs közzétéve, ezért a lapon ennek az oldalnak a saját mezői jelennek meg.',
    )
  }
  if (!oldalKozzeteve) {
    bekezdesek.push(
      `Amíg ez az oldal nincs közzétéve, ${nevelo(hub.slug)} /${hub.slug} cím „az oldal nem található” hibát ad, és a blogbejegyzés a ${blog} címen látszik.`,
    )
  }
  return {
    cim: `${OLDAL_FAJTA_FELIRAT.hub}: ${nevelo(hub.slug)} /${hub.slug} lap két dokumentumból áll.`,
    bekezdesek,
  }
}

/** A pár blogbejegyzés tetején álló doboz. `par`: az Oldal adatai. */
export function hubBlogbejegyzesSzoveg(hub: HubOldal, par: ParAdat | null | undefined): HubSzoveg {
  const blog = `/blog/${hub.cikkSlug}`
  const oldal = par
    ? `${nevelo(par.cim)} „${par.cim}” oldal (Oldalak)`
    : `${nevelo(hub.slug)} /${hub.slug} webcímű oldal (Oldalak)`
  const seoMondat = 'az itteni SEO-cím ott nem hat.'
  if (par && par.kozzeteve) {
    return {
      cim: `Ez a blogbejegyzés ${nevelo(hub.slug)} /${hub.slug} címen jelenik meg.`,
      bekezdesek: [
        `A ${blog} cím oda irányít át. Ott a böngészőfül címét és a Google-leírást ${oldal} adja, ${seoMondat}`,
        'Az itteni SEO-leírás, SEO-kulcsszavak és Megosztási kép ott csak a Google strukturált adatába kerül.',
      ],
    }
  }
  if (par === null) {
    return {
      cim: `Ez a blogbejegyzés ${nevelo(hub.slug)} /${hub.slug} Tudástár-oldal forrása.`,
      bekezdesek: [
        `Az Oldalak között nincs /${hub.slug} webcímű oldal, ezért a blogbejegyzés a ${blog} címen látszik.`,
      ],
    }
  }
  return {
    cim: `Ez a blogbejegyzés ${nevelo(hub.slug)} /${hub.slug} Tudástár-oldal forrása.`,
    bekezdesek: [
      par
        ? `Most a ${blog} címen látszik, mert ${oldal} nincs közzétéve.`
        : `Amíg ${oldal} nincs közzétéve, a blogbejegyzés a ${blog} címen látszik.`,
      `Ha azt az oldalt közzéteszik, a blogbejegyzés ${nevelo(hub.slug)} /${hub.slug} címen jelenik meg, és ott a böngészőfül címét és a Google-leírást az az oldal adja; ${seoMondat}`,
    ],
  }
}

export function parLinkFelirat(gyujtemeny: 'pages' | 'posts', par: ParAdat): string {
  return gyujtemeny === 'pages'
    ? `Megnyitom a blogbejegyzést: ${par.cim} (új lapon)`
    : `Megnyitom az oldalt: ${par.cim} (új lapon)`
}

export function parHref(adminRoute: string, parGyujtemeny: string, id: number | string): string {
  return `${adminRoute.replace(/\/+$/, '')}/collections/${parGyujtemeny}/${encodeURIComponent(String(id))}`
}

/** A REST-válasz első dokumentuma ParAdat-ként, vagy null. */
export function parAdatbol(valasz: unknown): ParAdat | null {
  if (typeof valasz !== 'object' || valasz === null) return null
  const docs = (valasz as { docs?: unknown }).docs
  if (!Array.isArray(docs) || docs.length === 0) return null
  const doc: unknown = docs[0]
  if (typeof doc !== 'object' || doc === null) return null
  const { id, title, _status } = doc as { id?: unknown; title?: unknown; _status?: unknown }
  if (typeof id !== 'number' && typeof id !== 'string') return null
  return {
    id,
    cim: typeof title === 'string' && title.trim().length > 0 ? title.trim() : String(id),
    kozzeteve: _status === 'published',
  }
}

export interface HubPageNoticeViewProps {
  szoveg: HubSzoveg
  link: { felirat: string; href: string } | null
}

export function HubPageNoticeView({ szoveg, link }: HubPageNoticeViewProps): JSX.Element {
  return (
    <div className="kc-admin-notice kc-hub-tajekoztato">
      <p className="kc-admin-notice__cim">{szoveg.cim}</p>
      {szoveg.bekezdesek.map((bekezdes) => (
        <p className="kc-admin-notice__szoveg" key={bekezdes}>
          {bekezdes}
        </p>
      ))}
      {link ? (
        <ul className="kc-admin-notice__linkek">
          <li>
            <a href={link.href} rel="noopener noreferrer" target="_blank">
              {link.felirat}
            </a>
          </li>
        </ul>
      ) : null}
    </div>
  )
}

export function HubPageNotice(): JSX.Element | null {
  const { collectionSlug, hasPublishedDoc } = useDocumentInfo()
  const { config } = useConfig()
  const slug = useFormFields(([fields]) => fields?.slug?.value)
  const hub =
    collectionSlug === 'pages'
      ? hubOldalbol(slug)
      : collectionSlug === 'posts'
        ? hubBlogbejegyzesbol(slug)
        : null
  const parGyujtemeny = collectionSlug === 'pages' ? 'posts' : 'pages'
  const parWebcim = hub ? (collectionSlug === 'pages' ? hub.cikkSlug : hub.slug) : null

  const [par, setPar] = useState<{ webcim: string; adat: ParAdat | null } | null>(null)
  useEffect(() => {
    if (parWebcim === null) return
    let aktiv = true
    const api = `${config.serverURL ?? ''}${config.routes.api}`
    const params = new URLSearchParams({
      'where[slug][equals]': parWebcim,
      depth: '0',
      limit: '1',
      'select[title]': 'true',
      'select[_status]': 'true',
    })
    fetch(`${api}/${parGyujtemeny}?${params.toString()}`, { credentials: 'include' })
      .then((valasz) => (valasz.ok ? valasz.json() : null))
      .then((adat: unknown) => {
        if (aktiv) setPar({ webcim: parWebcim, adat: parAdatbol(adat) })
      })
      .catch(() => {
        // Hálózati hiba: a doboz a feltételes (mindkét esetre igaz) alakban marad.
      })
    return () => {
      aktiv = false
    }
  }, [config.routes.api, config.serverURL, parGyujtemeny, parWebcim])

  if (hub === null || (collectionSlug !== 'pages' && collectionSlug !== 'posts')) return null
  const adat = par !== null && par.webcim === parWebcim ? par.adat : undefined
  const szoveg =
    collectionSlug === 'pages'
      ? hubOldalSzoveg(hub, adat, Boolean(hasPublishedDoc))
      : hubBlogbejegyzesSzoveg(hub, adat)
  const link = adat
    ? {
        felirat: parLinkFelirat(collectionSlug, adat),
        href: parHref(config.routes.admin, parGyujtemeny, adat.id),
      }
    : null
  return <HubPageNoticeView link={link} szoveg={szoveg} />
}
