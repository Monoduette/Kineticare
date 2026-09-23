import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react'
import type { FormState } from 'payload'
export { XIcon } from '../../../../node_modules/@payloadcms/ui/dist/icons/X/index.js'
export { SearchIcon } from '../../../../node_modules/@payloadcms/ui/dist/icons/Search/index.js'
export { ChevronIcon } from '../../../../node_modules/@payloadcms/ui/dist/icons/Chevron/index.js'

export const fixture = {
  fields: {} as FormState,
  commits: 0,
  modified: 0,
  actions: [] as string[],
  subscribers: new Set<() => void>(),
  publish(fields: FormState) {
    this.fields = fields
    this.subscribers.forEach((fn) => fn())
  },
}
const Path = createContext('')
export function FixturePath({ path, children }: { path: string; children: ReactNode }) {
  return <Path.Provider value={path}>{children}</Path.Provider>
}
export function useAuth() {
  return { user: { id: 1, role: 'staff' } }
}
export function useField({ potentiallyStalePath }: { potentiallyStalePath: string }) {
  const dynamicPath = useContext(Path)
  const fields = useSyncExternalStore(
    (fn) => {
      fixture.subscribers.add(fn)
      return () => {
        fixture.subscribers.delete(fn)
      }
    },
    () => fixture.fields,
  )
  const path = dynamicPath || potentiallyStalePath
  return { value: fields[path]?.value, path, disabled: false, showError: false, errorMessage: '' }
}
export function useForm() {
  return {
    disabled: false,
    getFields: () => fixture.fields,
    dispatchFields: ({ type, formState }: { type: string; formState: FormState }) => {
      fixture.actions.push(type)
      fixture.commits++
      fixture.publish({ ...fixture.fields, ...formState })
    },
    setModified: () => {
      fixture.modified++
    },
  }
}
/** K35: a mező a Payload FieldLabel és FieldDescription elemével írja ki a config szövegét. */
export function FieldLabel({
  label,
}: {
  label?: unknown
  as?: string
  path?: string
  required?: boolean
}) {
  return <span className="field-label">{typeof label === 'string' ? label : ''}</span>
}
export function FieldDescription({ description }: { description?: unknown; path: string }) {
  return (
    <div className="field-description">{typeof description === 'string' ? description : ''}</div>
  )
}
