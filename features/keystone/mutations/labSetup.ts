import { Prisma } from '@prisma/client'
import { command } from '../lib/command'
import { auditCreate, lockRow } from '../lib/cas'
import { DomainError, Codes } from '../lib/errors'
import { seedInHouseLabCatalog } from '../seed/labs'
import { gated } from './agentGuard'
import { pick } from './billingInput'
import { text, type Ctx } from './clinical'

/*
 * Lab set-up by the practice (Phase 6 "each clinic sets up its own labs"). A lab, its tests and the codes its results arrive under are
 * reference data: added and edited here, never deleted (orders and results point at them), retired instead. Each command takes an
 * idempotency key, so a retry after a dropped response never adds a second row. Only people who manage the practice or its integrations.
 */

const SETUP = ['canManageIntegrations', 'canManagePractice'] as const
const KINDS = ['reference', 'in_house'] as const
const INTAKES = ['manual', 'file_drop', 'adapter'] as const
const STATES = ['active', 'retired'] as const
const code = (value: unknown, field: string, max = 30) => {
  const out = text(value, field, max).toUpperCase()
  if (!/^[A-Z0-9][A-Z0-9_-]*$/.test(out)) throw new DomainError(Codes.INVALID_INPUT, `${field}: letters, digits, - and _ only.`, { field })
  return out
}

/** Add the in-house analyser catalog (lab, tests, analytes, codes, dog and cat ranges). Adds only what is missing; edits nothing. */
export async function loadInHouseLabCatalog(_root: unknown, args: { idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: [...SETUP, 'canManageOnboarding'], tool: 'lab.catalog.load', humanOnly: true }, args, async actor => {
    const result = await command(context.prisma, { name: 'lab.catalog.load', actor, idempotencyKey: args.idempotencyKey, params: {} }, uow => seedInHouseLabCatalog(uow, actor))
    return { replay: result.replay, created: result.value }
  })
}

/** Add a laboratory, or change one (name, kind, how results arrive, account number, active or retired). The code is fixed once made. */
export async function saveLaboratory(_root: unknown, args: { labId?: string | null; code?: string | null; name: string; kind: string; intake: string; accountNumber?: string | null; status?: string | null; expectedVersion?: number | null; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: [...SETUP], tool: 'lab.save', humanOnly: true }, args, async actor => {
    const data = {
      name: text(args.name, 'name', 120),
      kind: pick(args.kind, KINDS, 'kind'),
      intake: pick(args.intake, INTAKES, 'how results arrive'),
      accountNumber: text(args.accountNumber, 'account number', 60, false),
      status: pick(args.status ?? 'active', STATES, 'status'),
    }
    const result = await command(context.prisma, { name: 'lab.save', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      if (args.labId) {
        const row = await lockRow<{ id: string; version: number }>(uow.tx, 'Laboratory', args.labId)
        if (args.expectedVersion !== undefined && args.expectedVersion !== null && args.expectedVersion !== Number(row.version)) throw new DomainError(Codes.STALE_STATE, 'This laboratory changed since you loaded it. Reload and try again.')
        await uow.tx.laboratory.update({ where: { id: row.id }, data: { ...data, version: { increment: 1 } } })
        auditCreate(uow, actor, 'Laboratory', row.id, 'lab.updated', data)
        return { id: row.id }
      }
      const c = code(args.code, 'code')
      if (await uow.tx.laboratory.findUnique({ where: { code: c }, select: { id: true } })) throw new DomainError(Codes.GUARD_FAILED, `A laboratory with code ${c} already exists.`, { field: 'code' })
      const lab = await uow.tx.laboratory.create({ data: { code: c, ...data }, select: { id: true } })
      auditCreate(uow, actor, 'Laboratory', lab.id, 'lab.created', { code: c, ...data })
      return { id: lab.id }
    })
    return { replay: result.replay, ...result.value }
  })
}

