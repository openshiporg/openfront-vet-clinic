// Review r6 proof: load every staff page as each role and print only PASS/FAIL per page.
// Usage: CRAWL_BASE=https://vet-clinic.openship.org CRAWL_LOGINS=/path/to/logins.json node scripts/r6-crawl.mjs [roles...]
// CRAWL_LOGINS is a JSON file { "<role>": { "email": "...", "password": "..." } } kept outside the repo.
import fs from 'node:fs'
import { chromium } from '/Users/junaid/Code/vibeghost/vibeghost/node_modules/playwright/index.mjs'

const BASE = process.env.CRAWL_BASE
const people = JSON.parse(fs.readFileSync(process.env.CRAWL_LOGINS, 'utf8'))
const roles = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(people)
const OUT = process.env.CRAWL_OUT

async function gql(query, cookie) {
  const r = await fetch(BASE + '/api/graphql', { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify({ query }) })
  return r.json()
}
async function token(who) {
  const p = people[who]
  const r = await fetch(BASE + '/api/graphql', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: 'mutation($e:String!,$p:String!){authenticateUserWithPassword(email:$e,password:$p){... on UserAuthenticationWithPasswordSuccess{sessionToken}}}', variables: { e: p.email, p: p.password } }) })
  return (await r.json()).data?.authenticateUserWithPassword?.sessionToken
}

const own = await token('owner')
const cookie = 'keystonejs-session=' + own
const dr = (await gql(`{patients(take:1,orderBy:{ref:asc}){id} clients(take:1,orderBy:{ref:asc}){id} hospitalStays(take:1){id} anaesthesiaRecords(take:1){id} rabiesCertificates(take:1){id} callRecords(take:1){id} encounters(take:2,orderBy:{ref:asc}){id}
  bigC: clients(take:300){id ownershipsCount} bigP: encounters(take:500){patient{id}}}`, cookie)); if (!dr.data) { console.log("CHECK crawl id lookup: FAIL (" + (dr.errors?.[0]?.extensions?.code ?? "ERR") + ")"); process.exit(1) }; const d = dr.data
const bigClient = [...d.bigC].sort((a, b) => b.ownershipsCount - a.ownershipsCount)[0]?.id
const tally = {}; for (const e of d.bigP) if (e.patient) tally[e.patient.id] = (tally[e.patient.id] ?? 0) + 1
const bigPatient = Object.entries(tally).sort((a, b) => b[1] - a[1])[0]?.[0]
const sections = ['today', 'schedule', 'whiteboard', 'hospital', 'patients', 'clients', 'encounters', 'vaccines', 'imports', 'approvals', 'team', 'agents', 'waitlist', 'calls', 'messages', 'records-requests', 'compliance', 'audit', 'read-audit', 'policies', 'settings']
const extra = {
  patient: 'patients/' + d.patients[0].id, bigPatient: bigPatient && 'patients/' + bigPatient,
  client: 'clients/' + d.clients[0].id, bigClient: bigClient && 'clients/' + bigClient,
  stay: d.hospitalStays[0] && 'hospital?stay=' + d.hospitalStays[0].id, ane: d.anaesthesiaRecords[0] && 'anaesthesia/' + d.anaesthesiaRecords[0].id,
  cert: d.rabiesCertificates[0] && 'vaccines/certificates/' + d.rabiesCertificates[0].id, call: d.callRecords[0] && 'calls/' + d.callRecords[0].id,
  enc1: d.encounters[0] && 'encounters/' + d.encounters[0].id, enc2: d.encounters[1] && 'encounters/' + d.encounters[1].id,
}
// Roles without clinical-record read (practice manager, front desk) get a 404 on one clinical record by design:
// the encounter, the anaesthesia record and the rabies certificate.
const CLINICAL = new Set([extra.enc1, extra.enc2, extra.ane, extra.cert].filter(Boolean))
const NO_CLINICAL_READ = new Set(['practice', 'csr'])
const paths = [...sections, ...Object.values(extra).filter(Boolean)]
if (OUT) fs.writeFileSync(OUT + '-ids.json', JSON.stringify(extra, null, 1))

const b = await chromium.launch({ executablePath: process.env.HOME + '/Library/Caches/ms-playwright/chromium_headless_shell-1254/chrome-headless-shell-mac-arm64/chrome-headless-shell' })
const res = {}
let bad = 0
for (const role of roles) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true })
  const p = await ctx.newPage()
  await p.goto(BASE + '/dashboard/signin')
  await p.fill('input[name=email]', people[role].email)
  await p.fill('input[name=password]', people[role].password)
  await Promise.all([p.waitForURL(u => !u.pathname.includes('signin'), { timeout: 30000 }), p.click('button[type=submit]')])
  for (const path of paths) {
    const r = await p.goto(BASE + '/dashboard/platform/' + path, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => null)
    const txt = await p.evaluate(() => document.body.innerText).catch(() => '')
    const http = r?.status() ?? 0
    const broken = /could not be found|this page could not be loaded|something went wrong|application error|QUERY_TOO_BROAD|too broad/i.test(txt)
    const expect404 = NO_CLINICAL_READ.has(role) && CLINICAL.has(path)
    const ok = expect404 ? http === 404 : http === 200 && !broken
    res[`${role} ${path}`] = { http, broken, expect404 }
    if (!ok) bad++
    const name = Object.entries(extra).find(([, v]) => v === path)?.[0] ?? path
    console.log(`CHECK ${role} ${name}: ${ok ? 'PASS' : 'FAIL'} (${http}${expect404 ? ' expected 404' : ''})`)
  }
  await ctx.close()
}
await b.close()
if (OUT) fs.writeFileSync(OUT + '.json', JSON.stringify(res, null, 1))
console.log(`CHECK all staff pages: ${bad ? 'FAIL' : 'PASS'} (${Object.keys(res).length} loads, ${bad} failed)`)
