/**
 * A model of the Stripe PaymentIntents API as documented, for tests: replaces global fetch for api.stripe.com only.
 * - POST /payment_intents with a key seen before: same parameters return the stored answer; different parameters are a 400 idempotency_error.
 * - A key can be "pruned" (Stripe forgets keys after about 24 h): the same key then creates a new intent.
 * - GET /payment_intents/:id, GET /payment_intents/search (metadata['k']:'v' OR …) and GET /payment_intents?limit=N.
 * `captured` is every amount the processor actually took.
 */
type Intent = { id: string; status: string; amount: number; amount_received: number; metadata: Record<string, string>; payment_method: string }

export function fakeStripe(opts: { status?: (params: Record<string, string>) => string } = {}) {
  const realFetch = globalThis.fetch
  const keys = new Map<string, { body: string; json: Intent }>()
  const intents: Intent[] = []
  const calls: string[] = []
  let n = 0
  let dropNext = 0
  const res = (status: number, json: unknown) => new Response(JSON.stringify(json), { status, headers: { 'content-type': 'application/json' } })
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url)
    if (!u.startsWith('https://api.stripe.com')) return realFetch(url as never, init)
    const path = u.replace('https://api.stripe.com/v1', '')
    const method = init?.method ?? 'GET'
    const key = new Headers(init?.headers).get('idempotency-key')
    const body = String(init?.body ?? '')
    const params = Object.fromEntries(new URLSearchParams(body))
    calls.push(`${method} ${path.split('?')[0]}${params.payment_method ? ` pm=${params.payment_method}` : ''}`)
    if (method === 'POST' && path === '/payment_intents') {
      const prev = key ? keys.get(key) : undefined
      if (prev) return prev.body === body ? res(200, prev.json) : res(400, { error: { type: 'idempotency_error', message: 'Keys for idempotent requests can only be used with the same parameters they were first used with.' } })
      const status = opts.status?.(params) ?? 'succeeded'
      const metadata = Object.fromEntries(Object.entries(params).filter(([k]) => k.startsWith('metadata[')).map(([k, v]) => [k.slice(9, -1), v]))
      const json: Intent = { id: `pi_fake_${++n}`, status, amount: Number(params.amount), amount_received: status === 'succeeded' ? Number(params.amount) : 0, metadata, payment_method: params.payment_method }
      intents.unshift(json)
      if (key) keys.set(key, { body, json })
      if (dropNext > 0) { dropNext -= 1; throw new TypeError('fetch failed') } // processed, the reply is lost
      return res(200, json)
    }
    if (method === 'GET' && path.startsWith('/payment_intents/search')) {
      const query = new URL(u).searchParams.get('query') ?? ''
      const wanted = [...query.matchAll(/metadata\['([^']+)'\]:'([^']*)'/g)].map(m => [m[1], m[2]] as const)
      return res(200, { object: 'search_result', data: intents.filter(i => wanted.some(([k, v]) => i.metadata[k] === v)) })
    }
    if (method === 'GET' && path.startsWith('/payment_intents?')) return res(200, { object: 'list', data: intents.slice(0, Number(new URL(u).searchParams.get('limit') ?? 10)) })
    const one = path.match(/^\/payment_intents\/([^/?]+)$/)
    if (method === 'GET' && one) {
      const i = intents.find(x => x.id === decodeURIComponent(one[1]))
      return i ? res(200, i) : res(404, { error: { type: 'invalid_request_error', code: 'resource_missing' } })
    }
    return res(404, { error: { type: 'invalid_request_error' } })
  }) as typeof fetch
  return {
    calls, intents,
    get captured() { return intents.reduce((s, i) => s + i.amount_received, 0) },
    posts: () => calls.filter(c => c.startsWith('POST /payment_intents')).length,
    loseNextReply() { dropNext += 1 },
    /** Stripe forgets idempotency keys after about 24 h, and its search index can miss an intent. */
    prune() { keys.clear() },
    hide(id: string) { const at = intents.findIndex(i => i.id === id); if (at >= 0) intents.splice(at, 1) },
    setStatus(id: string, status: string) { const i = intents.find(x => x.id === id); if (i) { i.status = status; if (status === 'succeeded') i.amount_received = i.amount } },
    restore() { globalThis.fetch = realFetch },
  }
}
