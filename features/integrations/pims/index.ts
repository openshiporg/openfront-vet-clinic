/*
 * PIMS import adapters (INTEGRATIONS §10). Moving a practice off Avimark or ezyVet is the first
 * thing a clinic asks for, so the importer is part of the core product.
 *
 *   manual (default)  a CSV export the practice downloads from its current system and uploads here.
 *                     Avimark exports CSV from its report and export tools, or DBF tables converted to CSV;
 *                     ezyVet exports CSV from its reports. Header names differ by version and by the
 *                     report used, so each field accepts several header aliases and the batch can carry
 *                     an explicit mapping (header → field) that overrides them. (verify exact headers
 *                     against a real export from each system)
 *   ezyvet-api        ezyVet's REST API (OAuth client credentials, partner access) pages the same
 *                     entities as JSON; rows are normalised to the same field names, so validation and
 *                     apply are shared. (verify endpoint paths and partner terms)
 *
 * Nothing here writes to the database: adapters only produce normalised rows.
 */

export type PimsSystem = 'ezyvet' | 'avimark' | 'csv'
export type ImportEntity = 'clients' | 'patients' | 'weights' | 'vaccinations' | 'reminders' | 'consults'
export type Row = Record<string, string>

/** RFC 4180 CSV: quoted fields, doubled quotes, CRLF or LF, embedded newlines. */
export function parseCsv(input: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const text = input.replace(/^\uFEFF/, '')
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else quoted = false
      } else field += c
      continue
    }
    if (c === '"' && field === '') quoted = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.some(v => v.trim() !== '')) rows.push(row)
      row = []
    } else field += c
  }
  if (quoted) throw new Error('The file ends inside a quoted field.')
  row.push(field)
  if (row.some(v => v.trim() !== '')) rows.push(row)
  return rows
}

