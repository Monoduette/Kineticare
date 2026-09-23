import config from '@payload-config'
import { handleServerFunctions, RootLayout } from '@payloadcms/next/layouts'
import type { ServerFunctionClient } from 'payload'
import type { ReactNode } from 'react'

import '@payloadcms/next/css'
/* Admin stíluslap a Payload css UTÁN importálva (a Payload 3 dokumentált
   custom-CSS mintája: https://payloadcms.com/docs/admin/customizing-css).
   Két rétege van: (1) a Statisztika nézet márka-rétege a .kc-adminstat
   scope alatt; (2) a fájl végén az EGÉSZ adminra ható téma-réteg
   (AA-kontraszt, mezőhatár, fókusz, célméret, reflow világos és sötét
   témában, valamint a saját komponensek .kc-admin-input és
   .kc-admin-notice stílusszerződése). A téma-réteg rétegen kívül áll,
   ezért a Payload @layer payload-default szabályait specifikusságtól
   függetlenül felülírja. Az indoklás és a mért arányok a szakaszok
   fejkommentjében; őr: src/__tests__/admin-tema-kontraszt.test.ts. */
import './custom.scss'

import { importMap } from './admin/importMap'

type Args = {
  children: ReactNode
}

const serverFunction: ServerFunctionClient = async function (args) {
  'use server'
  return handleServerFunctions({
    ...args,
    config,
    importMap,
  })
}

const Layout = ({ children }: Args) => (
  <RootLayout config={config} importMap={importMap} serverFunction={serverFunction}>
    {children}
  </RootLayout>
)

export default Layout
