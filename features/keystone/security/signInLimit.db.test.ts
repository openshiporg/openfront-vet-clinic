import type { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { hasTestDatabase, resetDatabase, testPrisma, uniqueKey } from '../../../tests/helpers/db'
import { internalIdentityHeaders } from '../lib/internal-origin'
import { signInWithPassword } from '../mcp-oauth/http'
import {
  SIGN_IN_ACCOUNT_SLOW_AFTER,
  SIGN_IN_LOCKED_MESSAGE,
  SIGN_IN_MAX_PER_ADDRESS,
  SIGN_IN_MAX_PER_EMAIL,
  SIGN_IN_WINDOW_MINUTES,
  accountBucketKey,
  addressBucketKey,
  clientAddress,
  pairBucketKey,
  sweepExpired,
} from './signInLimit'

process.env.SESSION_SECRET ||= 'test-session-secret-0123456789abcdef-0123456789'

/* Review r7 #2 and r8 #1-#4: failed sign-ins are limited per address, per account and address, and
 * (as a delay only) per account; every path shares one address; the table stays bounded. */
describe.skipIf(!hasTestDatabase)('sign-in attempt limit (r7, r8)', () => {
  let prisma: PrismaClient
  let context: any
  const PASSWORD = 'correct horse battery staple 7'
  const people: string[] = []
  const ids: string[] = []
  const res = () => ({ setHeader() {}, getHeader() { return undefined } })
  const apiRequest = (ip: string, token?: string) =>
    ({ headers: { 'x-real-ip': ip, ...(token ? { cookie: `keystonejs-session=${token}` } : {}) }, method: 'POST', url: '/api/graphql', socket: { remoteAddress: '10.0.0.9' } }) as any
  const run = async (req: any, email: string, password: string) => {
    const ctx = await context.withRequest(req, res() as any)
    const r = await ctx.graphql.raw({ query: 'mutation($e: String!, $p: String!) { authenticateUserWithPassword(email: $e, password: $p) { ... on UserAuthenticationWithPasswordSuccess { sessionToken } ... on UserAuthenticationWithPasswordFailure { message } } }', variables: { e: email, p: password } })
    const a = r.data?.authenticateUserWithPassword
    return { answer: a?.sessionToken ? 'ok' : (a?.message ?? JSON.stringify(r.errors)), token: a?.sessionToken as string | undefined }
  }
  const signIn = async (email: string, password: string, ip: string, token?: string) => (await run(apiRequest(ip, token), email, password)).answer
  /** The dashboard form: a server action calling loopback GraphQL with the visitor's signed identity. */
  const dashboardSignIn = async (email: string, password: string, ip: string) =>
    (await run({ headers: internalIdentityHeaders(ip), method: 'POST', url: '/api/graphql', socket: { remoteAddress: '127.0.0.1' } }, email, password)).answer
  /** The /oauth/connections and /oauth/authorize forms. */
  const oauthSignIn = async (email: string, password: string, ip: string) => {
    const request = new Request('https://vet.example/oauth/connections', { method: 'POST', headers: { 'x-real-ip': ip } })
    const r = await signInWithPassword(context, email, password, request)
    return 'setCookie' in r ? 'ok' : 'failed'
  }
  const signinRows = async () => Number(((await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM "RateLimitBucket" WHERE "key" LIKE 'signin:%'`)[0]).n)
  const age = (key: string) => prisma.$executeRaw`UPDATE "RateLimitBucket" SET "windowStart" = now() - make_interval(mins => ${SIGN_IN_WINDOW_MINUTES + 1}::int) WHERE "key" = ${key}`
  const resetBuckets = () => prisma.$executeRaw`DELETE FROM "RateLimitBucket"`

  beforeAll(async () => {
    prisma = testPrisma(4)
    await resetDatabase(prisma)
    const { getContext } = await import('@keystone-6/core/context')
    const PrismaModule = await import('@prisma/client')
    const config = (await import('../index')).default
    context = getContext(config as never, PrismaModule)
    // Five staff accounts, one per role the practice uses.
    for (const role of ['owner', 'dvm', 'rvt', 'pm', 'csr']) {
      const email = `${uniqueKey(role)}@cedarcreekvet.com`
      const user = await context.sudo().db.User.createOne({ data: { name: role, email, password: PASSWORD } })
      people.push(email)
      ids.push(user.id)
    }
  }, 120_000)
  afterAll(async () => { await prisma?.$disconnect() })

  it('five failures from one address refuse that address, with the same answer for a real or unknown account', async () => {
    await resetBuckets()
    const [victim] = people
    for (let i = 0; i < SIGN_IN_MAX_PER_EMAIL; i++) expect(await signIn(victim, `wrong-${i}`, '198.51.100.1')).toBe('Authentication failed.')
    expect(await signIn(victim, PASSWORD, '198.51.100.1')).toBe(SIGN_IN_LOCKED_MESSAGE)
    const ghost = `${uniqueKey('ghost')}@cedarcreekvet.com`
    for (let i = 0; i < SIGN_IN_MAX_PER_EMAIL; i++) expect(await signIn(ghost, `wrong-${i}`, '198.51.100.2')).toBe('Authentication failed.')
    expect(await signIn(ghost, PASSWORD, '198.51.100.2')).toBe(SIGN_IN_LOCKED_MESSAGE)
  })

  it('r8 #2: 100 wrong attempts at the owner from address A do not stop the owner signing in from address B', async () => {
    await resetBuckets()
    const [owner] = people
    const answers = new Set<string>()
    for (let i = 0; i < 100; i++) answers.add(await signIn(owner, `guess-${i}`, '203.0.113.66'))
    expect([...answers].sort()).toEqual(['Authentication failed.', SIGN_IN_LOCKED_MESSAGE].sort())
    // B has never signed in before and the attacker keeps going: the right password still works at once.
    expect(await signIn(owner, PASSWORD, '198.51.100.40')).toBe('ok')
    // Even from a never-seen address while the account count is high, a first attempt is never refused.
    for (let i = 0; i < 3; i++) await signIn(owner, 'wrong', `192.0.2.${100 + i}`)
    for (let i = 0; i < 20; i++) await signIn(owner, 'wrong', `198.18.1.${i + 1}`)
    expect(await signIn(owner, PASSWORD, '198.51.100.41')).toBe('ok')
    // A is still refused for this account (until its window ends).
    expect(await signIn(owner, PASSWORD, '203.0.113.66')).toBe(SIGN_IN_LOCKED_MESSAGE)
  }, 120_000)

  it('r8 #2: an address that signed in before, or a device still signed in, is not slowed by the account count', async () => {
    await resetBuckets()
    const [, dvm] = people
    const home = '198.51.100.50'
    const { token } = await run(apiRequest(home), dvm, PASSWORD)
    expect(token).toBeTruthy()
    // Many attackers push the account well past the slow-down point.
    for (let i = 0; i < 40; i++) await signIn(dvm, 'wrong', `198.18.2.${i + 1}`)
    const rows = await prisma.$queryRaw<{ count: number }[]>`SELECT "count" FROM "RateLimitBucket" WHERE "key" = ${accountBucketKey(ids[1])}`
    expect(rows[0]?.count).toBeGreaterThan(SIGN_IN_ACCOUNT_SLOW_AFTER)
    // Home: a typo, then the right password.
    expect(await signIn(dvm, 'typo', home)).toBe('Authentication failed.')
    expect(await signIn(dvm, PASSWORD, home)).toBe('ok')
    // A device with a valid session, from an address that has guessed past the limit.
    for (let i = 0; i < 7; i++) await signIn(dvm, 'wrong', '203.0.113.80')
    expect(await signIn(dvm, PASSWORD, '203.0.113.80')).toBe(SIGN_IN_LOCKED_MESSAGE)
    expect(await signIn(dvm, PASSWORD, '203.0.113.80', token)).toBe('ok')
  }, 120_000)

  it('r8 #2: brute force of one account is slowed to 10 plus 1 per attacking address per window', async () => {
    await resetBuckets()
    const [, , rvt] = people
    let checked = 0
    // 12 addresses, each trying as hard as it can (7 tries, in parallel per address).
    for (let a = 0; a < 12; a++) for (const r of await Promise.all(Array.from({ length: 7 }, (_, i) => signIn(rvt, `g${a}-${i}`, `100.64.${a}.1`)))) if (r === 'Authentication failed.') checked++
    expect(checked).toBeLessThanOrEqual(SIGN_IN_ACCOUNT_SLOW_AFTER + 12)
    // One address alone: at most 5 per window.
    await resetBuckets()
    checked = 0
    for (const r of await Promise.all(Array.from({ length: 30 }, (_, i) => signIn(rvt, `solo-${i}`, '100.64.200.1')))) if (r === 'Authentication failed.') checked++
    expect(checked).toBe(SIGN_IN_MAX_PER_EMAIL)
    // Its window over, the address gets 5 more, no more.
    await age(pairBucketKey(ids[2], clientAddress(apiRequest('100.64.200.1'))))
    await age(addressBucketKey(clientAddress(apiRequest('100.64.200.1'))!))
    checked = 0
    for (const r of await Promise.all(Array.from({ length: 15 }, (_, i) => signIn(rvt, `solo2-${i}`, '100.64.200.1')))) if (r === 'Authentication failed.') checked++
    expect(checked).toBe(SIGN_IN_MAX_PER_EMAIL)
  }, 180_000)

  it('r8 #2: a redeemed password reset clears the account and the right password works', async () => {
    await resetBuckets()
    const [, , , pm] = people
    const ip = '198.51.100.90'
    for (let i = 0; i < 7; i++) await signIn(pm, 'wrong', ip)
    expect(await signIn(pm, PASSWORD, ip)).toBe(SIGN_IN_LOCKED_MESSAGE)
    // Issue a reset token the way sendUserPasswordResetLink does, then redeem it.
    const token = 'reset-token-0123456789abcdefghij'
    await context.sudo().db.User.updateOne({ where: { id: ids[3] }, data: { passwordResetToken: token, passwordResetIssuedAt: new Date().toISOString(), passwordResetRedeemedAt: null } })
    const ctx = await context.withRequest(apiRequest(ip), res() as any)
    const NEW = 'a brand new password 42'
    const r = await ctx.graphql.raw({ query: 'mutation($e: String!, $t: String!, $p: String!) { redeemUserPasswordResetToken(email: $e, token: $t, password: $p) { code } }', variables: { e: pm, t: token, p: NEW } })
    expect(r.errors).toBeUndefined()
    expect(r.data?.redeemUserPasswordResetToken).toBeNull()
    expect(await signIn(pm, NEW, ip)).toBe('ok')
  })

  it('a success clears the account count; the count lives in the database and expires with its window', async () => {
    await resetBuckets()
    const [, , , , csr] = people
    for (let i = 0; i < SIGN_IN_MAX_PER_EMAIL - 1; i++) await signIn(csr, 'wrong', '203.0.113.5')
    expect(await signIn(csr, PASSWORD, '203.0.113.5')).toBe('ok')
    expect(await prisma.$queryRaw<unknown[]>`SELECT 1 FROM "RateLimitBucket" WHERE "key" IN (${accountBucketKey(ids[4])}, ${pairBucketKey(ids[4], clientAddress(apiRequest('203.0.113.5')))})`).toHaveLength(0)
    for (let i = 0; i < SIGN_IN_MAX_PER_EMAIL; i++) expect(await signIn(csr, 'wrong', '203.0.113.6')).toBe('Authentication failed.')
    expect(await signIn(csr, PASSWORD, '203.0.113.6')).toBe(SIGN_IN_LOCKED_MESSAGE)
    await age(pairBucketKey(ids[4], clientAddress(apiRequest('203.0.113.6'))))
    expect(await signIn(csr, PASSWORD, '203.0.113.6')).toBe('ok')
  })

  it('one address spraying many emails is refused after its own limit; staff elsewhere are unaffected', async () => {
    await resetBuckets()
    const ip = '192.0.2.200'
    for (let i = 0; i < SIGN_IN_MAX_PER_ADDRESS; i++) expect(await signIn(i % 2 ? `${uniqueKey('spray')}@example.com` : people[i % 5], 'wrong', ip)).toBe('Authentication failed.')
    expect(await signIn(`${uniqueKey('spray')}@example.com`, 'wrong', ip)).toBe(SIGN_IN_LOCKED_MESSAGE)
    expect(await signIn(people[2], PASSWORD, ip)).toBe(SIGN_IN_LOCKED_MESSAGE)
    expect(await signIn(people[2], PASSWORD, '192.0.2.201')).toBe('ok')
  })

  it('r8 #1 and #4: the API, the dashboard form and the OAuth form share one address count of 20', async () => {
    await resetBuckets()
    const ip = '203.0.113.150'
    expect(clientAddress({ headers: internalIdentityHeaders(ip), socket: { remoteAddress: '127.0.0.1' } })).toBe(clientAddress(apiRequest(ip)))
    const answers: string[] = []
    for (let i = 0; i < 21; i++) {
      const email = `${uniqueKey('mix')}@example.com`
      answers.push(i % 3 === 0 ? await signIn(email, 'wrong', ip) : i % 3 === 1 ? await dashboardSignIn(email, 'wrong', ip) : await oauthSignIn(email, 'wrong', ip))
    }
    const rows = await prisma.$queryRaw<{ count: number }[]>`SELECT "count" FROM "RateLimitBucket" WHERE "key" = ${addressBucketKey(clientAddress(apiRequest(ip))!)}`
    expect(rows[0]?.count).toBe(21)
    // All three paths now refuse a staff member's right password from this address (it never signed in from here).
    expect(await signIn(people[0], PASSWORD, ip)).toBe(SIGN_IN_LOCKED_MESSAGE)
    expect(await dashboardSignIn(people[0], PASSWORD, ip)).toBe(SIGN_IN_LOCKED_MESSAGE)
    expect(await oauthSignIn(people[0], PASSWORD, ip)).toBe('failed')
    // And from anywhere else, every path works.
    expect(await oauthSignIn(people[0], PASSWORD, '203.0.113.151')).toBe('ok')
    expect(await dashboardSignIn(people[0], PASSWORD, '203.0.113.152')).toBe('ok')
  }, 120_000)

  it('r8 #1: 25 OAuth-form misses all count against the address they came from', async () => {
    await resetBuckets()
    for (let i = 0; i < 25; i++) await oauthSignIn(`${uniqueKey('oauth')}@example.com`, 'wrong', '203.0.113.170')
    const rows = await prisma.$queryRaw<{ count: number }[]>`SELECT "count" FROM "RateLimitBucket" WHERE "key" = ${addressBucketKey(clientAddress(apiRequest('203.0.113.170'))!)}`
    expect(rows[0]?.count).toBe(25)
    expect(await oauthSignIn(people[0], PASSWORD, '203.0.113.170')).toBe('failed')
  }, 120_000)

  it('IPv6 addresses in one /64 share a count', async () => {
    expect(clientAddress(apiRequest('2001:db8:5:6::1'))).toBe(clientAddress(apiRequest('2001:db8:5:6:ffff:1:2:3')))
    expect(clientAddress(apiRequest('2001:db8:5:6::1'))).not.toBe(clientAddress(apiRequest('2001:db8:5:7::1')))
  })

  it('concurrent guesses cannot slip past the limit', async () => {
    await resetBuckets()
    const results = await Promise.all(Array.from({ length: 12 }, () => signIn(people[1], 'wrong', '198.18.0.1')))
    expect(results.filter(r => r === 'Authentication failed.')).toHaveLength(SIGN_IN_MAX_PER_EMAIL)
    expect(results.filter(r => r === SIGN_IN_LOCKED_MESSAGE)).toHaveLength(12 - SIGN_IN_MAX_PER_EMAIL)
  })

  it('r8 #3: 1000 unknown emails do not grow the table, and expired rows are swept on write', async () => {
    await resetBuckets()
    // 1000 unknown emails from one address: one address row and at most 20 email rows (written only inside its limit).
    const ip = '100.71.0.1'
    for (let c = 0; c < 20; c++) await Promise.all(Array.from({ length: 50 }, (_, i) => signIn(`nobody-${c}-${i}-${uniqueKey()}@example.com`, 'wrong', ip)))
    expect(await signinRows()).toBeLessThanOrEqual(1 + SIGN_IN_MAX_PER_ADDRESS)
    // 1000 more from the same, now locked, address add nothing at all.
    const before = await signinRows()
    for (let c = 0; c < 20; c++) await Promise.all(Array.from({ length: 50 }, (_, i) => signIn(`locked-${c}-${i}-${uniqueKey()}@example.com`, 'wrong', ip)))
    expect(await signinRows()).toBe(before)
    // Expired rows go away a few at a time as people keep signing in, with no timer.
    await prisma.$executeRaw`UPDATE "RateLimitBucket" SET "windowStart" = now() - interval '20 minutes'`
    expect(await signIn(people[0], PASSWORD, '100.71.0.2')).toBe('ok')
    const left = await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM "RateLimitBucket" WHERE "windowStart" < now() - interval '15 minutes'`
    expect(Number(left[0].n)).toBe(0)
  }, 300_000)

  it('r8 #3: the sweep is capped per request', async () => {
    await resetBuckets()
    await prisma.$executeRaw`INSERT INTO "RateLimitBucket" ("id", "key", "windowStart", "count") SELECT 'old' || g, 'signin:old:' || g, now() - interval '1 hour', 1 FROM generate_series(1, 120) g`
    await sweepExpired(prisma as any)
    expect(await signinRows()).toBe(120 - 50)
    await sweepExpired(prisma as any)
    await sweepExpired(prisma as any)
    expect(await signinRows()).toBe(0)
  })

  it('a request with no address shares one bucket (fails closed)', async () => {
    expect(clientAddress({ headers: {}, socket: { remoteAddress: '127.0.0.1' } })).toBe(clientAddress({ headers: {} }))
  })

  it('r8 #3: a remembered address survives the sweep until 90 days', async () => {
    await resetBuckets()
    expect(await signIn(people[0], PASSWORD, '198.51.100.200')).toBe('ok')
    await prisma.$executeRaw`UPDATE "RateLimitBucket" SET "windowStart" = now() - interval '30 days' WHERE "key" LIKE 'signin:known:%'`
    await sweepExpired(prisma as any)
    expect(await prisma.$queryRaw<unknown[]>`SELECT 1 FROM "RateLimitBucket" WHERE "key" LIKE 'signin:known:%'`).toHaveLength(1)
    await prisma.$executeRaw`UPDATE "RateLimitBucket" SET "windowStart" = now() - interval '91 days' WHERE "key" LIKE 'signin:known:%'`
    await sweepExpired(prisma as any)
    expect(await prisma.$queryRaw<unknown[]>`SELECT 1 FROM "RateLimitBucket" WHERE "key" LIKE 'signin:known:%'`).toHaveLength(0)
  })

  it('the bucket count can never be negative (CHECK)', async () => {
    await expect(prisma.$executeRaw`INSERT INTO "RateLimitBucket" ("id", "key", "windowStart", "count") VALUES ('neg', 'signin:test', now(), -1)`).rejects.toThrow()
  })
})
