import type { ReactNode } from 'react'
import type { AdminViewServerProps } from 'payload'
import { DefaultTemplate } from '@payloadcms/next/templates'

import { shouldWrapAdminChrome } from '../../lib/admin/custom-view-auth'

/**
 * A Payload admin keret (oldalsáv, fejléc) a saját nézetek körül.
 * A custom view magától nem kapja meg a sablont.
 */
export function AdminChrome({
  props,
  children,
}: {
  props: AdminViewServerProps
  children: ReactNode
}) {
  const { initPageResult, params, searchParams } = props
  return (
    <DefaultTemplate
      req={initPageResult.req}
      i18n={props.i18n}
      locale={props.locale ?? initPageResult.locale}
      params={params}
      payload={props.payload}
      permissions={props.permissions ?? initPageResult.permissions}
      searchParams={searchParams}
      user={props.user ?? initPageResult.req.user ?? undefined}
      visibleEntities={initPageResult.visibleEntities}
    >
      {children}
    </DefaultTemplate>
  )
}

/**
 * Custom nézet köré csak akkor teszi a DefaultTemplate-et, ha van user.
 * Anoním elutasításnál a sablon kihagyása a 500 elleni védelem.
 */
export function AdminViewFrame({
  props,
  children,
}: {
  props: AdminViewServerProps
  children: ReactNode
}) {
  const user = props.user ?? props.initPageResult.req.user
  if (!shouldWrapAdminChrome(user)) {
    return children
  }
  return <AdminChrome props={props}>{children}</AdminChrome>
}
