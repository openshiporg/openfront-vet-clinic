/**
 * Openfront Vet Clinic MCP domain tools (INTEGRATIONS §10). The generic createData/updateData/
 * deleteData tools are gone: an agent can only call a named domain operation. Each one is a single
 * GraphQL document that checks permission and agent grants on the server, takes an idempotency key
 * when it writes, is audited, and (when it reads clinical data) writes a ReadAudit row.
 * Tool names use underscores (MCP clients require ^[A-Za-z0-9_-]+$): `client_find` is the catalogue's
 * `client.find`.
 *
 * Never exposed (I-G4), enforced by NEVER_TOOL_PATTERNS and tests/mcp-registry.test.ts: VCPR,
 * prescription signing and refill decisions, record signing and addenda, any controlled-substance
 * operation or register read, euthanasia, discounts, refunds, write-offs, fee/policy/protocol
 * publishing, record merges and card data. Tool calls never approve anything.
 */

export type DomainTool = {
  name: string
  description: string
  inputSchema: { type: 'object'; properties: Record<string, object>; required: string[]; additionalProperties?: boolean }
  /** GraphQL document; variables come from the validated arguments. */
  document: string
  /** Field of the GraphQL result to return. */
  field: string
  writes: boolean
  /** The tool returns clinical or client data, so the server writes a ReadAudit row for each call. */
  readsClinical?: boolean
}

/**
 * Operations an agent can never reach (I-G4). A registered tool whose name or GraphQL document
 * matches any of these fails registration and the registry test.
 */
