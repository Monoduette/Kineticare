'use client'

import dynamic from 'next/dynamic'

/**
 * A Meta Pixel consent-kapuja külön csomagban, a hidratálás UTÁN betöltve
 * (2026-10-16, a mobil halott kattintások javítása).
 *
 * A MetaPixel semmit nem renderel, csak effektekben dolgozik: a szerveren
 * nincs mit kirajzolnia, a hidratálás előtti JS-csomagban pedig fölöslegesen
 * foglal helyet és futási időt. A `ssr: false` a Next.js hivatalos módja egy
 * kliens-komponens leválasztására; Server Componentből nem hívható, ezért él
 * ez a vékony kliens-burkoló.
 * https://nextjs.org/docs/app/guides/lazy-loading#skipping-ssr
 *
 * A layout csak beállított Pixel-azonosítónál rendereli (isMetaPixelConfigured),
 * azonosító nélkül a csomag le sem töltődik.
 */
export const MetaPixelLazy = dynamic(
  () => import('./MetaPixel').then((module) => module.MetaPixel),
  { ssr: false },
)
