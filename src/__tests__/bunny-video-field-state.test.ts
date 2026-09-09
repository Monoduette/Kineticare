import { describe, expect, it } from 'vitest'
import type { FormState } from 'payload'
import {
  captureVideoTarget,
  videoFieldPatch,
  parseVideo,
  validateVideoFile,
  pollDelay,
  videoPagination,
} from '../components/admin/bunny-video-state'

const guid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const detail = {
  guid,
  title: 'Provider title',
  durationSec: 123,
  status: 'ready' as const,
  thumbnailUrl: null,
}
const row = (index: number, id: string, asset = ''): FormState => ({
  [`modules.0.lessons.${index}.id`]: { value: id, valid: true },
  [`modules.0.lessons.${index}.kind`]: { value: 'video', valid: true },
  [`modules.0.lessons.${index}.title`]: { value: 'My title', valid: true },
  [`modules.0.lessons.${index}.streamAssetId`]: { value: asset, valid: true },
  [`modules.0.lessons.${index}.durationSec`]: { value: 12, valid: true },
  [`modules.0.lessons.${index}.status`]: { value: 'processing', valid: true },
})
const fields = (): FormState => ({
  'modules.0.id': { value: 'module-a', valid: true },
  ...row(0, 'a'),
  ...row(1, 'b'),
})

describe('video field transaction', () => {
  it('never writes a processing video even when a previous list called it ready', () => {
    const target = captureVideoTarget(fields(), 'modules.0.lessons.0.streamAssetId', 'protected')!
    expect(videoFieldPatch(fields(), target, { ...detail, status: 'processing' })).toBeNull()
  })
  it('resolves the stable row after reorder and changes only three fields', () => {
    const target = captureVideoTarget(fields(), 'modules.0.lessons.0.streamAssetId', 'protected')!
    const reordered: FormState = {
      'modules.0.id': { value: 'module-a', valid: true },
      ...row(0, 'b'),
      ...row(1, 'a'),
    }
    const patch = videoFieldPatch(reordered, target, detail)!
    expect(Object.keys(patch)).toEqual([
      'modules.0.lessons.1.streamAssetId',
      'modules.0.lessons.1.durationSec',
      'modules.0.lessons.1.status',
    ])
    expect(patch['modules.0.lessons.1.streamAssetId'].value).toBe(guid)
    expect(reordered['modules.0.lessons.1.title'].value).toBe('My title')
  })
  it('does not recreate a deleted row or write to its replacement', () => {
    const target = captureVideoTarget(fields(), 'modules.0.lessons.0.streamAssetId', 'protected')!
    expect(videoFieldPatch({ ...row(0, 'b') }, target, detail)).toBeNull()
  })
  it('rejects changed kind, concurrent replacement and duplicate row IDs', () => {
    const target = captureVideoTarget(fields(), 'modules.0.lessons.0.streamAssetId', 'protected')!
    expect(
      videoFieldPatch(
        { ...fields(), 'modules.0.lessons.0.kind': { value: 'link', valid: true } },
        target,
        detail,
      ),
    ).toBeNull()
    expect(videoFieldPatch({ ...fields(), ...row(0, 'a', guid) }, target, detail)).toBeNull()
    expect(videoFieldPatch({ ...fields(), ...row(1, 'a') }, target, detail)).toBeNull()
  })
  it('pins public selection to the single preview field', () => {
    const current = { previewVideoStreamId: { value: '', valid: true }, ...fields() }
    const target = captureVideoTarget(current, 'previewVideoStreamId', 'public')!
    expect(Object.keys(videoFieldPatch(current, target, detail)!)).toEqual(['previewVideoStreamId'])
    expect(captureVideoTarget(fields(), 'modules.0.lessons.0.streamAssetId', 'public')).toBeNull()
  })
  it('requires stable row IDs and recognizes legacy videos', () => {
    expect(captureVideoTarget({}, 'videos.0.streamAssetId', 'protected')).toBeNull()
    const legacy = {
      'videos.0.id': { value: 'legacy', valid: true },
      'videos.0.streamAssetId': { value: '', valid: true },
    }
    expect(captureVideoTarget(legacy, 'videos.0.streamAssetId', 'protected')).not.toBeNull()
  })
  it('checks current replacement value even when the dialog captured an older value', () => {
    const original = { ...fields(), ...row(0, 'a', 'old-guid') }
    const target = captureVideoTarget(original, 'modules.0.lessons.0.streamAssetId', 'protected')!
    const changed = { ...original, ...row(0, 'a', 'another-guid') }
    expect(videoFieldPatch(changed, target, detail)).toBeNull()
    expect(changed['modules.0.lessons.0.streamAssetId'].value).toBe('another-guid')
  })
  it('preserves metadata field state while writing values directly', () => {
    const state: FormState = {
      ...fields(),
      'modules.0.lessons.0.durationSec': {
        value: 10,
        valid: true,
        initialValue: 10,
        disableFormData: false,
      },
    }
    const target = captureVideoTarget(state, 'modules.0.lessons.0.streamAssetId', 'protected')!
    const patch = videoFieldPatch(state, target, detail)!
    expect(patch['modules.0.lessons.0.durationSec']).toMatchObject({
      value: 123,
      initialValue: 10,
      disableFormData: false,
    })
  })
})

describe('trusted detail and limits', () => {
  it('uses effective server pageSize when the provider clamps it', () => {
    expect(videoPagination({ pageSize: 12, totalItems: 30 }, 1, 12)).toEqual({
      total: 30,
      pages: 3,
      hasNext: true,
    })
    expect(videoPagination({ pageSize: 12, totalItems: null }, 1, 12).hasNext).toBe(true)
    expect(videoPagination({ pageSize: 12, totalItems: null, truncated: true }, 1, 4).hasNext).toBe(
      true,
    )
    expect(videoPagination({ pageSize: 12, totalItems: null }, 2, 4).hasNext).toBe(false)
    expect(videoPagination({ pageSize: 0, totalItems: 25 }, 1, 24).pages).toBe(2)
  })
  it('normalizes provider detail without inferring readiness from duration', () => {
    expect(parseVideo({ guid, title: 'A', lengthSec: 123, status: 4 })?.status).toBe('ready')
    expect(parseVideo({ guid, title: 'A', lengthSec: 123, status: 2 })?.status).toBe('processing')
    expect(parseVideo({ guid, title: 'A', lengthSec: 123, status: 99 })?.status).toBe('processing')
    expect(parseVideo({ guid: '../bad', title: 'A', status: 4 })).toBeNull()
  })
  it('enforces 2 GiB, nonempty video and a bounded poll window', () => {
    expect(validateVideoFile({ size: 2 * 1024 ** 3, type: 'video/mp4' })).toBeNull()
    expect(validateVideoFile({ size: 2 * 1024 ** 3 + 1, type: 'video/mp4' })).not.toBeNull()
    expect(validateVideoFile({ size: 0, type: 'video/mp4' })).not.toBeNull()
    expect(validateVideoFile({ size: 12, type: 'text/plain' })).not.toBeNull()
    expect(pollDelay(0, 0)).toBe(5000)
    expect(pollDelay(20, 500000)).toBe(30000)
    expect(pollDelay(20, 600000)).toBeNull()
  })
})
