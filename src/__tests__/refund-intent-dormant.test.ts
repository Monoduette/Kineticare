import { readdirSync, readFileSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory()
      ? sourceFiles(path)
      : ['.ts', '.tsx'].includes(extname(path))
        ? [path]
        : []
  })
}

describe('refund intent Phase A dormancy', () => {
  it('keeps every live refund, revocation, access, and job surface free of ledger references', () => {
    const liveRefundFiles = [
      'src/lib/refund/refund-order.ts',
      'src/lib/refund/route-handler.ts',
      'src/app/(frontend)/api/admin/orders/[orderNumber]/refund/route.ts',
      'src/components/admin/RefundPanel.tsx',
      'src/lib/barion/refund.ts',
      'src/lib/user-purchases-lock.ts',
      'src/lib/order-status/recover-paid-reject.ts',
    ]
    const jobFiles = sourceFiles(join(root, 'src/jobs')).map((path) => relative(root, path))
    const references = /refund-intent|refund-intents|RefundIntents/u
    for (const path of [...liveRefundFiles, ...jobFiles]) {
      expect(readFileSync(join(root, path), 'utf8'), path).not.toMatch(references)
    }
  })
})
