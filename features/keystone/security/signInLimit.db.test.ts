import type { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { hasTestDatabase, resetDatabase, testPrisma, uniqueKey } from '../../../tests/helpers/db'
import { SIGN_IN_LOCKED_MESSAGE, SIGN_IN_MAX_PER_ADDRESS, SIGN_IN_MAX_PER_EMAIL, emailBucketKey } from './signInLimit'

/* Review r7 #2: failed sign-ins are limited per email and per address, in the database; a success clears them. */
describe.skipIf(!hasTestDatabase)('sign-in attempt limit (r7)', () => {
  let prisma: PrismaClient
  let context: any
  const PASSWORD = 'correct horse battery staple 7'
  const people: string[] = []
  const signIn = async (email: string, password: string, ip: string) => {
    const res = { setHeader() {}, getHeader() { return undefined } }
    const ctx = await context.withRequest({ headers: { 'x-real-ip': ip }, method: 'POST', url: '/api/graphql', socket: { remoteAddress: '10.0.0.9' } } as any, res as any)
    const r = await ctx.graphql.raw({ query: 'mutation($e: String!, $p: String!) { authenticateUserWithPassword(email: $e, password: $p) { ... on UserAuthenticationWithPasswordSuccess { sessionToken } ... on UserAuthenticationWithPasswordFailure { message } } }', variables: { e: email, p: password } })
    const a = r.data?.authenticateUserWithPassword
    return a?.sessionToken ? 'ok' : (a?.message ?? JSON.stringify(r.errors))
  }
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
      await context.sudo().db.User.createOne({ data: { name: role, email, password: PASSWORD } })
      people.push(email)
    }
  }, 120_000)
  afterAll(async () => { await prisma?.$disconnect() })

  it('the sixth failure for one email is refused, with the same answer for a real or unknown account', async () => {
    const [victim] = people
    for (let i = 0; i < SIGN_IN_MAX_PER_EMAIL; i++) expect(await signIn(victim, `wrong-${i}`, `198.51.100.${i + 1}`)).toBe('Authentication failed.')
    // Over the limit even with the right password and from a fresh address.
    expect(await signIn(victim, PASSWORD, '198.51.100.77')).toBe(SIGN_IN_LOCKED_MESSAGE)
    const ghost = `${uniqueKey('ghost')}@cedarcreekvet.com`
    for (let i = 0; i < SIGN_IN_MAX_PER_EMAIL; i++) await signIn(ghost, `wrong-${i}`, `198.51.100.${i + 20}`)
    expect(await signIn(ghost, PASSWORD, '198.51.100.78')).toBe(SIGN_IN_LOCKED_MESSAGE)
  })

  it('every other role still signs in right away, from the attacking address too', async () => {
    for (const email of people.slice(1)) expect(await signIn(email, PASSWORD, '198.51.100.1')).toBe('ok')
  })

  it('the count lives in the database and the email works again once its window has passed', async () => {
    const [victim] = people
    const rows = await prisma.$queryRaw<{ count: number }[]>`SELECT "count" FROM "RateLimitBucket" WHERE "key" = ${emailBucketKey(victim)}`
    expect(rows[0]?.count).toBeGreaterThan(SIGN_IN_MAX_PER_EMAIL)
    await prisma.$executeRaw`UPDATE "RateLimitBucket" SET "windowStart" = now() - interval '16 minutes' WHERE "key" = ${emailBucketKey(victim)}`
    expect(await signIn(victim, PASSWORD, '198.51.100.79')).toBe('ok')
  })

  it('a success clears the email count', async () => {
    const [, dvm] = people
    for (let i = 0; i < SIGN_IN_MAX_PER_EMAIL - 1; i++) await signIn(dvm, 'wrong', '203.0.113.5')
    expect(await signIn(dvm, PASSWORD, '203.0.113.5')).toBe('ok')
    expect(await prisma.$queryRaw<unknown[]>`SELECT 1 FROM "RateLimitBucket" WHERE "key" = ${emailBucketKey(dvm)}`).toHaveLength(0)
    for (let i = 0; i < SIGN_IN_MAX_PER_EMAIL; i++) expect(await signIn(dvm, 'wrong', '203.0.113.5')).toBe('Authentication failed.')
    expect(await signIn(dvm, PASSWORD, '203.0.113.5')).toBe(SIGN_IN_LOCKED_MESSAGE)
  })

  it('one address spraying many emails is refused after its own limit', async () => {
    const ip = '192.0.2.200'
    for (let i = 0; i < SIGN_IN_MAX_PER_ADDRESS; i++) expect(await signIn(`${uniqueKey('spray')}@example.com`, 'wrong', ip)).toBe('Authentication failed.')
    expect(await signIn(`${uniqueKey('spray')}@example.com`, 'wrong', ip)).toBe(SIGN_IN_LOCKED_MESSAGE)
    // The same people sign in fine from anywhere else.
    expect(await signIn(people[2], PASSWORD, '192.0.2.201')).toBe('ok')
  })

  it('concurrent guesses cannot slip past the limit', async () => {
    const email = `${uniqueKey('race')}@example.com`
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => signIn(email, 'wrong', `198.18.0.${i + 1}`)))
    expect(results.filter(r => r === 'Authentication failed.')).toHaveLength(SIGN_IN_MAX_PER_EMAIL)
    expect(results.filter(r => r === SIGN_IN_LOCKED_MESSAGE)).toHaveLength(12 - SIGN_IN_MAX_PER_EMAIL)
  })

})
