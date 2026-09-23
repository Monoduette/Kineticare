'use client'

import { Button, useFormFields } from '@payloadcms/ui'
import { reduceFieldsToValues } from 'payload/shared'
import type { CSSProperties } from 'react'

import type { Product } from '../../payload-types'
import { courseEditorialChecklist } from './course-editorial-checklist'

/**
 * A kurzusszerkesztő „Kurzus áttekintése” doboza (UI-mező, nem tárol adatot).
 *
 * K42 (admin-audit, 2026-09-22):
 * - Az állapotjel (✓ / !) mellett mindig ott a szöveg („Rendben”,
 *   „Ellenőrizendő”): a jel díszítés, a jelentést a szöveg hordozza (WCAG 2.2
 *   SC 1.4.1; GOV.UK Warning text: ikon aria-hidden, szöveges jelentés,
 *   https://design-system.service.gov.uk/components/warning-text/).
 * - Az „Árazás” sor az akció állapotát is mutatja, és egy gombbal az „Ár és
 *   hozzáférés” fülre visz, ahol javítható (NN/g, Visibility of System Status:
 *   https://www.nngroup.com/articles/visibility-system-status/). A Payload
 *   fülei nem URL-címezhetők (@payloadcms/ui Tabs: sima <button>), ezért ez
 *   gomb, és a fül saját gombját nyomja meg, majd oda viszi a fókuszt.
 */

const statusStyle: CSSProperties = { display: 'block', fontWeight: 600 }

/** A fül gombja a feliratáról (a hibaszámláló-jelvény a felirat után állhat). */
export function findEditorTabButton(root: ParentNode, label: string): HTMLButtonElement | null {
  const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('.tabs-field__tab-button'))
  return buttons.find((button) => button.textContent?.trim().startsWith(label)) ?? null
}

function openEditorTab(label: string): void {
  const button = findEditorTabButton(document, label)
  if (!button) return
  button.click()
  // Animáció nélkül (prefers-reduced-motion mellett is helyes), középre, hogy
  // a ragadós fejléc ne takarja (WCAG 2.2 SC 2.4.11).
  button.scrollIntoView({ block: 'center' })
  button.focus({ preventScroll: true })
}

export function CourseEditorialChecklist() {
  const fields = useFormFields(([fields]) => fields)
  const summary = courseEditorialChecklist(reduceFieldsToValues(fields, true) as Partial<Product>)
  return (
    <section
      aria-label="Szerkesztői ellenőrzőlista"
      style={{ marginBottom: '1.5rem', color: 'var(--theme-elevation-800)' }}
    >
      {/* A lap első szakaszcíme a dokumentum h1-e után: h2 (WCAG 2.2 SC 1.3.1,
          axe heading-order), a megszokott h3-méretben (Payload type.scss %h3). */}
      <h2 style={{ fontSize: 'var(--base)', lineHeight: 'calc(var(--base) * 1.2)' }}>
        Kurzus áttekintése
      </h2>
      <p>Szerkesztői tájékoztató. A közzététel külön tulajdonosi döntés.</p>
      <ul
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 14rem), 1fr))',
          gap: '0.75rem 1rem',
          padding: 0,
          listStyle: 'none',
        }}
      >
        {summary.items.map((item) => (
          <li key={item.key} style={{ overflowWrap: 'anywhere' }}>
            <strong>{item.label}</strong>
            <span data-kc-allapot={item.ready ? 'rendben' : 'ellenorizendo'} style={statusStyle}>
              <span aria-hidden="true">{item.ready ? '✓' : '!'}</span>{' '}
              {item.ready ? 'Rendben' : 'Ellenőrizendő'}
            </span>
            <span style={{ display: 'block' }}>{item.detail}</span>
            {item.tab ? (
              <Button
                buttonStyle="secondary"
                margin={false}
                onClick={() => openEditorTab(item.tab ?? '')}
                size="small"
              >
                Ugrás az „{item.tab}” fülre
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      <p>
        Tananyag forrása: {summary.source === 'legacy' ? 'korábbi videólista' : 'modulok és leckék'}
        .
      </p>
      {summary.hiddenLegacyCount > 0 ? (
        <p role="status">
          A modulok leckéi elfedik a korábbi lista {summary.hiddenLegacyCount} videóját. A korábbi
          adatok megmaradtak.
        </p>
      ) : null}
    </section>
  )
}