/** Add a test to a lab or change one: name, price-list item, turnaround, species, active or retired. Codes are unique within a lab. */
export async function saveLabTest(_root: unknown, args: { testId?: string | null; labId: string; code?: string | null; name: string; feeItemId?: string | null; turnaroundHours: number; speciesCodes?: string[] | null; status?: string | null; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: [...SETUP], tool: 'lab.test.save', humanOnly: true }, args, async actor => {
    if (!Number.isInteger(args.turnaroundHours) || args.turnaroundHours < 0 || args.turnaroundHours > 2000) throw new DomainError(Codes.INVALID_INPUT, 'Turnaround is 0 to 2000 hours.', { field: 'turnaroundHours' })
    const name = text(args.name, 'name', 120)
    const status = pick(args.status ?? 'active', STATES, 'status')
    const result = await command(context.prisma, { name: 'lab.test.save', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const lab = await uow.tx.laboratory.findUnique({ where: { id: args.labId }, select: { id: true } })
      if (!lab) throw new DomainError(Codes.NOT_FOUND, 'Laboratory not found.', { field: 'labId' })
      let feeItemId: string | null = null
      if (args.feeItemId) {
        const fee = await uow.tx.feeItem.findUnique({ where: { id: args.feeItemId }, select: { id: true, version: { select: { status: true } } } })
        if (!fee || fee.version?.status !== 'published') throw new DomainError(Codes.GUARD_FAILED, 'Choose a fee from the published price list.', { field: 'feeItemId' })
        feeItemId = fee.id
      }
      const species = args.speciesCodes?.length ? await uow.tx.species.findMany({ where: { code: { in: args.speciesCodes } }, select: { id: true } }) : []
      if (args.speciesCodes?.length && species.length !== new Set(args.speciesCodes).size) throw new DomainError(Codes.INVALID_INPUT, 'One of the species is not known.', { field: 'speciesCodes' })
      const data = { name, feeItemId, turnaroundHours: args.turnaroundHours, status }
      if (args.testId) {
        const t = await uow.tx.labTest.findUnique({ where: { id: args.testId }, select: { id: true, labId: true } })
        if (!t || t.labId !== lab.id) throw new DomainError(Codes.NOT_FOUND, 'That test is not on this laboratory.', { field: 'testId' })
        await uow.tx.labTest.update({ where: { id: t.id }, data: { ...data, ...(args.speciesCodes ? { species: { set: species.map(s => ({ id: s.id })) } } : {}) } })
        auditCreate(uow, actor, 'LabTest', t.id, 'lab.test_updated', { ...data, speciesCodes: args.speciesCodes ?? undefined })
        return { id: t.id }
      }
      const c = code(args.code, 'code')
      if (await uow.tx.labTest.findFirst({ where: { labId: lab.id, code: c }, select: { id: true } })) throw new DomainError(Codes.GUARD_FAILED, `This laboratory already has a test ${c}.`, { field: 'code' })
      const t = await uow.tx.labTest.create({ data: { labId: lab.id, code: c, ...data, species: { connect: species.map(s => ({ id: s.id })) } }, select: { id: true } })
      auditCreate(uow, actor, 'LabTest', t.id, 'lab.test_created', { labId: lab.id, code: c, ...data, speciesCodes: args.speciesCodes ?? [] })
      return { id: t.id }
    })
    return { replay: result.replay, ...result.value }
  })
}

/**
 * Say which of our analytes a lab's result code means, and how to convert its unit (value × factor). A new analyte code makes the
 * analyte (with its unit). A code already mapped for this lab is changed in place, so one code never means two things.
 */
export async function mapLabCode(_root: unknown, args: { labId: string; externalCode: string; analyteCode: string; analyteName?: string | null; unit?: string | null; factor?: string | null; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: [...SETUP], tool: 'lab.code.map', humanOnly: true }, args, async actor => {
    const externalCode = text(args.externalCode, 'lab code', 40)
    const analyteCode = code(args.analyteCode, 'analyte code', 20)
    const factor = args.factor ? String(args.factor).trim() : ''
    if (factor && !/^\d{1,9}(\.\d{1,9})?$/.test(factor)) throw new DomainError(Codes.INVALID_INPUT, 'The factor is a positive number, like 0.0555.', { field: 'factor' })
    if (factor && Number(factor) === 0) throw new DomainError(Codes.INVALID_INPUT, 'The factor cannot be zero.', { field: 'factor' })
    const result = await command(context.prisma, { name: 'lab.code.map', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const lab = await uow.tx.laboratory.findUnique({ where: { id: args.labId }, select: { id: true } })
      if (!lab) throw new DomainError(Codes.NOT_FOUND, 'Laboratory not found.', { field: 'labId' })
      let analyte = await uow.tx.analyte.findUnique({ where: { code: analyteCode }, select: { id: true } })
      if (!analyte) {
        analyte = await uow.tx.analyte.create({ data: { code: analyteCode, name: text(args.analyteName, 'analyte name', 120), canonicalUnit: text(args.unit, 'unit', 20) }, select: { id: true } })
        auditCreate(uow, actor, 'Analyte', analyte.id, 'lab.analyte_created', { code: analyteCode })
      }
      const unitConversion = factor && factor !== '1' ? { factor } : undefined
      const existing = await uow.tx.labAnalyteMap.findFirst({ where: { labId: lab.id, externalCode }, select: { id: true } })
      const map = existing
        ? await uow.tx.labAnalyteMap.update({ where: { id: existing.id }, data: { analyteId: analyte.id, unitConversion: unitConversion ?? Prisma.DbNull }, select: { id: true } })
        : await uow.tx.labAnalyteMap.create({ data: { labId: lab.id, externalCode, analyteId: analyte.id, ...(unitConversion ? { unitConversion } : {}) }, select: { id: true } })
      auditCreate(uow, actor, 'LabAnalyteMap', map.id, existing ? 'lab.code_remapped' : 'lab.code_mapped', { labId: lab.id, externalCode, analyteCode, factor: factor || null })
      return { id: map.id, analyteId: analyte.id }
    })
    return { replay: result.replay, ...result.value }
  })
}