const norm = (h: string) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** Field → header aliases, by system. Shared aliases cover generic CSVs. (verify per system) */
export const FIELD_ALIASES: Record<ImportEntity, Record<string, { required?: boolean; aliases: Partial<Record<PimsSystem | 'any', string[]>> }>> = {
  clients: {
    externalId: { required: true, aliases: { ezyvet: ['contact id', 'contact code'], avimark: ['client number', 'client id', 'client'], any: ['id', 'external id', 'client id'] } },
    firstName: { required: true, aliases: { ezyvet: ['first name'], avimark: ['first name', 'first'], any: ['first name', 'firstname', 'given name'] } },
    lastName: { required: true, aliases: { ezyvet: ['last name', 'surname'], avimark: ['last name', 'last'], any: ['last name', 'lastname', 'surname', 'family name'] } },
    mobile: { aliases: { ezyvet: ['mobile', 'mobile phone'], avimark: ['cell phone', 'cell'], any: ['mobile', 'cell', 'cell phone', 'mobile phone'] } },
    phone: { aliases: { ezyvet: ['phone', 'home phone'], avimark: ['phone', 'home phone', 'phone 1'], any: ['phone', 'home phone', 'telephone'] } },
    email: { aliases: { ezyvet: ['email', 'email address'], avimark: ['email', 'e mail'], any: ['email', 'email address'] } },
    address: { aliases: { ezyvet: ['street address', 'address 1'], avimark: ['address', 'address 1'], any: ['address', 'address line 1', 'street'] } },
    city: { aliases: { ezyvet: ['suburb', 'city'], avimark: ['city'], any: ['city', 'town'] } },
    postalCode: { aliases: { ezyvet: ['postcode', 'zip'], avimark: ['zip', 'zip code'], any: ['zip', 'postal code', 'postcode'] } },
    marketingConsent: { aliases: { any: ['marketing consent', 'email marketing opt in', 'marketing opt in'] } },
  },
  patients: {
    externalId: { required: true, aliases: { ezyvet: ['animal id', 'animal code'], avimark: ['patient number', 'patient id', 'animal id'], any: ['id', 'patient id', 'animal id'] } },
    clientExternalId: { required: true, aliases: { ezyvet: ['contact id', 'owner id'], avimark: ['client number', 'client id'], any: ['client id', 'owner id'] } },
    name: { required: true, aliases: { any: ['name', 'animal name', 'patient name', 'pet name'] } },
    species: { required: true, aliases: { any: ['species'] } },
    breed: { aliases: { any: ['breed'] } },
    sex: { aliases: { any: ['sex', 'gender'] } },
    dateOfBirth: { aliases: { any: ['date of birth', 'dob', 'birth date', 'birthday'] } },
    microchip: { aliases: { any: ['microchip', 'microchip number', 'chip', 'rfid'] } },
    deceased: { aliases: { any: ['deceased', 'is deceased', 'dead'] } },
  },
  weights: {
    patientExternalId: { required: true, aliases: { ezyvet: ['animal id'], avimark: ['patient number', 'patient id'], any: ['patient id', 'animal id'] } },
    date: { required: true, aliases: { any: ['date', 'weight date', 'recorded'] } },
    weight: { required: true, aliases: { any: ['weight', 'value'] } },
    unit: { aliases: { any: ['unit', 'units', 'weight unit'] } },
  },
  vaccinations: {
    patientExternalId: { required: true, aliases: { ezyvet: ['animal id'], avimark: ['patient number', 'patient id'], any: ['patient id', 'animal id'] } },
    vaccine: { required: true, aliases: { any: ['vaccine', 'vaccination', 'product', 'item', 'description'] } },
    givenOn: { required: true, aliases: { any: ['date given', 'given', 'date', 'administered'] } },
    dueOn: { aliases: { any: ['due', 'due date', 'next due', 'expires'] } },
    lotNumber: { aliases: { any: ['lot', 'lot number', 'serial', 'batch'] } },
    tagNumber: { aliases: { any: ['tag', 'tag number', 'rabies tag'] } },
  },
  reminders: {
    patientExternalId: { required: true, aliases: { ezyvet: ['animal id'], avimark: ['patient number', 'patient id'], any: ['patient id', 'animal id'] } },
    reminder: { required: true, aliases: { any: ['reminder', 'reminder type', 'description', 'service'] } },
    dueOn: { required: true, aliases: { any: ['due', 'due date', 'date due'] } },
  },
  consults: {
    externalId: { required: true, aliases: { ezyvet: ['consult id'], avimark: ['medical history id', 'entry id'], any: ['id', 'visit id', 'consult id'] } },
    patientExternalId: { required: true, aliases: { ezyvet: ['animal id'], avimark: ['patient number', 'patient id'], any: ['patient id', 'animal id'] } },
    date: { required: true, aliases: { any: ['date', 'visit date', 'consult date'] } },
    vet: { aliases: { any: ['vet', 'veterinarian', 'doctor', 'clinician'] } },
    reason: { aliases: { any: ['reason', 'presenting complaint', 'complaint'] } },
    notes: { required: true, aliases: { any: ['notes', 'history', 'medical notes', 'text', 'soap'] } },
  },
}

export type Mapping = Record<string, string>
export type ParsedFile = { headers: string[]; mapping: Mapping; rows: { rowNumber: number; values: Row }[]; missingRequired: string[] }

/** Resolve headers to fields (explicit mapping first, then system aliases, then generic aliases). */
export function mapHeaders(system: PimsSystem, entity: ImportEntity, headers: string[], explicit: Mapping = {}): { mapping: Mapping; missingRequired: string[] } {
  const spec = FIELD_ALIASES[entity]
  const byNorm = new Map(headers.map(h => [norm(h), h]))
  const mapping: Mapping = {}
  for (const [header, field] of Object.entries(explicit)) if (field in spec && byNorm.has(norm(header))) mapping[field] = byNorm.get(norm(header))!
  for (const [field, def] of Object.entries(spec)) {
    if (mapping[field]) continue
    const candidates = [...(def.aliases[system] ?? []), ...(def.aliases.any ?? []), field]
    const hit = candidates.map(norm).find(c => byNorm.has(c))
    if (hit) mapping[field] = byNorm.get(hit)!
  }
  const missingRequired = Object.entries(spec).filter(([f, d]) => d.required && !mapping[f]).map(([f]) => f)
  return { mapping, missingRequired }
}

