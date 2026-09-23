import type { Metadata, Viewport } from 'next'
import { draftMode } from 'next/headers'
import { Suspense, type ReactNode } from 'react'

import { BarionPixel, BarionPixelNoscript } from '@/components/analytics/BarionPixel'
import { ConsentBanner } from '@/components/analytics/ConsentBanner'
import { GoogleAnalytics } from '@/components/analytics/GoogleAnalytics'
import { MetaPixel } from '@/components/analytics/MetaPixel'
import { PostHogPageView } from '@/components/analytics/PostHogPageView'
import { PostHogProvider } from '@/components/analytics/PostHogProvider'
import { kapcsolatIdopontSzerkesztoHref } from '@/components/editor/frontend/szerkeszto-szalag'
import { ElonezetKeretSzalag } from '@/components/editor/frontend/SzerkesztoSzalag'
import { FeloldottFooter } from '@/components/layout/Footer'
import { Header } from '@/components/layout/Header'
import { AnchorScroll } from '@/components/motion/AnchorScroll'
import { resolveServerUrl } from '@/env'
import { getPageBySlug } from '@/lib/cms'
import { KAPCSOLAT_OLDAL_WEBCIM } from '@/lib/contact-email'
import { DEFAULT_OG_IMAGE, INDEX_ROBOTS, SITE_DESCRIPTION } from '@/lib/seo'

import './styles.css'

export const dynamic = 'force-dynamic'

const SITE_NAME = 'Kineticare'
const SITE_TAGLINE = 'Kézrehabilitációs online kurzusplatform'
/**
 * A keret alap-leírása EGY forrásból (`src/lib/seo.ts` SITE_DESCRIPTION):
 * mért kulcsszavak, 120–160 karakter, natív magyar, töltelék gondolatjel
 * nélkül. Minden nyilvános lap saját leírást ad (`buildStaticPageMetadata`
 * / `buildDocMetadata`), ez csak a tartalék.
 */
const DEFAULT_DESCRIPTION = SITE_DESCRIPTION

export const metadata: Metadata = {
  // A publikus gyökér EGY forrásból (src/env.ts) — ugyanebből az env-értékből
  // épül az SEO `SITE_URL`-je és a CORS/CSRF-engedélylista eredete is. A
  // `resolveServerUrl` hibás env esetén sem dob (a boot-assert állítja meg az
  // appot), így ez a `new URL` mindig érvényes bemenetet kap.
  metadataBase: new URL(resolveServerUrl()),
  title: {
    default: `${SITE_NAME} | ${SITE_TAGLINE}`,
    template: `%s | ${SITE_NAME}`,
  },
  description: DEFAULT_DESCRIPTION,
  applicationName: SITE_NAME,
  creator: 'Barna Norbert',
  other: { 'creator-url': 'https://www.barnanorbert.com/' },
  // Indexelhető alapállapot; a privát lapok saját `NOINDEX_ROBOTS`-t adnak.
  robots: INDEX_ROBOTS,
  openGraph: {
    type: 'website',
    locale: 'hu_HU',
    siteName: SITE_NAME,
    // SZÁNDÉKOSAN nincs `%s | Kineticare` sablon az og:title-ön: a márkát az
    // og:site_name viszi (ogp.me), a sablon a CMS-címekben már benne lévő
    // márkanevet duplázta (mérve 2026-09-07).
    title: `${SITE_NAME} | ${SITE_TAGLINE}`,
    description: DEFAULT_DESCRIPTION,
    url: resolveServerUrl(),
    images: [DEFAULT_OG_IMAGE],
  },
  twitter: {
    card: 'summary_large_image',
    title: `${SITE_NAME} | ${SITE_TAGLINE}`,
    description: DEFAULT_DESCRIPTION,
    images: [{ url: DEFAULT_OG_IMAGE.url, alt: DEFAULT_OG_IMAGE.alt }],
  },
  formatDetection: { telephone: false },
  // Search Console domain-ellenőrző meta. Üres env = nincs címke (a DNS
  // átállás után kell, ha a régi Systeme.io-s ellenőrzés nem viszi át a
  // tulajdont). A token nyilvános, nem titok; értéket ide SOSEM írunk.
  verification: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION
    ? { google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION }
    : undefined,
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // A mobil böngésző-króm a fejléc-sáv színét viseli. Ez a `--kc-color-bg`
  // (landing „paper") értéke — CSS-változó itt nem használható, ezért a
  // tokens.css-szel EGYÜTT kell mozgatni. A korábbi navy (#0b243f) a régi,
  // sötét fejléc/lábléc maradványa volt.
  themeColor: '#f6f9fc',
}

/**
 * A lábléc-szalag e-mail-linkjének célja (modul-térkép H18): a Kapcsolat oldal
 * LEGÚJABB piszkozatának első látható Időpontkérés szekciója. CSAK
 * piszkozat-előnézetben fut (a hívó dönt), a látogató kérésében lekérdezés
 * nincs. A `getPageBySlug` hibatűrő (hibánál null), ilyenkor a szalag az
 * Oldalak listájára visz.
 */
async function lablecKapcsolatHref(): Promise<string | undefined> {
  const lap = await getPageBySlug(KAPCSOLAT_OLDAL_WEBCIM, { draft: true })
  return kapcsolatIdopontSzerkesztoHref({ lap })
}

