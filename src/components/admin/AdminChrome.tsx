import type { ReactNode } from 'react'
import type { AdminViewServerProps } from 'payload'
import { DefaultTemplate } from '@payloadcms/next/templates'
import { SetStepNav } from '@payloadcms/ui'

import { shouldWrapAdminChrome } from '../../lib/admin/custom-view-auth'

/**
 * A Payload admin keret (oldalsáv, fejléc) a saját nézetek körül.
 * A custom view magától nem kapja meg a sablont.
 */
export function AdminChrome({
  props,
  children,
  title,
}: {
  props: AdminViewServerProps
  children: ReactNode
  title: string
}) {
  const { initPageResult, params, searchParams } = props
  return (
    <DefaultTemplate
      i18n={props.i18n}
      locale={props.locale ?? initPageResult.locale}
      params={params}
      payload={props.payload}
      permissions={props.permissions ?? initPageResult.permissions}
      req={initPageResult.req}
      searchParams={searchParams}
      user={props.user ?? initPageResult.req.user ?? undefined}
      visibleEntities={initPageResult.visibleEntities}
    >
      <SetStepNav nav={[{ label: title }]} />
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
  title,
}: {
  props: AdminViewServerProps
  children: ReactNode
  title: string
}) {
  const user = props.user ?? props.initPageResult.req.user
  if (!shouldWrapAdminChrome(user)) {
    return children
  }
  return (
    <AdminChrome props={props} title={title}>
      {children}
    </AdminChrome>
  )
}
