import { keystoneContext } from '@/features/keystone/context'
import { systemActor } from '@/features/keystone/lib/actor'

/*
 * The client site has no staff session, so it cannot use the staff GraphQL commands (they need a role permission).
 * It reads and writes through the same database client and the same domain building blocks (command, slot tokens,
 * advisory locks, audit) as those commands, acting as the signed-in client. Every read is filtered to that client's
 * own household here, in this folder.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const db = (): any => keystoneContext.prisma

/** Who a client-site command acts as: recorded on the idempotency receipt and in the audit trail. */
export const clientActor = (personId: string) => systemActor(`client-site:${personId}`)
