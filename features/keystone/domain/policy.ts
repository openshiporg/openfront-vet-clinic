import { z } from 'zod'
import { payloadHash } from '../lib/canonical'
import { DomainError, Codes } from '../lib/errors'
import type { Tx } from '../lib/db'

/**
 * Jurisdiction policy packs (DOMAIN §7). Rules that vary by jurisdiction never live in code: they
 * live in immutable, effective-dated PolicyVersions bound to the practice or a location. Resolving
 * merges the federal, state and local layers in that order and validates the result against the
 * kind's schema. Anything missing, overlapping or invalid fails closed with POLICY_UNRESOLVED or
 * POLICY_AMBIGUOUS; nothing is guessed (the rideshare `loadCurrentEligibility` rule).
 */

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
const days = z.number().int().min(0).max(36_500)
const CS_SCHEDULE = z.enum(['CI', 'CII', 'CIIN', 'CIII', 'CIIIN', 'CIV', 'CV'])
const CS_ENTRY = z.enum(['receive', 'administer', 'dispense', 'waste', 'destroy', 'transfer_out', 'transfer_in', 'adjust', 'return_to_supplier', 'loss'])

export const POLICY_SCHEMAS = {
  controlled_substances: z.object({
    recordRetentionYears: z.number().int().min(1),
    biennialInventoryMaxDays: days,
    theftLossNoticeBusinessDays: z.number().int().min(0),
    form106Days: days,
    orderFormValidityDays: days,
    destructionWitnesses: z.number().int().min(1),
    separateRegistrationPerLocation: z.boolean(),
    ciiSeparateRecords: z.boolean(),
    witnessRequired: z.record(CS_ENTRY, z.boolean()),
    countFrequencyDays: z.record(CS_SCHEDULE, days),
    stateScheduled: z.array(z.object({ genericName: z.string(), schedule: CS_SCHEDULE, note: z.string().optional() })),
    pdmp: z.object({ required: z.boolean(), maxDays: days, format: z.string(), schedules: z.array(CS_SCHEDULE), program: z.string() }),
  }),
  vcpr: z.object({
    establishment: z.enum(['in_person_only', 'in_person_or_telehealth']),
    durationMonths: z.number().int().min(1).max(36),
    level: z.enum(['dvm', 'practice']),
    requiredFor: z.array(z.enum(['prescription', 'refill', 'extralabel', 'vfd', 'telehealth_treatment'])),
  }),
  prescription: z.object({
    refillLimits: z.record(CS_SCHEDULE, z.object({ maxRefills: z.number().int().min(0), maxMonths: z.number().int().min(0) })),
    defaultExpiryMonths: z.number().int().min(1).max(24),
    writtenRxOnRequest: z.boolean(),
    labelFields: z.array(z.string()),
    vfdDefaultExpiryMonths: z.number().int().min(1),
  }),
  medical_records: z.object({
    retentionYearsAfterLastVisit: z.number().int().min(1),
    requiredFields: z.array(z.string()),
    clientCopyDays: days,
    summaryInsteadOfCopyAllowed: z.boolean(),
  }),
  confidentiality: z.object({
    releaseBases: z.array(z.enum(['client_of_record', 'authorised_person', 'referral_with_authorisation', 'insurer_with_authorisation', 'court_order', 'subpoena', 'public_health'])),
    agentMayRelease: z.array(z.enum(['client_of_record'])),
  }),
  contact: z.object({
    quietHours: z.object({ start: hhmm, end: hhmm }),
    aiVoiceDisclosure: z.boolean(),
    recordingConsent: z.enum(['one_party', 'all_party']),
    consentPurposes: z.record(z.enum(['care', 'transactional', 'marketing', 'ai_voice', 'recording']), z.enum(['implied', 'express', 'express_written'])),
    outboundAiVoiceAllowed: z.boolean(),
  }),
  rabies: z.object({
    certificateFormat: z.string(),
    maxDurationMonths: z.number().int().min(12).max(48),
    firstDoseMinAgeWeeks: z.number().int().min(8).max(26),
    boosterAfterFirstMonths: z.number().int().min(6).max(24),
    reportBitesTo: z.string(),
    biteObservationDays: z.number().int().min(1),
    certificateFields: z.array(z.string()),
  }),
  supervision: z.object({
    tasks: z.record(z.string(), z.object({ allowedKinds: z.array(z.enum(['dvm', 'rvt', 'assistant'])), supervision: z.enum(['none', 'indirect', 'direct', 'immediate']) })),
  }),
  telehealth: z.object({ allowed: z.boolean(), mayEstablishVcpr: z.boolean(), prescribingLimits: z.string() }),
  auto_renewal: z.object({ disclosureRequired: z.boolean(), affirmativeConsent: z.boolean(), onlineCancellation: z.boolean(), renewalNoticeDays: days }),
  sales_tax: z.object({
    taxableCategories: z.array(z.string()),
    exemptCategories: z.array(z.string()),
    baseRate: z.string().regex(/^0\.\d{1,6}$/),
  }),
  boarding: z.object({
    requiredVaccines: z.record(z.string(), z.array(z.string())),
    gracePeriodDays: days,
  }),
  licensure: z.object({
    licenceKindsByAction: z.record(z.string(), z.array(z.enum(['veterinarian', 'registered_veterinary_technician', 'veterinary_assistant_cs_permit']))),
    licenceMustMatchLocationState: z.boolean(),
    expiryWarningDays: days,
  }),
} as const

