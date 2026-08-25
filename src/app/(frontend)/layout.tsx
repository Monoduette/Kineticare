import type { Metadata, Viewport } from 'next'
import { Suspense, type ReactNode } from 'react'

import { BarionPixel, BarionPixelNoscript } from '@/components/analytics/BarionPixel'
import { ConsentBanner } from '@/components/analytics/ConsentBanner'
import { GoogleAnalytics } from '@/components/analytics/GoogleAnalytics'
import { PostHogPageView } from '@/components/analytics/PostHogPageView'
import { PostHogProvider } from '@/components/analytics/PostHogProvider'
import { Footer } from '@/components/layout/Footer'
import { Header } from '@/components/layout/Header'
import { AnchorScroll } from '@/components/motion/AnchorScroll'
import { resolveServerUrl } from '@/env'

import './styles.css'

export const dynamic = 'force-dynamic'

const SITE_NAME = 'Kineticare'
const SITE_TAGLINE = 'Kézrehabilitációs online kurzusplatform'
const DEFAULT_DESCRIPTION =
  'Kineticare — kézrehabilitációs online videókurzusok otthoni gyógytornászati programmal. Tanfolyamok, tudástár és szakmai támogatás kézsérülés utáni felépüléshez.'

export const metadata: Metadata = {
  // A publikus gyökér EGY forrásból (src/env.ts) — ugyanebből az env-értékből
  // épül az SEO `SITE_URL`-je és a CORS/CSRF-engedélylista eredete is. A
  // `resolveServerUrl` hibás env esetén sem dob (a boot-assert állítja meg az
  // appot), így ez a `new URL` mindig érvényes bemenetet kap.
  metadataBase: new URL(resolveServerUrl()),
  title: {
    default: `${SITE_NAME} — ${SITE_TAGLINE}`,
    template: `%s | ${SITE_NAME}`,
  },
  description: DEFAULT_DESCRIPTION,
  openGraph: {
    type: 'website',
    locale: 'hu_HU',
    siteName: SITE_NAME,
    title: {
      default: `${SITE_NAME} — ${SITE_TAGLINE}`,
      template: `%s | ${SITE_NAME}`,
    },
    description: DEFAULT_DESCRIPTION,
  },
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

export default function FrontendLayout({ children }: { children: ReactNode }) {
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
          <Header />
          <main id="tartalom">{children}</main>
          <Footer />
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
