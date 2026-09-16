'use client'

import { useFormFields } from '@payloadcms/ui'
import { reduceFieldsToValues } from 'payload/shared'
import type { Product } from '../../payload-types'
import { courseEditorialChecklist } from './course-editorial-checklist'

export function CourseEditorialChecklist() {
  const fields = useFormFields(([fields]) => fields)
  const summary = courseEditorialChecklist(reduceFieldsToValues(fields, true) as Partial<Product>)
  return (
    <section
      aria-label="Szerkesztői ellenőrzőlista"
      style={{ marginBottom: '1.5rem', color: 'var(--theme-elevation-800)' }}
    >
      <h3>Kurzus áttekintése</h3>
      <p>Szerkesztői tájékoztató. A közzététel külön tulajdonosi döntés.</p>
      <ul
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 14rem), 1fr))',
          gap: '0.5rem 1rem',
          padding: 0,
          listStyle: 'none',
        }}
      >
        {summary.items.map((item) => (
          <li key={item.key} style={{ overflowWrap: 'anywhere' }}>
            <strong>{item.label}</strong>: {item.detail}
            <span style={{ display: 'block' }}>{item.ready ? 'Rendben' : 'Ellenőrizendő'}</span>
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