export const NEVER_TOOL_PATTERNS: { pattern: RegExp; why: string }[] = [
  { pattern: /vcpr/i, why: 'VCPR is established only by a DVM examination' },
  { pattern: /sign_?(prescription|rx|encounter|record|soap|section)|prescri(be|ption_?sign)|write_?prescription|addend/i, why: 'prescribing and record signing are licensed human acts' },
  { pattern: /(approve|deny|decide)_?refill|refill_?(approve|deny|decide)/i, why: 'refill decisions belong to the DVM' },
  { pattern: /(^|[^a-z])cs[A-Z_]|controlled|cs_?(log|container|count|witness|order|destruction|waste)|pdmp|cures|dea_?(registration|form)|form_?222|csos|register_read|cs_?loss|order_?form|cabinet_?access|discrepanc/i, why: 'agents never touch the controlled-substance register' },
  { pattern: /euthan/i, why: 'euthanasia consent and administration are human-only' },
  { pattern: /discount|refund|write_?off|credit_?note/i, why: 'agents never move money against the client' },
  { pattern: /publish|(update|set)_?(fee|price|policy|protocol)/i, why: 'fees, policies and protocols change only by maker-checker' },
  { pattern: /merge/i, why: 'record merges are maker-checker' },
  { pattern: /card_?(number|data)|(^|[^a-z])pan([^a-z]|$)|cvv|cvc/i, why: 'card data never reaches an agent' },
  { pattern: /decide_?approval|approve_?request|ApprovalRequest\(/i, why: 'approvals are human-only' },
  { pattern: /^(create|update|delete)[A-Z_]|(^|[^a-z])(create|update|delete)_?(data|item|items)([^a-z]|$)/, why: 'no generic CRUD' },
]

export function assertToolAllowed(tool: Pick<DomainTool, 'name' | 'document'>) {
  for (const { pattern, why } of NEVER_TOOL_PATTERNS) {
    if (pattern.test(tool.name) || pattern.test(tool.document)) throw new Error(`MCP tool ${tool.name} is never allowed: ${why}`)
  }
}

const idempotencyKey = { type: 'string', minLength: 8, maxLength: 200, pattern: '^[A-Za-z0-9._:-]+$', description: 'Unique per intent. Reusing it returns the first result instead of acting twice.' }

export const DOMAIN_TOOLS: DomainTool[] = [
  {
    name: 'verifyAuditChain',
    description: 'Recompute the hash-chained audit log and report whether it is intact (and where it breaks if not). Needs canReadAudit.',
    inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
    document: 'query VerifyAuditChain { verifyAuditChain }',
    field: 'verifyAuditChain',
    writes: false,
  },
  {
    name: 'loadPracticeSetup',
    description: 'Load the Cedar Creek Animal Hospital practice spine (locations, roles, staff, licences, DEA registrations, calendars, federal and California policy packs, approval policies). Idempotent. Needs canManageOnboarding.',
    inputSchema: { type: 'object', properties: { idempotencyKey }, required: ['idempotencyKey'], additionalProperties: false },
    document: 'mutation LoadPracticeSetup($idempotencyKey: String!) { loadPracticeSetup(idempotencyKey: $idempotencyKey) }',
    field: 'loadPracticeSetup',
    writes: true,
  },
  {
    name: 'loadClinicSetup',
    description: 'Load the Cedar Creek clinic data after the practice spine: species and breeds, rooms, appointment types, staff schedules, the published phone-triage protocol, templates, knowledge base, the AI receptionist (paused), fictional households and patients, the day sheet and the first CS containers. Idempotent. Needs canManageOnboarding.',
    inputSchema: { type: 'object', properties: { idempotencyKey }, required: ['idempotencyKey'], additionalProperties: false },
    document: 'mutation LoadClinicSetup($idempotencyKey: String!) { loadClinicSetup(idempotencyKey: $idempotencyKey) }',
    field: 'loadClinicSetup',
    writes: true,
  },
]

export function registerDomainTools(tools: DomainTool[]) {
  for (const tool of tools) {
    assertToolAllowed(tool)
    if (DOMAIN_TOOLS.some(existing => existing.name === tool.name)) throw new Error(`Duplicate MCP tool ${tool.name}`)
    DOMAIN_TOOLS.push(tool)
  }
}

/** Minimal JSON-schema check for the flat argument objects our tools take. */
export function validateArguments(tool: DomainTool, args: Record<string, unknown>) {
  const problems: string[] = []
  const properties = tool.inputSchema.properties as Record<string, { type?: string; enum?: unknown[]; minLength?: number; maxLength?: number; pattern?: string }>
  for (const key of tool.inputSchema.required) if (args[key] === undefined || args[key] === null || args[key] === '') problems.push(`${key} is required`)
  for (const [key, value] of Object.entries(args)) {
    const spec = properties[key]
    if (!spec) {
      if (tool.inputSchema.additionalProperties === false) problems.push(`${key} is not an argument of ${tool.name}`)
      continue
    }
    if (spec.type === 'string' && typeof value !== 'string') problems.push(`${key} must be a string`)
    if (spec.type === 'integer' && !Number.isSafeInteger(value)) problems.push(`${key} must be an integer`)
    if (spec.type === 'boolean' && typeof value !== 'boolean') problems.push(`${key} must be true or false`)
    if (spec.type === 'object' && (typeof value !== 'object' || value === null || Array.isArray(value))) problems.push(`${key} must be an object`)
    if (spec.enum && !spec.enum.includes(value)) problems.push(`${key} must be one of ${spec.enum.join(', ')}`)
    if (typeof value === 'string') {
      if (spec.minLength && value.length < spec.minLength) problems.push(`${key} is too short`)
      if (spec.maxLength && value.length > spec.maxLength) problems.push(`${key} is too long`)
      if (spec.pattern && !new RegExp(spec.pattern).test(value)) problems.push(`${key} has invalid characters`)
    }
  }
  if (problems.length) throw new Error(`Invalid arguments: ${problems.join('; ')}`)
}

export async function runDomainTool(tool: DomainTool, args: Record<string, unknown>, target: { graphqlEndpoint: string; auth: Record<string, string> }) {
  validateArguments(tool, args)
  const response = await fetch(target.graphqlEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...target.auth },
    body: JSON.stringify({ query: tool.document, variables: args }),
  })
  const result = await response.json()
  if (result.errors?.length) {
    return { ok: false, errors: result.errors.map((e: { message?: string; extensions?: { code?: string } }) => ({ message: e.message, code: e.extensions?.code })) }
  }
  return { ok: true, result: result.data?.[tool.field] ?? null }
}
