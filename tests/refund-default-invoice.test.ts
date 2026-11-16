import { describe, expect, it } from 'vitest'
import { soleAllocatedInvoice } from '../features/keystone/lib/ledger'

/* A refund asked for without an invoice defaults to the invoice the payment was applied to, only when that is unambiguous. */
describe('soleAllocatedInvoice', () => {
  it('uses the one invoice, even across several allocation rows', () => {
    expect(soleAllocatedInvoice([{ invoiceId: 'inv_1' }])).toBe('inv_1')
    expect(soleAllocatedInvoice([{ invoiceId: 'inv_1' }, { invoiceId: 'inv_1' }])).toBe('inv_1')
  })
  it('keeps today\'s behaviour (null) for none or several', () => {
    expect(soleAllocatedInvoice([])).toBeNull()
    expect(soleAllocatedInvoice([{ invoiceId: null }])).toBeNull()
    expect(soleAllocatedInvoice([{ invoiceId: 'inv_1' }, { invoiceId: 'inv_2' }])).toBeNull()
  })
})