export function parseExport(system: PimsSystem, entity: ImportEntity, csv: string, explicit: Mapping = {}): ParsedFile {
  const table = parseCsv(csv)
  if (!table.length) throw new Error('The file is empty.')
  const headers = table[0].map(h => h.trim())
  const { mapping, missingRequired } = mapHeaders(system, entity, headers, explicit)
  const index = new Map(headers.map((h, i) => [h, i]))
  const rows = table.slice(1).map((cells, i) => {
    const values: Row = {}
    for (const [field, header] of Object.entries(mapping)) values[field] = (cells[index.get(header)!] ?? '').trim()
    return { rowNumber: i + 2, values }
  })
  return { headers, mapping, rows, missingRequired }
}

/** US exports use M/D/YYYY; ISO is accepted as-is. Returns YYYY-MM-DD or null. */
export function importDate(value: string): string | null {
  const v = value.trim()
  if (!v) return null
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(v)
  if (m) {
    const year = m[3].length === 2 ? (Number(m[3]) > 50 ? 1900 : 2000) + Number(m[3]) : Number(m[3])
    const iso = `${year}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
    const d = new Date(`${iso}T00:00:00Z`)
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : null
  }
  return null
}

export const SPECIES_ALIASES: Record<string, string> = {
  canine: 'dog', dog: 'dog', k9: 'dog', feline: 'cat', cat: 'cat', equine: 'horse', horse: 'horse', rabbit: 'rabbit', lagomorph: 'rabbit',
  avian: 'bird', bird: 'bird', ferret: 'ferret', reptile: 'reptile', 'pocket pet': 'small_mammal', rodent: 'small_mammal',
}

export function importSex(value: string): { sex: string; reproductiveStatus: string } {
  const v = norm(value)
  const map: Record<string, [string, string]> = {
    m: ['male', 'intact'], male: ['male', 'intact'], mi: ['male', 'intact'], 'male intact': ['male', 'intact'], mn: ['male', 'neutered'], 'male neutered': ['male', 'neutered'], 'male castrated': ['male', 'neutered'], cm: ['male', 'neutered'], n: ['male', 'neutered'],
    f: ['female', 'intact'], female: ['female', 'intact'], fi: ['female', 'intact'], 'female intact': ['female', 'intact'], fs: ['female', 'spayed'], 'female spayed': ['female', 'spayed'], s: ['female', 'spayed'],
  }
  const hit = map[v]
  return hit ? { sex: hit[0], reproductiveStatus: hit[1] } : { sex: 'unknown', reproductiveStatus: 'unknown' }
}

export const truthy = (v: string) => ['y', 'yes', 'true', '1', 'x'].includes(v.trim().toLowerCase())

/** A source returns normalised rows for one entity. Manual: rows come from an uploaded CSV. */
export type PimsSource = {
  key: 'manual-csv' | 'ezyvet-api'
  channel: 'csv' | 'api'
  rows(input: { system: PimsSystem; entity: ImportEntity; csv?: string | null; mapping?: Mapping; since?: string | null }): Promise<ParsedFile>
}

export const manualCsvSource: PimsSource = {
  key: 'manual-csv',
  channel: 'csv',
  async rows({ system, entity, csv, mapping }) {
    if (!csv?.trim()) throw new Error('Paste or upload the exported CSV.')
    return parseExport(system, entity, csv, mapping)
  },
}

/** ezyVet API: OAuth client credentials; each entity pages through `/v1/<resource>`. (verify) */
export function ezyvetApiSource(config: { baseUrl: string; partnerId: string; clientId: string; clientSecret: string; siteUid: string; fetchImpl?: typeof fetch }): PimsSource {
  const f = config.fetchImpl ?? fetch
  const resource: Record<ImportEntity, { path: string; map: (r: Record<string, unknown>) => Row }> = {
    clients: { path: 'contact', map: r => ({ externalId: String(r.id ?? ''), firstName: String(r.first_name ?? ''), lastName: String(r.last_name ?? ''), email: '', mobile: '', phone: '' }) },
    patients: { path: 'animal', map: r => ({ externalId: String(r.id ?? ''), clientExternalId: String(r.contact_id ?? ''), name: String(r.name ?? ''), species: String(r.species_id ?? ''), breed: String(r.breed_id ?? ''), sex: String(r.sex_id ?? ''), dateOfBirth: String(r.date_of_birth ?? ''), microchip: String(r.microchip_number ?? ''), deceased: r.is_dead ? 'yes' : '' }) },
    weights: { path: 'healthstatus', map: r => ({ patientExternalId: String(r.animal_id ?? ''), date: String(r.date ?? ''), weight: String(r.weight ?? ''), unit: 'kg' }) },
    vaccinations: { path: 'vaccination', map: r => ({ patientExternalId: String(r.animal_id ?? ''), vaccine: String(r.name ?? ''), givenOn: String(r.date_of_vaccination ?? ''), dueOn: String(r.date_of_next_due ?? ''), lotNumber: String(r.batch_number ?? '') }) },
    reminders: { path: 'reminder', map: r => ({ patientExternalId: String(r.animal_id ?? ''), reminder: String(r.description ?? ''), dueOn: String(r.due_at ?? '') }) },
    consults: { path: 'consult', map: r => ({ externalId: String(r.id ?? ''), patientExternalId: String(r.animal_id ?? ''), date: String(r.date ?? ''), vet: '', reason: String(r.presenting_problem ?? ''), notes: String(r.notes ?? '') }) },
  }
  async function token() {
    const res = await f(`${config.baseUrl}/v1/oauth/access_token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ partner_id: config.partnerId, client_id: config.clientId, client_secret: config.clientSecret, grant_type: 'client_credentials', scope: 'read-contact,read-animal,read-vaccination,read-reminder,read-consult,read-healthstatus' }) })
    if (!res.ok) throw new Error(`ezyVet sign-in failed (${res.status}).`)
    return ((await res.json()) as { access_token: string }).access_token
  }
  return {
    key: 'ezyvet-api',
    channel: 'api',
    async rows({ entity, since }) {
      const spec = resource[entity]
      const bearer = await token()
      const rows: { rowNumber: number; values: Row }[] = []
      for (let page = 1; page <= 500; page++) {
        const url = new URL(`${config.baseUrl}/v1/${spec.path}`)
        url.searchParams.set('limit', '200')
        url.searchParams.set('page', String(page))
        if (since) url.searchParams.set('modified_at', JSON.stringify({ '>': Math.floor(Date.parse(since) / 1000) }))
        const res = await f(url, { headers: { authorization: `Bearer ${bearer}` } })
        if (!res.ok) throw new Error(`ezyVet ${spec.path} page ${page} failed (${res.status}).`)
        const body = (await res.json()) as { items?: Record<string, Record<string, unknown>>[]; meta?: { items_page_total?: number } }
        for (const item of body.items ?? []) rows.push({ rowNumber: rows.length + 1, values: spec.map(Object.values(item)[0] ?? {}) })
        if (!body.items?.length || page >= (body.meta?.items_page_total ?? page)) break
      }
      return { headers: [], mapping: {}, rows, missingRequired: [] }
    },
  }
}

let override: Partial<Record<'manual-csv' | 'ezyvet-api', PimsSource>> = {}
export function setPimsSource(source: PimsSource) { override = { ...override, [source.key]: source } }
export function pimsSource(key: 'manual-csv' | 'ezyvet-api' = 'manual-csv'): PimsSource {
  if (override[key]) return override[key]!
  if (key === 'ezyvet-api') {
    const env = process.env
    if (!env.EZYVET_CLIENT_ID || !env.EZYVET_CLIENT_SECRET || !env.EZYVET_PARTNER_ID || !env.EZYVET_SITE_UID) throw new Error('The ezyVet API is not connected. Add the ezyVet partner credentials, or upload a CSV export.')
    return ezyvetApiSource({ baseUrl: env.EZYVET_API_URL || 'https://api.ezyvet.com', partnerId: env.EZYVET_PARTNER_ID, clientId: env.EZYVET_CLIENT_ID, clientSecret: env.EZYVET_CLIENT_SECRET, siteUid: env.EZYVET_SITE_UID })
  }
  return manualCsvSource
}
