import type { ReactNode } from 'react'

import './szakembereknek.css'

/**
 * A /szakembereknek útvonal layoutja: a lap saját stíluslapjának bekötése (a
 * /kurzusok mintájára). A globális keret (fejléc, lábléc, skip-link) a
 * (frontend) layoutban él; extra DOM-burkolót szándékosan nem ad hozzá.
 */
export default function SzakembereknekLayout({ children }: { children: ReactNode }) {
  return children
}