export default async function FrontendLayout({ children }: { children: ReactNode }) {
  // Piszkozat-előnézet: a sütit CSAK a staff/owner-kapus /next/preview adja.
  // Ilyenkor a fejléc és a lábléc ELŐTT „Kódban van” szalag áll (H35, H18), a
  // szekció-szalagok helyén és nyelvén: a modulja előtt, a folyamban, a
  // tartalmat nem fedve (Sanity overlays: „only when draft mode is active”,
  // https://www.sanity.io/docs/visual-editing/visual-editing-overlays; NN/g,
  // Visibility of System Status,
  // https://www.nngroup.com/articles/visibility-system-status/). A fejléc-
  // szalag a ragadós fejléc FÖLÖTT áll, mint a publikált nézet
  // szerkesztő-belépője (SzerkesztoNezetBelepo): így nem ragad, nem takar
  // (WCAG 2.2 SC 2.4.11), és a fejléc mért szélesség-tartalékát sem fogyasztja.
  // NEM piszkozatban a JSX PONTOSAN a korábbi (`<Header />`, lábléc), üres
  // hely nélkül, így a látogató HTML-je és RSC-adata nem változik.
  const { isEnabled: isDraft } = await draftMode()
  const kapcsolatIdopontHref = isDraft ? await lablecKapcsolatHref() : undefined
  // A lábléc a kapcsolati e-mail feloldójával (H18): a cím a /kapcsolat első
  // látható Időpontkérés szekciójából jön, hiba esetén a kódtartalék
  // (src/lib/contact-email-server.ts). Mai adatokkal a kimenet bájtra a régi.
  const lablec = <FeloldottFooter />
  return (
    <html lang="hu">
      <head>
        {/* ALAP Barion Pixel — a `<head>` LEGELSŐ eleme, ahogy a hivatalos
            dokumentáció kéri. NEM marketing-eszköz: a Barion Smart Gateway
            használatának feltétele, és csalásmegelőzési célból SÜTI-
            HOZZÁJÁRULÁSTÓL FÜGGETLENÜL be kell töltődnie („the Base Barion
            Pixel should be loaded irrespective of other marketing consent
            management software”). Ezért NEM kerülhet consent-kapu mögé és nem
            kerülhet a PostHogProvider alá sem. A hozzájárulás a Pixel
            FELHASZNÁLÁSÁT szabályozza, `bp('consent', …)` hívásokkal. */}
        <BarionPixel />
        {/* Kritikus betű-metszetek előtöltése (terv 3.2). Csak a LATIN vágatok:
            ezeket minden oldal használja, így nincs kihasználatlan preload. A
            latin-ext (ő, ű) fájlokat a böngésző akkor kéri le, amikor a lapon
            tényleg előfordul ilyen karakter — lásd styles/fonts.css. */}
        <link
          as="font"
          crossOrigin="anonymous"
          href="/fonts/tenor-sans-400-latin.woff2"
          rel="preload"
          type="font/woff2"
        />
        <link
          as="font"
          crossOrigin="anonymous"
          href="/fonts/nunito-sans-var-latin.woff2"
          rel="preload"
          type="font/woff2"
        />
      </head>
      <body>
        <a className="kc-skip-link" href="#tartalom">
          Ugrás a tartalomra
        </a>
        {/* Horgony-mozgás: az egy képernyőnél hosszabb ugrás azonnali, nem
            animált (mérés és források a komponens fejlécében). A lapon
            semmi mást nem érint, és JS nélkül a mai viselkedés marad. */}
        <AnchorScroll />
        <PostHogProvider>
          {/* A useSearchParams miatt Suspense-határ kell (Next build-szabály). */}
          <Suspense fallback={null}>
            <PostHogPageView />
          </Suspense>
          {/* GA4 consent-kapu: mérési azonosító nélkül és hozzájárulás előtt no-op. */}
          <GoogleAnalytics />
          {/* Meta Pixel consent-kapu: azonosító nélkül és hozzájárulás előtt no-op.
              A useSearchParams miatt Suspense-határ kell (Next build-szabály). */}
          <Suspense fallback={null}>
            <MetaPixel />
          </Suspense>
          {isDraft ? (
            <>
              <ElonezetKeretSzalag elonezet hely="fejlec" />
              <Header />
            </>
          ) : (
            <Header />
          )}
          <main id="tartalom">{children}</main>
          {isDraft ? (
            <>
              <ElonezetKeretSzalag
                elonezet
                hely="lablec"
                {...(kapcsolatIdopontHref ? { kapcsolatIdopontHref } : {})}
              />
              {lablec}
            </>
          ) : (
            lablec
          )}
          {/* GDPR consent-sáv: csak 'unknown' állapotban látszik, a body végén, a többi elem fölött. */}
          <ConsentBanner />
        </PostHogProvider>
        {/* A Barion Pixel JS nélküli tartalék-képpontja. A `<head>`-be nem
            tehető (ott a <noscript> csak link/style/meta elemet vehet fel), a
            lap elejére pedig azért nem, hogy JS nélkül se előzze meg az
            „Ugrás a tartalomra” ugrólinket. */}
        <BarionPixelNoscript />
      </body>
    </html>
  )
}
