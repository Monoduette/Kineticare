import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getPathMatch } from 'next/dist/shared/lib/router/utils/path-match'
import { buildContentSecurityPolicy } from '../../lib/security/csp'

// Inspect only our header configuration, never bootstrap Payload or an app.
vi.mock('@payloadcms/next/withPayload', () => ({ withPayload: (config: unknown) => config }))
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('admin-only TUS CSP', () => {
  it('adds only the documented origin to admin connect-src', () => {
    const storefront = buildContentSecurityPolicy()
    const admin = buildContentSecurityPolicy(undefined, undefined, undefined, undefined, true)
    expect(storefront).not.toContain('https://video.bunnycdn.com')
    expect(admin).toContain("connect-src 'self' https://video.bunnycdn.com")
    expect(
      admin.replace("connect-src 'self' https://video.bunnycdn.com", "connect-src 'self'"),
    ).toBe(storefront)
    expect(admin).not.toContain("'unsafe-eval'")
  })
  it('places admin CSP override after the unchanged default header rule', () => {
    const config = readFileSync(new URL('../../../next.config.ts', import.meta.url), 'utf8')
    expect(config).toContain("source: '/admin/:path*'")
    expect(config.indexOf("source: '/admin/:path*'")).toBeGreaterThan(
      config.indexOf("source: '/:path*'"),
    )
    expect(config).toMatch(/POSTHOG_SHARED_DASHBOARD_URL,\s+true,/)
  })
  it('resolves actual header rules for admin, storefront, consumer API and lookalike paths', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('Unexpected network')
      }),
    )
    vi.stubEnv('NEXT_PUBLIC_GA_MEASUREMENT_ID', '')
    vi.stubEnv('NEXT_PUBLIC_BARION_PIXEL_ID', '')
    vi.stubEnv('POSTHOG_SHARED_DASHBOARD_URL', '')
    const config = (await import('../../../next.config')).default
    const rules = await config.headers!()
    for (const path of [
      '/admin',
      '/admin/',
      '/admin/collections/products',
      '/',
      '/kurzusaim/2',
      '/api/stream-token',
      '/administrator',
    ]) {
      const headers = new Headers()
      for (const rule of rules) {
        if (getPathMatch(rule.source)(path)) {
          for (const header of rule.headers) headers.set(header.key, header.value)
        }
      }
      const csp = headers.get('content-security-policy')!
      expect(csp.includes('https://video.bunnycdn.com')).toBe(
        path === '/admin' || path.startsWith('/admin/'),
      )
      expect(headers.get('x-content-type-options')).toBe('nosniff')
      expect(headers.get('x-frame-options')).toBe('SAMEORIGIN')
      expect(csp).not.toContain("'unsafe-eval'")
    }
  })
})
