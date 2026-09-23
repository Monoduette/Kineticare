import type { Block } from 'payload'

import { KEP_CSERE_SUGO } from './kep-csere'
import { linkGroup } from './link-fields'
import { sectionSettings } from './section-settings'

/**
 * Gombos kiemelő sáv (slug: ctaBanner, korábbi neve „CTA-sáv”): figyelemfelhívó
 * sáv egyetlen gombbal (terv 2. blokk-katalógus).
 *
 * Bárhová beszúrható „lezárás": egy mondat és egy gomb. Óvatosan használd —
 * több CTA-sáv egy oldalon gyengíti egymást (értékesítési UX-skill: egy oldalon
 * EGY elsődleges cselekvés legyen hangsúlyos).
 */
export const ctaBanner: Block = {
  slug: 'ctaBanner',
  interfaceName: 'BlockCtaBanner',
  labels: {
    singular: 'Gombos kiemelő sáv',
    plural: 'Gombos kiemelő sávok',
  },
  admin: {
    group: 'Bárhol használható',
  },
  fields: [
    {
      name: 'title',
      type: 'text',
      required: true,
      label: 'Cím',
      admin: {
        description: 'Egy rövid, cselekvésre hívó mondat.',
      },
    },
    {
      name: 'text',
      type: 'textarea',
      label: 'Szöveg',
      admin: {
        description: 'Nem kötelező. Egy-két mondat a cím alá.',
      },
    },
    {
      // H28: a feltöltött kép megelőzi a számított képet (a kurzus borítója,
      // a /rolunk-on a montázs), lásd src/lib/cta-banner-course.ts
      // `ctaBannerFigura` és `resolveCtaBannerFigure`. A súgó ugyanazt a
      // sorrendet mondja, amit a kód csinál (NN/g, 10 Usability Heuristics,
      // #1 Visibility of system status:
      // https://www.nngroup.com/articles/ten-usability-heuristics/; GOV.UK
      // Design System, Text input, hint text:
      // https://design-system.service.gov.uk/components/text-input/).
      name: 'kep',
      type: 'upload',
      relationTo: 'media',
      label: 'Kép',
      admin: {
        description: `Nem kötelező. Ha feltöltesz képet, ez látszik a sávban. Ha üresen hagyod és a gomb egy kurzusra vagy a kurzuslistára visz, a kurzus borítója látszik (a Rólunk oldalon a kurzus-montázs); más gombcélnál a sáv kép nélkül jelenik meg. ${KEP_CSERE_SUGO}`,
      },
    },
    linkGroup({
      name: 'cta',
      label: 'Gomb',
      description: 'A sáv gombja. Felirat és cím nélkül a sáv gomb nélkül jelenik meg.',
    }),
    sectionSettings({ defaultBackground: 'tint' }),
  ],
}