export type PolicyKind = keyof typeof POLICY_SCHEMAS
export type PolicyRules<K extends PolicyKind> = z.infer<(typeof POLICY_SCHEMAS)[K]>
export const POLICY_KIND_NAMES = Object.keys(POLICY_SCHEMAS) as PolicyKind[]

export type PolicyLayer = 'federal' | 'state' | 'local'
const LAYER_ORDER: Record<PolicyLayer, number> = { federal: 0, state: 1, local: 2 }

export type CandidateVersion = {
  id: string
  packCode: string
  layer: PolicyLayer
  status: string
  effectiveFrom: string
  effectiveTo: string | null
  rules: unknown
  verified: boolean
  unverifiedRules: string[]
}

export type ResolvedPolicy<K extends PolicyKind> = {
  kind: K
  on: string
  rules: PolicyRules<K>
  versions: { id: string; packCode: string; layer: PolicyLayer; verified: boolean }[]
  verified: boolean
  unverifiedRules: string[]
}

export const rulesHash = (rules: unknown) => payloadHash(rules)

const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** Later layers override earlier ones key by key; arrays and scalars replace whole. */
export function mergeLayers(layers: unknown[]): unknown {
  return layers.reduce((acc: unknown, layer) => {
    if (!isPlainObject(acc) || !isPlainObject(layer)) return layer
    const out: Record<string, unknown> = { ...acc }
    for (const [k, v] of Object.entries(layer)) out[k] = isPlainObject(v) && isPlainObject(out[k]) ? mergeLayers([out[k], v]) : v
    return out
  }, {})
}

/** Check one layer's rules on their own before they are stored: only known keys, right shapes. */
export function validateLayer(kind: PolicyKind, rules: unknown) {
  const schema = POLICY_SCHEMAS[kind]
  if (!schema) throw new DomainError(Codes.INVALID_INPUT, `Unknown policy kind ${kind}.`)
  const parsed = (schema as z.ZodObject<z.ZodRawShape>).partial().strict().safeParse(rules)
  if (!parsed.success) throw new DomainError(Codes.INVALID_INPUT, `The ${kind} rules are not valid: ${parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}`)
  return parsed.data
}

/**
 * Pure resolution over candidate versions of every bound pack (unit-tested without a database).
 * Exactly one published version per pack must be in force on `on`, and the merged rules must pass
 * the full schema. Anything else throws.
 */
