import type { Payload } from 'payload'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { loadProductPreview, previewCurriculum } from '../lib/preview/product-preview'
import { buildCurriculum } from '../lib/curriculum/curriculum'
import { buildAdminPreviewUrl, previewTargetPath } from '../lib/preview/preview-target'
import { createPreviewHandler } from '../lib/preview/route-handler'

afterEach(() => vi.unstubAllGlobals())

function harness(role: string | null) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('Network forbidden')
    }),
  )
  const auth = vi
    .fn<(args: { headers: Headers }) => Promise<{ user: { id: number; role: string } | null }>>()
    .mockResolvedValue({ user: role ? { id: 7, role } : null })
  const find = vi.fn(async () => ({ docs: [{ id: 12, slug: 'kez-torna', status: 'draft' }] }))
  return { auth, find, payload: { auth, find } as unknown as Payload }
}

describe('saved product preview', () => {
  it('removes protected legacy fallback refs without mutating the player model', () => {
    const curriculum = buildCurriculum(
      { videos: [{ streamAssetId: 'PRIVATE_GUID', title: 'Legacy', status: 'ready' }] },
      true,
    )
    expect(curriculum.lessons[0].ref).toBe('PRIVATE_GUID')
    const projected = previewCurriculum(curriculum)
    expect(JSON.stringify(projected)).not.toContain('PRIVATE_GUID')
    expect(projected.lessons[0].title).toBe('Legacy')
    expect(curriculum.lessons[0].streamAssetId).toBe('PRIVATE_GUID')
  })
  it('maps only safe course slugs', () => {
    expect(previewTargetPath('products', 'kez-torna')).toBe('/kurzusok/kez-torna')
    expect(buildAdminPreviewUrl('products', 'kez-torna')).toContain('collection=products')
    for (const slug of ['..', '.', '%2e%2e', 'a?b', 'a#b', '//evil.test', 'a\\b', '123']) {
      expect(previewTargetPath('products', slug)).toBeNull()
      expect(buildAdminPreviewUrl('products', slug)).toBeNull()
    }
  })

  it.each([null, 'customer'])('rejects %s even with an old preview cookie', async (role) => {
    const h = harness(role)
    expect(
      await loadProductPreview({
        payload: h.payload,
        headers: new Headers({ cookie: '__prerender_bypass=old' }),
        slug: 'kez-torna',
      }),
    ).toBeNull()
    expect(h.auth).toHaveBeenCalledOnce()
    expect(h.find).not.toHaveBeenCalled()
    const enableDraftMode = vi.fn()
    const response = await createPreviewHandler({
      getPayload: async () => h.payload,
      enableDraftMode,
    })(new Request('http://localhost/next/preview?collection=products&slug=kez-torna'))
    expect(response.status).toBe(403)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(enableDraftMode).not.toHaveBeenCalled()
  })

  it.each(['staff', 'owner'])(
    'reads latest saved draft as freshly authenticated %s',
    async (role) => {
      const h = harness(role)
      expect(
        await loadProductPreview({ payload: h.payload, headers: new Headers(), slug: 'kez-torna' }),
      ).toMatchObject({ status: 'draft' })
      expect(h.find).toHaveBeenCalledWith(
        expect.objectContaining({
          collection: 'products',
          draft: true,
          overrideAccess: false,
          user: { id: 7, role },
          where: { slug: { equals: 'kez-torna' } },
        }),
      )
      expect(h.auth.mock.calls[0]?.[0].headers.get('DisableAutologin')).toBe('true')
      h.auth.mockResolvedValueOnce({ user: null })
      expect(
        await loadProductPreview({ payload: h.payload, headers: new Headers(), slug: 'kez-torna' }),
      ).toBeNull()
      expect(h.find).toHaveBeenCalledOnce()
    },
  )

  it('fails closed on authentication errors', async () => {
    const h = harness('owner')
    h.auth.mockRejectedValueOnce(new Error('expired session'))
    await expect(
      loadProductPreview({ payload: h.payload, headers: new Headers(), slug: 'kez-torna' }),
    ).rejects.toThrow('expired session')
    expect(h.find).not.toHaveBeenCalled()
  })

  it('enables private preview only after confirming a saved product exists', async () => {
    const h = harness('staff')
    const enableDraftMode = vi.fn()
    const handler = createPreviewHandler({ getPayload: async () => h.payload, enableDraftMode })
    const request = new Request('http://localhost/next/preview?collection=products&slug=kez-torna')
    const response = await handler(request)
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('/kurzusok/kez-torna')
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(enableDraftMode).toHaveBeenCalledOnce()
    h.find.mockResolvedValueOnce({ docs: [] })
    expect((await handler(request)).status).toBe(404)
    expect(enableDraftMode).toHaveBeenCalledOnce()
  })
})
