// Review r5/r6 refusals, live. Payloads stay here; prints only PASS/FAIL per check.
// Usage: CRAWL_BASE=... CRAWL_LOGINS=/path/logins.json node scripts/r6-attacks.mjs
import fs from 'node:fs'

const BASE = process.env.CRAWL_BASE
const people = JSON.parse(fs.readFileSync(process.env.CRAWL_LOGINS, 'utf8'))
async function gql(query, variables = {}, token) {
  const r = await fetch(BASE + '/api/graphql', { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { cookie: 'keystonejs-session=' + token } : {}) }, body: JSON.stringify({ query, variables }) })
  try { return await r.json() } catch { return { errors: [{ message: 'non-json ' + r.status }] } }
}
async function login(who) {
  const r = await gql('mutation($e:String!,$p:String!){authenticateUserWithPassword(email:$e,password:$p){... on UserAuthenticationWithPasswordSuccess{sessionToken}}}', { e: people[who].email, p: people[who].password })
  return r.data?.authenticateUserWithPassword?.sessionToken
}
const code = r => (r.errors ? (r.errors[0].extensions?.code || 'ERR') : 'ok')
const check = (name, ok, detail) => console.log(`CHECK ${name}: ${ok ? 'PASS' : 'FAIL'} (${detail})`)
const al = (n, f) => Array.from({ length: n }, (_, i) => f(i)).join(' ')
let failed = 0
const t = await login('associate')
const run = async (name, q, v, refused) => {
  const s = Date.now(); const r = await gql(q, v || {}, t); const c = code(r); const ms = Date.now() - s
  const ok = refused ? c === 'QUERY_TOO_BROAD' : c === 'ok'
  if (!ok) failed++
  check(name, ok, `${c} ${ms}ms`)
}

// r5 nested fan-out (must still be refused)
await run('nested aliases 100 under 500', `{p:patients(take:500){id ${al(100, i => `w${i}:weights{id}`)}}}`, {}, true)
await run('nested aliases 59 take1 under 500', `{p:patients(take:500){id ${al(59, i => `w${i}:weights(take:1){id}`)}}}`, {}, true)
await run('10 roots x 20 nested', `{${al(10, r => `r${r}:patients(take:500){${al(20, i => `w${i}:weights{id}`)}}`)}}`, {}, true)
await run('fragment hides nested aliases', `{p:patients(take:500){...F}} fragment F on Patient{${al(40, i => `w${i}:weights(take:10){id}`)}}`, {}, true)
await run('fragment spread repeated', `{p:patients(take:100){...F ...G}} fragment F on Patient{a:weights(take:30){id}} fragment G on Patient{b:weights(take:30){id} ...F}`, {}, true)
await run('inline fragments nested', `{p:patients(take:500){... on Patient{${al(20, i => `w${i}:weights(take:5){id}`)}}}}`, {}, true)
await run('variable take negative', 'query($n:Int!){p:patients(take:$n){id weights(take:$n){id}}}', { n: -500 }, true)
await run('variable take big', 'query($n:Int!){p:patients(take:$n){id weights(take:$n){id}}}', { n: 400 }, true)
await run('deep chain multiply', `{clients(take:50){ownerships(take:50){patient{weights(take:50){id}}}}}`, {}, true)
await run('relation chain through to-one then list', `{patients(take:100){ownerships(take:5){client{ownerships(take:20){patient{weights(take:5){id}}}}}}}`, {}, true)
await run('wide selection 61 scalars', `{patients(take:1){${al(61, i => `a${i}:id`)}}}`, {}, true)
await run('40 root aliases', `{${al(40, i => `a${i}:patients(take:500){id}`)}}`, {}, true)
// r6 #2/#3/#5
await run('count fields fan-out 500 x 59', `{p:patients(take:500){${al(59, i => `c${i}:weightsCount`)}}}`, {}, true)
await run('count fan-out 20 roots x 250 x 59', `{${al(20, r => `r${r}:patients(take:250,skip:${r * 10}){${al(59, i => `c${i}:weightsCount`)}}`)}}`, {}, true)
await run('distinct counts x 300 rows', `{patients(take:300){ownershipsCount alertsCount weightsCount microchipsCount vcprsCount insurancePoliciesCount a:alertsCount(where:{active:{equals:true}})}}`, {}, true)
await run('authenticatedItem union fan-out', `{authenticatedItem{... on User{staffMember{${al(55, i => `l${i}:licenses{id}`)}}}}}`, {}, true)
await run('introspection aliases', `{${al(50, i => `s${i}:__schema{types{name fields{name}}}`)}}`, {}, true)
await run('JSON resolver aliases', `{${al(15, i => `m${i}:policyMatrix`)}}`, {}, true)
// ordinary reads (must be allowed)
await run('ordinary nesting', `{patients(take:50){id weights(take:5){id} alerts(take:10){id}}}`, {}, false)
await run('wide selection 59 scalars', `{patients(take:1){${al(59, i => `a${i}:id`)}}}`, {}, false)
await run('one encounter by ref with sections', `{encounters(where:{ref:{equals:"ENC-2026-000008"}}){id sections{id} addenda{id}}}`, {}, false)
await run('one order by ref with administrations', `{clinicalOrders(where:{ref:{equals:"ORD-2026-000011"}}){id administrations{id}}}`, {}, false)
await run('single patient by id with weights', `query($i:ID!){patient(where:{id:$i}){id weights{id}}}`, { i: 'seed_pet_001_1' }, false)
await run('staff list', `{staffMembers{id}}`, {}, false)
await run('one introspection', `{__schema{types{name}}}`, {}, false)

// Two concurrent count fan-outs are refused fast; an ordinary count stays fast meanwhile.
const base = async () => { const s = Date.now(); await gql('{patientsCount}', {}, t); return Date.now() - s }
const idle = [await base(), await base(), await base()]
const heavyQ = `{${al(20, r => `r${r}:patients(take:250,skip:${r * 10}){${al(59, i => `c${i}:weightsCount`)}}`)}}`
const s0 = Date.now()
const heavy = Promise.all([gql(heavyQ, {}, t), gql(heavyQ, {}, t)])
const under = [await base(), await base(), await base()]
const hr = await heavy; const hms = Date.now() - s0
const fastRefused = hr.every(r => code(r) === 'QUERY_TOO_BROAD') && hms < 5000
if (!fastRefused) failed++
check('two concurrent count fan-outs refused fast', fastRefused, `${hr.map(code).join(',')} ${hms}ms`)
const fast = Math.max(...under) < Math.max(1000, 5 * Math.max(...idle))
if (!fast) failed++
check('ordinary patientsCount stays fast meanwhile', fast, `idle max ${Math.max(...idle)}ms, during max ${Math.max(...under)}ms`)

// r6 #4: the front desk does not read approval decision reasons for requests it cannot see.
const csr = await login('csr')
const a = await gql('{approvalDecisions(take:50){reason request{id}}}', {}, csr)
const ds = a.data?.approvalDecisions ?? []
const noLeak = !a.errors && ds.every(d => d.request)
if (!noLeak) failed++
check('front desk reads no decision without its request', noLeak, `decisions=${ds.length} orphaned=${ds.filter(d => !d.request).length}`)

console.log(`CHECK all refusals and ordinary reads: ${failed ? 'FAIL' : 'PASS'} (${failed} failed)`)
