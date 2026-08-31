import type { Access, CollectionConfig } from 'payload'

import { REFUND_INTENT_STATES } from '../lib/refund/refund-intent'

const isOwner: Access = ({ req }) => req.user?.role === 'owner'

/**
 * Dormant Phase A refund ledger. No custom refund-executing endpoint, hook, job or live
 * consumer writes it; registration still creates standard Payload REST endpoints.
 * Future writers must use the domain helpers and atomically maintain activeOrderKey
 * with a persisted compare-and-set; the unique fields are only database backstops.
 */
export const RefundIntents: CollectionConfig = {
  slug: 'refund-intents',
  lockDocuments: false,
  labels: { singular: 'Visszatérítési szándék', plural: 'Visszatérítési szándékok' },
  admin: {
    useAsTitle: 'requestHash',
    defaultColumns: ['order', 'state', 'requestedAmountHuf', 'refundSequence', 'createdAt'],
    group: 'Rendszer',
    description: 'Passzív, csak olvasható Phase A visszatérítési főkönyv.',
  },
  access: {
    read: isOwner,
    create: () => false,
    update: () => false,
    delete: () => false,
  },
  fields: [
    { name: 'order', type: 'relationship', relationTo: 'orders', required: true, index: true },
    { name: 'actor', type: 'relationship', relationTo: 'users', required: true, index: true },
    { name: 'requestedAmountHuf', type: 'number', required: true, min: 1 },
    {
      name: 'provider',
      type: 'select',
      required: true,
      options: [{ label: 'Barion', value: 'barion' }],
    },
    { name: 'providerPaymentId', type: 'text', required: true },
    { name: 'providerTransactionId', type: 'text', required: true },
    {
      name: 'state',
      type: 'select',
      required: true,
      index: true,
      options: REFUND_INTENT_STATES.map((state) => ({ label: state, value: state })),
    },
    { name: 'requestHash', type: 'text', required: true, index: true },
    { name: 'idempotencyKeyHash', type: 'text', required: true, unique: true, index: true },
    { name: 'activeOrderKey', type: 'text', unique: true, index: true },
    { name: 'schemaVersion', type: 'number', required: true, min: 1, max: 1 },
    { name: 'refundSequence', type: 'number', required: true, min: 1 },
    { name: 'currency', type: 'select', required: true, options: [{ label: 'HUF', value: 'HUF' }] },
    { name: 'reason', type: 'textarea', maxLength: 1000 },
    { name: 'providerStartedAt', type: 'date' },
    { name: 'providerResolvedAt', type: 'date' },
    { name: 'committedAt', type: 'date' },
    { name: 'reconciliationCheckedAt', type: 'date' },
    { name: 'reconciliationReference', type: 'text' },
  ],
}
