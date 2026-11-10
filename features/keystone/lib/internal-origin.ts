import { signInternalClientIdentity } from '../security/internalIdentity'

/**
 * Server-side GraphQL calls go to this process over loopback instead of the public host, so they
 * stop sharing the platform's egress IP rate-limit bucket. Request Host/forwarded headers are
 * never inputs to the origin.
 */
export function loopbackOrigin(port: string | undefined = process.env.PORT): string | null {
  const value = String(port ?? '').trim()
  const portNumber = /^\d{1,5}$/.test(value) ? Number.parseInt(value, 10) : 0
  if (portNumber < 1 || portNumber > 65535) return null
  return `http://127.0.0.1:${value}`
}

export function internalGraphqlEndpoint(port?: string): string | null {
  const origin = loopbackOrigin(port)
  return origin ? `${origin}/api/graphql` : null
}

type HeaderReader = { get(name: string): string | null }

/**
 * One value per client: an IPv4 address as is (an IPv4-mapped IPv6 address becomes IPv4), an IPv6
 * address cut to its /64, because one host or home line usually holds a whole /64.
 */
export function normalizeAddress(address: string): string {
  let value = address.trim().toLowerCase().replace(/^\[|\](?::\d+)?$/g, '').replace(/%.*$/, '')
  const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) return mapped[1]
  if (!value.includes(':')) return value
  const [head, tail = ''] = value.split('::')
  const left = head ? head.split(':') : []
  const right = value.includes('::') ? (tail ? tail.split(':') : []) : []
  const groups = value.includes('::') ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right] : left
  if (groups.length !== 8 || !groups.every(g => /^[0-9a-f]{1,4}$/.test(g))) return value
  value = groups.slice(0, 4).map(g => g.replace(/^0+(?=.)/, '')).join(':')
  return `${value}::/64`
}

/**
 * The END user's real client address from the incoming request (x-real-ip on Railway), so every
 * visitor keeps their own bucket. Never a constant shared by all visitors.
 */
export function clientSourceFromHeaders(headers: HeaderReader | null | undefined): string | null {
  if (!headers) return null
  const realIp = (headers.get('x-real-ip') || '').split(',')[0]?.trim()
  if (realIp) return normalizeAddress(realIp)
  const forwarded = (headers.get('x-forwarded-for') || '').split(',')[0]?.trim()
  return forwarded ? normalizeAddress(forwarded) : null
}

/** Signed identity headers, or {} (unsigned, today's behaviour) when no source/secret. Never throws. */
export function internalIdentityHeaders(
  source: string | null | undefined,
  secret: string = String(process.env.SESSION_SECRET || ''),
  now = Date.now(),
): Record<string, string> {
  try {
    if (!source) return {}
    const signed = signInternalClientIdentity(source, secret, now)
    if (!signed) return {}
    return {
      'x-openfront-client-identity': signed.identity,
      'x-openfront-client-timestamp': signed.timestamp,
      'x-openfront-client-signature': signed.signature,
    }
  } catch {
    return {}
  }
}

const INTERNAL_GRAPHQL_TIMEOUT_MS = 10_000

/** A fetch for loopback GraphQL: same endpoint only, no redirects, timeout, fresh signature per call. */
export function createInternalGraphqlFetch(source: string | null | undefined, endpoint: string): typeof fetch {
  const target = new URL(endpoint)
  return async (input, init) => {
    const rawUrl = input instanceof Request ? input.url : String(input)
    const url = new URL(rawUrl, target)
    if (url.origin !== target.origin || url.pathname !== target.pathname || url.username || url.password) {
      throw new Error('Internal GraphQL requests must target the loopback GraphQL endpoint')
    }
    const headers = new Headers(init?.headers)
    for (const [name, value] of Object.entries(internalIdentityHeaders(source))) headers.set(name, value)
    const controller = new AbortController()
    const callerSignal = init?.signal
    const abortWithCaller = () => controller.abort(callerSignal?.reason)
    if (callerSignal?.aborted) abortWithCaller()
    else callerSignal?.addEventListener('abort', abortWithCaller, { once: true })
    const timeout = setTimeout(() => controller.abort(new Error('Internal GraphQL request timed out')), INTERNAL_GRAPHQL_TIMEOUT_MS)
    try {
      return await fetch(url, { ...init, headers, signal: controller.signal, redirect: 'error' })
    } finally {
      clearTimeout(timeout)
      callerSignal?.removeEventListener('abort', abortWithCaller)
    }
  }
}

/** Adds the signed end-user identity of the incoming request to the headers of a loopback GraphQL call. */
export function applyInternalIdentity(target: Headers, incoming: HeaderReader | null | undefined): Headers {
  for (const [name, value] of Object.entries(internalIdentityHeaders(clientSourceFromHeaders(incoming)))) target.set(name, value)
  return target
}

/**
 * A fetch for server-side GraphQL clients that live longer than one request: the visitor's address is
 * read from the current request at call time and signed per call. Browser calls are left untouched.
 */
export function withRequestIdentity(
  inner: typeof fetch = fetch,
  currentRequestHeaders: () => Promise<HeaderReader | null | undefined> = async () => (await import('next/headers')).headers(),
): typeof fetch {
  // The visitor is read from the CURRENT request on every call, never captured when a client is built,
  // so a cached/singleton GraphQL client can never pin the first visitor's identity.
  return async (input, init) => {
    if (typeof window !== 'undefined') return inner(input, init)
    const headers = new Headers(init?.headers)
    try {
      applyInternalIdentity(headers, await currentRequestHeaders())
    } catch {
      // No request scope: send unsigned, as before.
    }
    return inner(input, { ...init, headers })
  }
}
