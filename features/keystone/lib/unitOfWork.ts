import { appendAuditEvents, type AuditInput } from './audit'
import { TRANSACTION_OPTIONS, type Db, type Tx } from './db'

/**
 * One business transaction: state changes, ledger postings and the audit events all commit together
 * or not at all (SM§0). No network I/O happens inside.
 */

export class UnitOfWork {
  readonly audits: AuditInput[] = []
  constructor(readonly tx: Tx, readonly now: Date, readonly requestId: string | null) {}
  audit(event: AuditInput) {
    this.audits.push({ requestId: this.requestId, ...event })
  }
}

export async function runInTransaction<T>(db: Db, work: (uow: UnitOfWork) => Promise<T>, options: { requestId?: string | null; now?: Date } = {}): Promise<T> {
  return db.$transaction(async tx => {
    const uow = new UnitOfWork(tx, options.now ?? new Date(), options.requestId ?? null)
    const result = await work(uow)
    // Last: the chain lock is held only for the final moments of the transaction.
    await appendAuditEvents(tx, uow.audits, uow.now)
    return result
  }, TRANSACTION_OPTIONS)
}