export function selectAndMerge<K extends PolicyKind>(kind: K, on: string, boundPacks: string[], candidates: CandidateVersion[]): ResolvedPolicy<K> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(on)) throw new DomainError(Codes.INVALID_INPUT, `Invalid policy date ${on}.`)
  if (!boundPacks.length) throw new DomainError(Codes.POLICY_UNRESOLVED, `No ${kind} policy applies here. Bind a policy pack before this action can run.`, { kind, on })
  const chosen: CandidateVersion[] = []
  for (const pack of boundPacks) {
    const inForce = candidates.filter(c => c.packCode === pack && c.status === 'published' && c.effectiveFrom <= on && (!c.effectiveTo || c.effectiveTo > on))
    if (!inForce.length) throw new DomainError(Codes.POLICY_UNRESOLVED, `The ${pack} policy has no version in force on ${on}.`, { kind, pack, on })
    if (inForce.length > 1) throw new DomainError(Codes.POLICY_AMBIGUOUS, `The ${pack} policy has ${inForce.length} versions in force on ${on}.`, { kind, pack, on, versions: inForce.map(v => v.id) })
    chosen.push(inForce[0])
  }
  chosen.sort((a, b) => LAYER_ORDER[a.layer] - LAYER_ORDER[b.layer])
  const layers = new Set(chosen.map(c => c.layer))
  if (layers.size !== chosen.length) throw new DomainError(Codes.POLICY_AMBIGUOUS, `Two ${kind} packs are bound at the same layer.`, { kind, packs: chosen.map(c => c.packCode) })
  const merged = mergeLayers(chosen.map(c => c.rules))
  const parsed = POLICY_SCHEMAS[kind].safeParse(merged)
  if (!parsed.success) {
    throw new DomainError(Codes.POLICY_UNRESOLVED, `The ${kind} policy in force is incomplete: ${parsed.error.issues.slice(0, 5).map(i => i.path.join('.') || '(root)').join(', ')}.`, { kind, on })
  }
  const unverifiedRules = chosen.flatMap(c => c.unverifiedRules.map(r => `${c.packCode}:${r}`))
  return {
    kind, on,
    rules: parsed.data as PolicyRules<K>,
    versions: chosen.map(c => ({ id: c.id, packCode: c.packCode, layer: c.layer, verified: c.verified })),
    verified: chosen.every(c => c.verified),
    unverifiedRules,
  }
}

const isoDay = (d: Date | string | null) => (d == null ? null : typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10))

type PolicySnapshot = {
  bindings: { scope: string; locationId: string | null; layer: PolicyLayer; packId: string; packCode: string; kind: string }[]
  versions: (Omit<CandidateVersion, 'packCode' | 'layer'> & { packId: string })[]
}

/** Loads every binding and version of the given kinds in two queries (no per-kind round trips). */
export async function loadPolicySnapshot(tx: Tx, kinds: readonly string[]): Promise<PolicySnapshot> {
  const rows = await tx.policyBinding.findMany({
    where: { pack: { kind: { in: [...kinds] } } },
    select: { scope: true, locationId: true, layer: true, pack: { select: { id: true, code: true, kind: true } } },
  })
  const bindings = rows.filter(b => b.pack).map(b => ({ scope: b.scope, locationId: b.locationId, layer: b.layer as PolicyLayer, packId: b.pack!.id, packCode: b.pack!.code, kind: String(b.pack!.kind) }))
  const packIds = [...new Set(bindings.map(b => b.packId))]
  const versions = packIds.length
    ? await tx.policyVersion.findMany({ where: { packId: { in: packIds } }, select: { id: true, packId: true, status: true, effectiveFrom: true, effectiveTo: true, rules: true, verified: true, unverifiedRules: true } })
    : []
  return {
    bindings,
    versions: versions.map(v => ({
      id: v.id, packId: v.packId!, status: String(v.status), effectiveFrom: isoDay(v.effectiveFrom)!, effectiveTo: isoDay(v.effectiveTo),
      rules: v.rules, verified: v.verified === true, unverifiedRules: Array.isArray(v.unverifiedRules) ? (v.unverifiedRules as string[]) : [],
    })),
  }
}

/** Resolve from a loaded snapshot: practice-wide bindings apply everywhere; location bindings add to them. */
export function resolveFromSnapshot<K extends PolicyKind>(snapshot: PolicySnapshot, kind: K, input: { locationId: string; on: string }): ResolvedPolicy<K> {
  const bound = snapshot.bindings.filter(b => b.kind === kind && (b.scope === 'practice' || (b.scope === 'location' && b.locationId === input.locationId)))
  const unique = [...new Map(bound.map(b => [b.packCode, b])).values()]
  const candidates: CandidateVersion[] = snapshot.versions.flatMap(v => {
    const pack = unique.find(p => p.packId === v.packId)
    if (!pack) return []
    const { packId: _packId, ...rest } = v
    return [{ ...rest, packCode: pack.packCode, layer: pack.layer }]
  })
  return selectAndMerge(kind, input.on, unique.map(p => p.packCode), candidates)
}

/**
 * Resolve the policy of a kind for a location on a date (the location's local date). Practice-wide
 * bindings apply everywhere; location bindings add to them.
 */
export async function resolvePolicy<K extends PolicyKind>(tx: Tx, kind: K, input: { locationId: string; on: string }): Promise<ResolvedPolicy<K>> {
  return resolveFromSnapshot(await loadPolicySnapshot(tx, [kind]), kind, input)
}
