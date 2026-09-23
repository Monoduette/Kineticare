import { karakterHossz } from '../components/admin/KarakterSzamlaloLogika'

/**
 * A kezdőlapi nyitó videó (filmHero blokk) két beúszó feliratának EGYETLEN
 * forrása: a beépített szövegek, a hosszkorlátok, a validátorok és a
 * megjelenítés feloldója.
 *
 * A tulajdonos kérése (2026-09-22): „kell CMS-ben belül a videón lévő
 * szövegek cseréjére is menüpont és lehetőség”. A szövegek ezért a blokk
 * `captions` csoportjának mezői (src/blocks/film-hero.ts). Ha egy mező üres,
 * NULL vagy csak szóköz, a lenti beépített szöveg jelenik meg, így a
 * kezdőlap sosem marad felirat nélkül, és az új oszlopok bevezetése után
 * (minden érték NULL) a lap betűre ugyanaz, mint előtte.
 *
 * MIÉRT 60 ÉS 120 (mérések: 2026-09-22 és 2026-09-23, Chromium, a valódi
 * scroll-scrub.css és film-hero.css szabályaival és webfontokkal; a sorokat
 * a felirat sordobozai adják, Range.getClientRects):
 * - Az R1 kutatás töltelékszöveges mérésében 320×568-on a cím 64, a leírás
 *   124 karakterig fért el két, illetve három sorban.
 * - Természetes, szóhatáron vágott magyar korpuszon (4200 minta) viszont a
 *   60 karakteres címek 2,17%-a háromsoros, a 120 karakteres leírások
 *   6,74%-a négysoros. Ilyenkor a felirat teteje legfeljebb kb. 250 px-re
 *   kerül a vászon aljától, a film-hero.css 14rem-es (224 px) fátyolhatára
 *   fölé.
 * - Ez nem kontraszthiba. A mobil klip
 *   (public/media/film/one-hand-header-v1-mobile.mp4) 49 kockáján mérve
 *   (minden 3. kocka a poszter helyén, soronként a legsötétebb 4×4 px-es
 *   blokk a szövegszín ellen) a legrosszabb, 3+4 soros esetben is legalább
 *   7,63:1 az arány 320×568-on, 390×844-en legalább 12,11:1. Az AA-küszöb
 *   4,5:1 (WCAG 2.2 SC 1.4.3), a 14rem tehát óvatos helyettesítő mérce.
 * - A leírás korlátja nem mehet 120 alá, mert a jóváhagyott beépített
 *   vég-leírás (endBody) 120 karakteres.
 * A mezőleírások a sorok számáról (src/blocks/film-hero.ts) a célt vagy a
 * jellemző esetet mondják, nem garanciát: a cím leírása céltagmondat („hogy
 * telefonon is elférjen két sorban”), a leírásé „általában elfér három
 * sorban”, mert a 120 karakteres leírás 320×568-on a minták 6,74%-ában
 * négysoros.
 * A validátor-üzenetben NINCS indoklás, csak a baj és a teendő (GOV.UK Design
 * System, Error message: „explain what went wrong and how to fix it”,
 * https://design-system.service.gov.uk/components/error-message/). A korábbi
 * „Rövidítsd, hogy telefonon is két/három sorban elférjen” a mérés ellen
 * állított: az üzenet épp a korlát FÖLÖTTI szövegnél jelenik meg, és az ilyen
 * szöveg többnyire elfér. Mérve 2026-09-23, ugyanazzal a harnesszel, pontos
 * hosszsávokkal (sávonként kb. 3000 minta): a 61–64 karakteres címek
 * 390×844-en 100%-a, 320×568-on 87,12%-a fér el két sorban; a 121–124
 * karakteres leírások 390×844-en 99,97%-a, 320×568-on 75,97%-a három
 * sorban. A teendő ezért a pontos rövidítés („Rövidítsd legalább 12
 * karakterrel”), ugyanazzal a számmal, amelyet az élő számláló mutat.
 *
 * A piszkozat mentése nem validál (Payload versions.drafts), ezért a korlát a
 * mezők leírásában is szerepel, és élő számláló mutatja
 * (src/components/admin/KarakterSzamlalo.tsx).
 */

/** A felirat címének felső korlátja karakterben (lásd a fenti mérést). */
export const FILM_CAPTION_TITLE_MAX = 60

/** A felirat leírásának felső korlátja karakterben (lásd a fenti mérést). */
export const FILM_CAPTION_BODY_MAX = 120

/**
 * A beépített szövegek, betűre a 2026-09-22 előtti kódbeli konstansokkal.
 *
 * A 2. és 3. állás a logó és a terápia ívét követi (zárt, nyíló, nyitott):
 * a közép a gyakorlás folyamatát írja le, a vég a döntést a látogatóra bízza.
 * Egészségügyi kontextus miatt egyik sem ígér gyógyulást. A tulajdonos
 * 2026-08-17-i kérése: a cím alatt mindig álljon leírás is.
 */
export const FILM_CAPTION_DEFAULTS = {
  midTitle: 'Minden alkalommal egy mozdulattal több',
  midBody:
    'Napi néhány perc otthon, a saját tempódban. A gyakorlatok lépésről lépésre épülnek egymásra, ahogy a kéz bírja.',
  endTitle: 'A következő mozdulat a tiéd',
  endBody:
    'Lentebb megtalálod a kurzusokat és a rendelői kezeléseket. Ha előbb kipróbálnád, ott vannak az ingyenes SOS gyakorlatok.',
  endBodyWithoutFreeSos:
    'Ismerd meg a kurzusainkat és a rendelői kezeléseinket. Válaszd ki a neked megfelelő segítséget.',
} as const

