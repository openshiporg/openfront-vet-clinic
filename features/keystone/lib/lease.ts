import type { Db, Tx } from './db'
import { DomainError, Codes } from './errors'

/**
 * Named leases with fencing tokens (sportsbook lease-fencing.ts pattern). Only one worker holds a
 * lease at a time. Every take-over increments the fencing token; writes made under a lease assert the
 * token they were granted (assertFence), so a worker that paused past its expiry and wakes up can
 * no longer write: its token is stale.
 */
export type LeaseGrant = { key: string; owner: string; fencingToken: number; expiresAt: Date }

/** Acquire or renew. Returns null while another owner holds an unexpired lease. */
export async function acquireLease(db: Db | Tx, key: string, owner: string, ttlMs: number, now = new Date()): Promise<LeaseGrant | null> {
  const expiresAt = new Date(now.getTime() + ttlMs)
  // Single statement: insert, or take over when expired, or renew when we already own it.
  const rows = await db.$queryRaw<{ key: string; owner: string; fencingToken: number; expiresAt: Date }[]>`
    INSERT INTO "Lease" (id, key, owner, "fencingToken", "expiresAt", "createdAt", "updatedAt")
    VALUES (gen_random_uuid()::text, ${key}, ${owner}, 1, (${expiresAt}::timestamptz AT TIME ZONE 'UTC'), (${now}::timestamptz AT TIME ZONE 'UTC'), (${now}::timestamptz AT TIME ZONE 'UTC'))
    ON CONFLICT (key) DO UPDATE SET
      owner = EXCLUDED.owner,
      "fencingToken" = CASE WHEN "Lease".owner = EXCLUDED.owner AND "Lease"."expiresAt" > (${now}::timestamptz AT TIME ZONE 'UTC') THEN "Lease"."fencingToken" ELSE "Lease"."fencingToken" + 1 END,
      "expiresAt" = EXCLUDED."expiresAt",
      "updatedAt" = EXCLUDED."updatedAt"
    WHERE "Lease"."expiresAt" <= (${now}::timestamptz AT TIME ZONE 'UTC') OR "Lease".owner = EXCLUDED.owner
    RETURNING key, owner, "fencingToken", "expiresAt"`
  const row = rows[0]
  return row ? { key: row.key, owner: row.owner, fencingToken: Number(row.fencingToken), expiresAt: row.expiresAt } : null
}

/** Release early (only by the holder of this exact token). */
export async function releaseLease(db: Db | Tx, grant: LeaseGrant, now = new Date()) {
  await db.lease.updateMany({ where: { key: grant.key, owner: grant.owner, fencingToken: grant.fencingToken }, data: { expiresAt: now } })
}

/**
 * Inside the transaction that writes under the lease: lock the lease row and prove the grant is
 * still current. Throws STALE_FENCING_TOKEN (taken over) or LEASE_LOST (expired).
 */
export async function assertFence(tx: Tx, grant: LeaseGrant, now = new Date()) {
  const rows = await tx.$queryRaw<{ owner: string; fencingToken: number; expiresAt: Date }[]>`
    SELECT owner, "fencingToken", "expiresAt" FROM "Lease" WHERE key = ${grant.key} FOR UPDATE`
  const row = rows[0]
  if (!row || Number(row.fencingToken) !== grant.fencingToken || row.owner !== grant.owner) {
    throw new DomainError(Codes.STALE_FENCING_TOKEN, 'Another worker took over this lease.', { key: grant.key, token: grant.fencingToken, current: row ? Number(row.fencingToken) : null })
  }
  if (row.expiresAt.getTime() <= now.getTime()) throw new DomainError(Codes.LEASE_LOST, 'The lease expired before the write.', { key: grant.key })
}
