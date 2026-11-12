import type { Tx } from './db'
import { DomainError, Codes } from './errors'
import type { UnitOfWork } from './unitOfWork'

/*
 * The client ledger (STATE-MACHINES §11). Debits are positive and credits negative. An invoice's
 * balance is the sum of its entries, a client's balance the sum of theirs; nothing is stored that could
 * drift, and the table is append-only in the database. Every posting names the day it belongs to and
 * the AR period that day falls in: a closed period takes no new entry, and a back-dated posting is
 * refused with a pointer to the next open day.
 */

type Reader = Pick<Tx, '$queryRaw'> | { $queryRaw: Tx['$queryRaw'] }

const big = (v: unknown) => BigInt(String(v ?? 0))

/** Reads in the same tick share one query: a list of invoices asks for every balance at once, not one round trip each. */
const pending = new WeakMap<object, { ids: Set<string>; done: Promise<Map<string, bigint>> }>()

export async function balanceOfInvoice(db: Reader, invoiceId: string): Promise<bigint> {
  const key = db as object
  let batch = pending.get(key)
  if (!batch) {
    const ids = new Set<string>()
    const made = { ids, done: Promise.resolve().then(() => new Promise<void>(r => setTimeout(r, 0))).then(async () => {
      pending.delete(key)
      const list = [...ids]
      const rows = await (db as Tx).$queryRaw<{ id: string; s: bigint | null }[]>`SELECT "invoice" AS id, COALESCE(SUM("amountMinor"), 0) AS s FROM "ClientLedgerEntry" WHERE "invoice" = ANY(${list}::text[]) GROUP BY "invoice"`
      return new Map(rows.map(r => [r.id, big(r.s)]))
    }) }
    pending.set(key, made)
    batch = made
  }
  batch.ids.add(invoiceId)
  return (await batch.done).get(invoiceId) ?? 0n
}

export async function balanceOfClient(db: Reader, clientId: string): Promise<bigint> {
  const rows = await (db as Tx).$queryRaw<{ s: bigint | null }[]>`SELECT COALESCE(SUM("amountMinor"), 0) AS s FROM "ClientLedgerEntry" WHERE "client" = ${clientId}`
  return big(rows[0]?.s)
}

export async function paymentTotals(db: Reader, paymentId: string): Promise<{ allocated: bigint; refunded: bigint }> {
  const a = await (db as Tx).$queryRaw<{ s: bigint | null }[]>`SELECT COALESCE(SUM("amountMinor"), 0) AS s FROM "PaymentAllocation" WHERE "payment" = ${paymentId}`
  const r = await (db as Tx).$queryRaw<{ s: bigint | null }[]>`SELECT COALESCE(SUM("amountMinor"), 0) AS s FROM "Refund" WHERE "payment" = ${paymentId} AND status IN ('requested', 'approved', 'processing', 'succeeded', 'unknown')`
  return { allocated: big(a[0]?.s), refunded: big(r[0]?.s) }
}

/** What a plan has used so far: ordered and done items at what they were charged, else what they were expected to cost. */
export async function planSpend(db: Reader, planId: string): Promise<bigint> {
  const rows = await (db as Tx).$queryRaw<{ s: bigint | null }[]>`SELECT COALESCE(SUM(COALESCE("chargedMinor", "projectedMinor")), 0) AS s FROM "TreatmentPlanItem" WHERE "plan" = ${planId} AND status IN ('ordered', 'done')`
  return big(rows[0]?.s)
}

/** The AR period holding `day`, created (open, one calendar month) when none exists yet. A closed one is returned as it is. */
export async function periodFor(tx: Tx, day: string): Promise<{ id: string; status: string; label: string }> {
  const existing = await tx.arPeriod.findFirst({ where: { startsOn: { lte: new Date(`${day}T00:00:00Z`) }, endsOn: { gte: new Date(`${day}T00:00:00Z`) } }, select: { id: true, status: true, label: true } })
  if (existing) return existing
  const [y, m] = day.split('-').map(Number)
  const startsOn = `${y}-${String(m).padStart(2, '0')}-01`
  const endsOn = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
  const label = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(`${startsOn}T00:00:00Z`))
  return tx.arPeriod.create({ data: { label, startsOn: new Date(`${startsOn}T00:00:00Z`), endsOn: new Date(`${endsOn}T00:00:00Z`), status: 'open' }, select: { id: true, status: true, label: true } })
}

export type Posting = {
  clientId: string
  invoiceId?: string | null
  paymentId?: string | null
  kind: string
  amountMinor: bigint
  currencyCode?: string
  /** The clinic's calendar day the posting belongs to (today unless back-dated). */
  postedOn: string
  entryKey: string
  memo?: string
}

/**
 * Append one entry. Refuses a day inside a closed period (the caller posts on an open day and names the
 * original in the memo), and a repeat of the same cause is a no-op returning the entry already there.
 */
export async function post(uow: UnitOfWork, input: Posting) {
  const { tx } = uow
  const period = await periodFor(tx, input.postedOn)
  if (period.status !== 'open') {
    throw new DomainError(Codes.GUARD_FAILED, `${period.label} is closed. Post this on an open day and refer to the original in the note.`, { reason: 'period_closed', period: period.label })
  }
  const existing = await tx.clientLedgerEntry.findUnique({ where: { entryKey: input.entryKey }, select: { id: true } })
  if (existing) return { id: existing.id, created: false }
  const row = await tx.clientLedgerEntry.create({
    data: {
      clientId: input.clientId, invoiceId: input.invoiceId ?? null, paymentId: input.paymentId ?? null, kind: input.kind, amountMinor: input.amountMinor,
      currencyCode: input.currencyCode ?? 'USD', postedOn: new Date(`${input.postedOn}T00:00:00Z`), periodId: period.id, entryKey: input.entryKey, memo: input.memo ?? '', at: uow.now,
    },
    select: { id: true },
  })
  return { id: row.id, created: true }
}