export type FilmCaptionField = keyof typeof FILM_CAPTION_DEFAULTS

/** A mezők sorrendje (admin, előtöltő, tesztek). */
export const FILM_CAPTION_FIELDS: readonly FilmCaptionField[] = [
  'midTitle',
  'midBody',
  'endTitle',
  'endBody',
  'endBodyWithoutFreeSos',
]

/** Melyik mező cím és melyik leírás: ebből jön a korlát és az üzenet. */
export const FILM_CAPTION_KIND: Readonly<Record<FilmCaptionField, 'cim' | 'leiras'>> = {
  midTitle: 'cim',
  midBody: 'leiras',
  endTitle: 'cim',
  endBody: 'leiras',
  endBodyWithoutFreeSos: 'leiras',
}

/** A mezőhöz tartozó korlát. */
export function filmCaptionMax(field: FilmCaptionField): number {
  return FILM_CAPTION_KIND[field] === 'cim' ? FILM_CAPTION_TITLE_MAX : FILM_CAPTION_BODY_MAX
}

/**
 * A hossz a korlát szempontjából: trim után, NFC-normalizálva, kódpontonként.
 * Ugyanaz a függvény, amivel az admin számlálója számol (indoklás:
 * src/components/admin/KarakterSzamlaloLogika.ts).
 */
export const filmCaptionLength = karakterHossz

/**
 * A túl hosszú felirat üzenete: ELÖL a teendő (mennyivel rövidítsen), utána a
 * két szám, indoklás nélkül (lásd a fejkommentet). NN/g, Error-Message
 * Guidelines: „Concisely and precisely describe the issue.”
 * (https://www.nngroup.com/articles/error-message-guidelines/); GOV.UK Design
 * System, Error message: „explain what went wrong and how to fix it”
 * (https://design-system.service.gov.uk/components/error-message/).
 * A rövidítés száma a számláló „N karakterrel hosszabb a megengedettnél”
 * számával azonos (ugyanaz a hosszfüggvény). A mező neve nincs benne, mert
 * az üzenet a mezőnél jelenik meg.
 * A Payload mezőhibája egysoros buborék, amely a mező szélességének 75%-áig
 * nő, utána levágja a szöveget (@payloadcms/ui Tooltip). A teendő ezért elöl
 * áll, és az üzenet legfeljebb 75 karakter (az A vezető 2026-09-23-i mércéje
 * az űrlapok mezőhibáira, itt is alkalmazva): 63–69 karakter, négyjegyű
 * hossznál is.
 */
function tulHosszuUzenet(max: number, hossz: number): string {
  return `Rövidítsd legalább ${hossz - max} karakterrel: most ${hossz}, legfeljebb ${max} lehet.`
}

/**
 * A cím validátora. Üres érték rendben van: ott a beépített szöveg látszik.
 */
export function validateFilmCaptionTitle(value: unknown): string | true {
  const hossz = filmCaptionLength(value)
  if (hossz > FILM_CAPTION_TITLE_MAX) {
    return tulHosszuUzenet(FILM_CAPTION_TITLE_MAX, hossz)
  }
  return true
}

/** A leírás validátora, ugyanazzal a szerkezettel, mint a címé. */
export function validateFilmCaptionBody(value: unknown): string | true {
  const hossz = filmCaptionLength(value)
  if (hossz > FILM_CAPTION_BODY_MAX) {
    return tulHosszuUzenet(FILM_CAPTION_BODY_MAX, hossz)
  }
  return true
}

/** A blokk `captions` csoportjának alakja (a generált típussal kompatibilis). */
export type FilmCaptionsInput = Partial<Record<FilmCaptionField, string | null | undefined>>

export interface FilmCaptionText {
  title: string
  body: string
}

export interface ResolvedFilmCaptions {
  mid: FilmCaptionText
  end: FilmCaptionText
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/**
 * Egy mező szövege a `captions` csoportból: a CMS-érték levágva, vagy a
 * beépített szöveg, ha az érték üres, NULL, csak szóköz vagy nem szöveg.
 */
export function filmCaptionText(captions: unknown, field: FilmCaptionField): string {
  const value = asRecord(captions)[field]
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed.length > 0 ? trimmed : FILM_CAPTION_DEFAULTS[field]
}

/**
 * A két felirat szövege egy filmHero blokkból.
 *
 * A vég-leírás két változatából az választ, hogy van-e a lapon ingyenes SOS
 * cél (a FilmHero `freeSosHref` propja): csak akkor hivatkozhat a szöveg az
 * ingyenes gyakorlatokra, ha azok tényleg kint vannak (NN/g, Better Link
 * Labels; WCAG 2.2 SC 2.4.4). A szabály a CMS-értékre és a beépített
 * szövegre egyformán áll.
 */
export function resolveFilmCaptions(
  block: unknown,
  hasFreeSosTarget: boolean,
): ResolvedFilmCaptions {
  const captions = asRecord(block).captions
  return {
    mid: {
      title: filmCaptionText(captions, 'midTitle'),
      body: filmCaptionText(captions, 'midBody'),
    },
    end: {
      title: filmCaptionText(captions, 'endTitle'),
      body: filmCaptionText(captions, hasFreeSosTarget ? 'endBody' : 'endBodyWithoutFreeSos'),
    },
  }
}
