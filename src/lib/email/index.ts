/**
 * E-mail modul (T-018) — nyilvános belépési pont.
 */
export { sendMail, resolveEmailProvider } from './provider'
export type { ResolvedEmailProvider, SendMailInput } from './provider'
export { maskEmail, parseFromAddress, formatFromAddress } from './mask'
export { kineticareEmailAdapter } from './adapter'
export { usersAuthEmails } from './users-auth'
export { renderLayout, escapeHtml } from './templates/layout'
export { welcomeEmail, resetPasswordEmail, verifyEmail, contactStaffEmail } from './templates/auth'
export { appointmentCustomerEmail, appointmentStaffEmail } from './templates/appointment'
export { orderConfirmationEmail, type OrderConfirmationItem } from './templates/order'
export { migrationNoticeEmail, MIGRATION_NOTICE_PATH } from './templates/migration'
export { EmailSendError } from './types'
export type { EmailProviderName, EmailTemplate, MailMessage, SendResult } from './types'
