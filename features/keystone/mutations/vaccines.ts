import { command } from '../lib/command'
import { auditCreate, transition } from '../lib/cas'
import { advisoryLock } from '../lib/db'
import { actorUserId } from '../lib/actor'
import { DomainError, Codes } from '../lib/errors'
import { nextReference } from '../lib/sequence'
import { toJsonValue } from '../lib/canonical'
import { addDays } from '../lib/calendar'
import { resolvePolicy } from '../domain/policy'
import { requireLicence } from '../domain/licensure'
import { calendarDayText, dueDate, inInitialSeries, rabiesCertificateFields, reminderStatusOn, vaccineDuration, vaccineProblems } from '../domain/vaccines'
import type { UnitOfWork } from '../lib/unitOfWork'
import { gated } from './agentGuard'
import { activePatient, chartableEncounter, day, locationDay, markInProgress, staffById, staffOf, text, type Ctx, type StaffRow } from './clinical'

/*
 * Vaccines, rabies certificates and reminders (SM§18, DOMAIN I-V1–I-V3).
 *   administer → guards (lot in date, species, minimum age, rabies supervision) → VaccineAdministration
 *     (immutable) → due date from the label capped by the jurisdiction → rabies certificate generated
 *     from the same row → reminders satisfied and the next one scheduled, all in one transaction.
 *   The daily reminder job moves reminders through due/overdue/lapsed and queues notify.reminder.
 */

type RuleRow = { id: string; code: string; schedule: unknown; leadDays: number; graceDays: number; lapseDays: number; satisfiesId: string | null; protocolVersionId: string | null }

async function activeRulesFor(uow: UnitOfWork, productId: string, speciesId: string | null) {
  return uow.tx.reminderRule.findMany({
    where: { triggerVaccines: { some: { id: productId } }, protocolVersion: { status: 'published', protocol: speciesId ? { OR: [{ speciesId }, { speciesId: null }] } : {} } },
    select: { id: true, code: true, schedule: true, leadDays: true, graceDays: true, lapseDays: true, satisfiesId: true, protocolVersionId: true },
  }).then(rows => rows.map(r => ({ ...r, leadDays: r.leadDays ?? 30, graceDays: r.graceDays ?? 30, lapseDays: r.lapseDays ?? 180 })) as RuleRow[])
}

/** Satisfy open reminders of `typeId` and schedule the next one; idempotent on sourceKey. */
async function satisfyAndSchedule(uow: UnitOfWork, input: { patientId: string; locationId: string; typeId: string; sourceKey: string; nextDueOn: string; rule: RuleRow | null; vaccineAdministrationId?: string | null; staffId: string | null; note?: string; on: string }) {
  const nextDue = new Date(`${input.nextDueOn}T00:00:00Z`)
  // M4: older evidence (an outside record, a back-dated entry) never satisfies a reminder that a newer
  // dose already pushed past it, and never schedules an earlier due date over the newer one.
  const newer = await uow.tx.patientReminder.findFirst({ where: { patientId: input.patientId, typeId: input.typeId, status: { not: 'suppressed' }, dueOn: { gt: nextDue } }, orderBy: { dueOn: 'desc' }, select: { id: true, dueOn: true } })
  if (newer) return { satisfied: 0, nextReminderId: newer.id, nextDueOn: day(newer.dueOn)!, superseded: true }
  const open = await uow.tx.patientReminder.findMany({ where: { patientId: input.patientId, typeId: input.typeId, status: { in: ['scheduled', 'due', 'overdue', 'lapsed'] }, dueOn: { lte: nextDue } }, select: { id: true, status: true } })
  for (const r of open) {
    await uow.tx.reminderSatisfaction.create({ data: { reminderId: r.id, sourceKey: input.sourceKey, vaccineAdministrationId: input.vaccineAdministrationId ?? null, note: input.note ?? '', recordedById: input.staffId, at: uow.now } })
    await uow.tx.patientReminder.update({ where: { id: r.id }, data: { status: 'satisfied', version: { increment: 1 } } })
  }
  const rule = input.rule
  const status = rule ? reminderStatusOn({ dueOn: input.nextDueOn, status: 'scheduled' }, rule, input.on) : 'scheduled'
  const next = await uow.tx.patientReminder.upsert({
    where: { patientId_typeId_dueOn: { patientId: input.patientId, typeId: input.typeId, dueOn: new Date(`${input.nextDueOn}T00:00:00Z`) } },
    create: { patientId: input.patientId, locationId: input.locationId, typeId: input.typeId, ruleId: rule?.id ?? null, protocolVersionId: rule?.protocolVersionId ?? null, dueOn: new Date(`${input.nextDueOn}T00:00:00Z`), status, source: input.vaccineAdministrationId ? 'vaccine' : 'manual', sourceKey: input.sourceKey },
    update: {},
  })
  return { satisfied: open.length, nextReminderId: next.id, nextDueOn: input.nextDueOn, superseded: false }
}

/** Doses that count: not a reversal row and not reversed since (M5). */
const liveDose = { source: { not: 'reversal' }, from_VaccineAdministration_reverses: { none: {} } } as const
/** A prior rabies dose counts toward the booster duration only when it is at least this old (the compendium's 9–12 month booster window, M3). */
export const RABIES_BOOSTER_MIN_DAYS = 270
/** A second dose of the same product this soon is a likely duplicate; a veterinarian may override with a reason (except on the same day). */
export const VACCINE_REPEAT_MIN_DAYS = 14

export async function administerVaccine(_root: unknown, args: { encounterId: string; productId: string; lotId: string; route?: string | null; site: string; supervisingDvmId?: string | null; tagNumber?: string | null; repeatReason?: string | null; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canAdminister'], tool: 'vaccine.administer', humanOnly: true }, args, async actor => {
    const site = text(args.site, 'site', 100)
    const result = await command(context.prisma, { name: 'vaccine.administer', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const staff = await staffOf(uow, actor)
      const enc = await chartableEncounter(uow, args.encounterId)
      const patient = await activePatient(uow, enc.patientId!)
      const { on } = await locationDay(uow, enc.locationId!, uow.now)
      const product = await uow.tx.vaccineProduct.findUnique({ where: { id: args.productId }, select: { id: true, name: true, manufacturer: true, isRabies: true, minAgeWeeks: true, licensedDoiMonths: true, active: true, defaultRoute: true, usdaProductCode: true, reminderTypeId: true, species: { select: { code: true } } } })
      if (!product) throw new DomainError(Codes.NOT_FOUND, 'Vaccine not found.')
      const lot = await uow.tx.inventoryLot.findUnique({ where: { id: args.lotId }, select: { id: true, lotNumber: true, expiresOn: true, status: true, vaccineId: true, locationId: true } })
      if (lot && lot.vaccineId !== product.id) throw new DomainError(Codes.GUARD_FAILED, 'That lot is a different vaccine.')
      if (lot && lot.locationId && lot.locationId !== enc.locationId) throw new DomainError(Codes.GUARD_FAILED, 'That lot is stocked at another location.')
      const rabiesPack = product.isRabies ? await resolvePolicy(uow.tx, 'rabies', { locationId: enc.locationId!, on }).catch(error => { if (error instanceof DomainError && error.code === Codes.POLICY_UNRESOLVED) return null; throw error }) : null
      let supervising: StaffRow | null = null
      if (args.supervisingDvmId) {
        supervising = await staffById(uow, args.supervisingDvmId)
        if (supervising.kind !== 'dvm') throw new DomainError(Codes.GUARD_FAILED, 'The supervising person must be a veterinarian.')
      }
      const problems = vaccineProblems({
        product: { name: product.name, isRabies: product.isRabies, minAgeWeeks: product.minAgeWeeks, speciesCodes: product.species.map(s => s.code), active: product.active },
        lot: lot ? { lotNumber: lot.lotNumber, expiresOn: day(lot.expiresOn)!, status: lot.status } : null,
        patient: { speciesCode: patient.species?.code ?? null, dateOfBirth: day(patient.dateOfBirth), status: patient.status }, on,
        rabiesPolicy: rabiesPack ? { firstDoseMinAgeWeeks: rabiesPack.rules.firstDoseMinAgeWeeks } : null, giverKind: staff.kind, supervisingDvmPresent: Boolean(supervising),
      })
      if (problems.length) throw new DomainError(Codes.GUARD_FAILED, problems.join(' '), { problems })
      const licence = product.isRabies ? await requireLicence(uow.tx, { staffMemberId: (staff.kind === 'dvm' ? staff : supervising!).id, locationId: enc.locationId!, action: 'examine', at: uow.now }) : null

      // M3: a repeat of the same product the same day is refused; within VACCINE_REPEAT_MIN_DAYS it needs a vet's reason.
      const recent = await uow.tx.vaccineAdministration.findFirst({ where: { patientId: patient.id, productId: product.id, ...liveDose, administeredOn: { gt: new Date(`${addDays(on, -VACCINE_REPEAT_MIN_DAYS)}T00:00:00Z`) } }, orderBy: { administeredOn: 'desc' }, select: { administeredOn: true } })
      if (recent && day(recent.administeredOn) === on) throw new DomainError(Codes.GUARD_FAILED, `${patient.name ?? 'This patient'} already had ${product.name} today. Reverse that dose first if it was recorded by mistake.`, { reason: 'repeat_same_day' })
      const repeatReason = args.repeatReason?.trim() ?? ''
      if (recent) {
        if (staff.kind !== 'dvm' && !(supervising && repeatReason)) throw new DomainError(Codes.GUARD_FAILED, `${product.name} was given on ${day(recent.administeredOn)}; a repeat within ${VACCINE_REPEAT_MIN_DAYS} days needs a veterinarian and a reason.`, { reason: 'repeat_too_soon' })
        if (repeatReason.length < 8) throw new DomainError(Codes.INVALID_INPUT, `${product.name} was given on ${day(recent.administeredOn)}; give the reason for repeating it (at least 8 characters).`, { field: 'repeatReason', reason: 'repeat_too_soon' })
      }
      const priorDoses = await uow.tx.vaccineAdministration.count({ where: { patientId: patient.id, productId: product.id, ...liveDose } })
      // Only a dose old enough to be a booster interval counts toward the longer duration (never one from the same visit).
      const priorRabies = product.isRabies ? await uow.tx.vaccineAdministration.count({ where: { patientId: patient.id, product: { isRabies: true }, ...liveDose, administeredOn: { lte: new Date(`${addDays(on, -RABIES_BOOSTER_MIN_DAYS)}T00:00:00Z`) } } }) : 0
      const rules = await activeRulesFor(uow, product.id, patient.speciesId ?? null)
      const rule = rules[0] ?? null
      const series = inInitialSeries(rule?.schedule as never, day(patient.dateOfBirth), on)
      const seriesDose = series && priorDoses + 1 < series.doses ? series : null
      const duration = vaccineDuration({ labelMonths: product.licensedDoiMonths, isRabies: product.isRabies, priorRabiesDoses: priorRabies, rabiesPolicy: rabiesPack ? rabiesPack.rules : null, seriesIntervalWeeks: seriesDose?.intervalWeeks ?? null })
      const dueNextOn = dueDate(on, duration)

      let certificate: { id: string; ref: string; missing: string[] } | null = null
      if (product.isRabies && rabiesPack) certificate = await issueRabiesCertificate(uow, { patientId: patient.id, locationId: enc.locationId!, vet: staff.kind === 'dvm' ? staff : supervising!, licenseNumber: licence ? (await uow.tx.professionalLicense.findUnique({ where: { id: licence.licenseId }, select: { licenseNumber: true } }))?.licenseNumber ?? null : null, product, lotNumber: lot!.lotNumber, on, duration: duration.months, nextDueOn: dueNextOn, tagNumber: args.tagNumber ?? '', pack: rabiesPack })
      const va = await uow.tx.vaccineAdministration.create({
        data: {
          patientId: patient.id, encounterId: enc.id, productId: product.id, lotId: lot!.id, lotNumber: lot!.lotNumber, lotExpiresOn: lot!.expiresOn, doseSeries: priorDoses + 1, isInitialSeries: Boolean(series),
          route: args.route ?? product.defaultRoute, site, administeredOn: new Date(`${on}T00:00:00Z`), durationMonths: duration.months, dueNextOn: new Date(`${dueNextOn}T00:00:00Z`),
          vaccinatedById: staff.id, supervisingDvmId: supervising?.id ?? null, certificateId: certificate?.id ?? null, policyVersions: toJsonValue(rabiesPack?.versions.map(v => v.id) ?? []) as never, source: 'administered',
        },
      })
      let reminder = null
      const typeId = rule?.satisfiesId ?? product.reminderTypeId
      if (typeId) reminder = await satisfyAndSchedule(uow, { patientId: patient.id, locationId: enc.locationId!, typeId, sourceKey: `VA:${va.id}`, nextDueOn: dueNextOn, rule, vaccineAdministrationId: va.id, staffId: staff.id, on })
      await markInProgress(uow, enc)
      auditCreate(uow, actor, 'VaccineAdministration', va.id, 'vaccine.administered', { product: product.name, lotNumber: lot!.lotNumber, dueNextOn, durationReason: duration.reason, certificate: certificate?.ref ?? null, reminder, repeatReason: recent ? repeatReason : null })
      return { id: va.id, dueNextOn, durationMonths: duration.months, durationReason: duration.reason, certificate, reminder, verified: rabiesPack?.verified ?? true }
    })
    return { replay: result.replay, ...result.value }
  })
}

/** NASPHV Form 51-equivalent from the administration row (I-V2): never typed separately. */
async function issueRabiesCertificate(uow: UnitOfWork, input: { patientId: string; locationId: string; vet: StaffRow; licenseNumber: string | null; product: { name: string; manufacturer: string; usdaProductCode: string | null }; lotNumber: string; on: string; duration: number; nextDueOn: string; tagNumber: string; pack: { rules: { certificateFields: string[] }; versions: { id: string }[] } }) {
  const patient = await uow.tx.patient.findUniqueOrThrow({
    where: { id: input.patientId },
    select: { name: true, sex: true, reproductiveStatus: true, dateOfBirth: true, colourMarkings: true, species: { select: { name: true } }, breed: { select: { name: true } }, microchips: { select: { number: true }, take: 1 },
      ownerships: { where: { role: 'primary', effectiveTo: null }, select: { client: { select: { displayName: true, addressLine1: true, city: true, stateCode: true, postalCode: true } } }, take: 1 } },
  })
  const owner = patient.ownerships[0]?.client
  const location = await uow.tx.location.findUniqueOrThrow({ where: { id: input.locationId }, select: { name: true, addressLine1: true, city: true, stateCode: true, phone: true } })
  const snapshot: Record<string, string | null> = {
    owner_name_address: owner ? `${owner.displayName}, ${[owner.addressLine1, owner.city, owner.stateCode, owner.postalCode].filter(Boolean).join(', ')}` : null,
    animal_name_species_breed_sex_age_colour: [patient.name, patient.species?.name, patient.breed?.name ?? 'mixed', `${patient.sex} ${patient.reproductiveStatus ?? ''}`.trim(), patient.dateOfBirth ? `born ${day(patient.dateOfBirth)}` : null, patient.colourMarkings || null].every(Boolean)
      ? [patient.name, patient.species?.name, patient.breed?.name ?? 'mixed', `${patient.sex} ${patient.reproductiveStatus ?? ''}`.trim(), `born ${calendarDayText(day(patient.dateOfBirth)!)}`, patient.colourMarkings].join(', ') : null,
    microchip: patient.microchips[0]?.number ?? 'none recorded',
    vaccine_manufacturer_product_lot: `${input.product.manufacturer}, ${input.product.name}${input.product.usdaProductCode ? ` (USDA ${input.product.usdaProductCode})` : ''}, lot ${input.lotNumber}`,
    date_given: input.on,
    duration: `${input.duration} months`,
    next_due: input.nextDueOn,
    tag_number: input.tagNumber || null,
    veterinarian_name_licence_signature: input.licenseNumber ? `${input.vet.displayName}, licence ${input.licenseNumber}, signed electronically` : null,
  }
  const { fields, missing } = rabiesCertificateFields(input.pack.rules.certificateFields, snapshot)
  const ref = await nextReference(uow.tx, 'RAB', uow.now)
  const cert = await uow.tx.rabiesCertificate.create({
    data: {
      ref, patientId: input.patientId, ownerSnapshot: toJsonValue(owner ?? null) as never, patientSnapshot: toJsonValue({ ...patient, ownerships: undefined }) as never, vaccineSnapshot: toJsonValue({ ...input.product, lotNumber: input.lotNumber }) as never,
      vetSnapshot: toJsonValue({ id: input.vet.id, name: input.vet.displayName, licenseNumber: input.licenseNumber, location }) as never, vaccinatedOn: new Date(`${input.on}T00:00:00Z`), durationMonths: input.duration,
      nextDueOn: new Date(`${input.nextDueOn}T00:00:00Z`), tagNumber: input.tagNumber, tagJurisdiction: input.tagNumber ? location.stateCode : '', fields: toJsonValue(fields) as never, missingFields: toJsonValue(missing) as never,
      reportedTo: 'none', policyVersions: toJsonValue(input.pack.versions.map(v => v.id)) as never,
    },
  })
  uow.emit({ topic: 'document.render', aggregateType: 'RabiesCertificate', aggregateId: cert.id, payload: { kind: 'rabies_certificate' }, dedupeKey: `rabies.render:${cert.id}` })
  return { id: cert.id, ref, missing }
}

/** Record a vaccine given elsewhere, with evidence (I-V3): satisfies reminders, no certificate. */
export async function recordOutsideVaccine(_root: unknown, args: { patientId: string; productId: string; administeredOn: string; lotNumber?: string | null; evidenceNote: string; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canWriteRecord'], tool: 'vaccine.outside', humanOnly: true }, args, async actor => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.administeredOn)) throw new DomainError(Codes.INVALID_INPUT, 'administeredOn is YYYY-MM-DD.', { field: 'administeredOn' })
    const note = text(args.evidenceNote, 'evidenceNote', 500)
    const result = await command(context.prisma, { name: 'vaccine.outside', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const staff = await staffOf(uow, actor)
      const patient = await activePatient(uow, args.patientId)
      const product = await uow.tx.vaccineProduct.findUnique({ where: { id: args.productId }, select: { id: true, name: true, licensedDoiMonths: true, isRabies: true, reminderTypeId: true } })
      if (!product) throw new DomainError(Codes.NOT_FOUND, 'Vaccine not found.')
      const locationId = staff.homeLocationId ?? (await uow.tx.location.findFirst({ where: { active: true }, select: { id: true }, orderBy: { createdAt: 'asc' } }))?.id
      if (!locationId) throw new DomainError(Codes.GUARD_FAILED, 'No location to file the reminder under.')
      const { on } = await locationDay(uow, locationId, uow.now)
      if (args.administeredOn > on) throw new DomainError(Codes.INVALID_INPUT, 'The date given cannot be in the future.', { field: 'administeredOn' })
      const rules = await activeRulesFor(uow, product.id, patient.speciesId ?? null)
      const rule = rules[0] ?? null
      // A rabies dose from elsewhere is honoured for the reminder at the label duration only; the
      // certificate is the other clinic's to issue (verify local acceptance rules per county).
      const nextDueOn = dueDate(args.administeredOn, { months: product.licensedDoiMonths, weeks: 0 })
      // M4: evidence older than a dose already on file is kept as history only; it never moves the reminder.
      const latest = await uow.tx.vaccineAdministration.findFirst({ where: { patientId: patient.id, ...(product.reminderTypeId ? { product: { reminderTypeId: product.reminderTypeId } } : { productId: product.id }), ...liveDose, administeredOn: { gte: new Date(`${args.administeredOn}T00:00:00Z`) } }, orderBy: { administeredOn: 'desc' }, select: { administeredOn: true } })
      const typeId = rule?.satisfiesId ?? product.reminderTypeId
      if (!typeId) throw new DomainError(Codes.GUARD_FAILED, `${product.name} has no reminder type to satisfy.`)
      const evidence = `Given elsewhere on ${args.administeredOn}${args.lotNumber ? `, lot ${args.lotNumber}` : ''}. ${note}`
      const r = latest
        ? { satisfied: 0, nextReminderId: null, nextDueOn: null, superseded: true, newerDoseOn: day(latest.administeredOn) }
        : await satisfyAndSchedule(uow, { patientId: patient.id, locationId, typeId, sourceKey: `OUT:${patient.id}:${product.id}:${args.administeredOn}`, nextDueOn, rule, staffId: staff.id, note: evidence, on })
      uow.audit({ eventType: 'vaccine.outside_recorded', entityType: 'Patient', entityId: patient.id, actorUserId: actorUserId(actor), after: { product: product.name, administeredOn: args.administeredOn, nextDueOn, evidence, superseded: r.superseded } })
      return r
    })
    return { replay: result.replay, ...result.value }
  })
}

/**
 * Reverse a vaccine administration (M5): a veterinarian, with a reason. The dose row is never changed;
 * a reversal row points at it. The certificate it issued is marked void (kept, never deleted), the
 * reminder it scheduled is suppressed and any reminder it satisfied is reopened.
 */
export async function reverseVaccineAdministration(_root: unknown, args: { vaccineAdministrationId: string; reason: string; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canWriteRecord', 'canOrder'], tool: 'vaccine.reverse', humanOnly: true }, args, async actor => {
    const reason = text(args.reason, 'reason', 300)
    if (reason.length < 8) throw new DomainError(Codes.INVALID_INPUT, 'Give the reason for the reversal (at least 8 characters).', { field: 'reason' })
    const result = await command(context.prisma, { name: 'vaccine.reverse', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const staff = await staffOf(uow, actor)
      if (staff.kind !== 'dvm') throw new DomainError(Codes.NOT_AUTHORIZED, 'Only a veterinarian can reverse a vaccine.')
      await advisoryLock(uow.tx, `vaccine-reverse:${args.vaccineAdministrationId}`)
      const va = await uow.tx.vaccineAdministration.findUnique({ where: { id: args.vaccineAdministrationId }, include: { product: { select: { name: true } }, certificate: { select: { id: true, ref: true } } } })
      if (!va) throw new DomainError(Codes.NOT_FOUND, 'Vaccine administration not found.')
      if (va.source === 'reversal') throw new DomainError(Codes.GUARD_FAILED, 'That row is itself a reversal.')
      if (await uow.tx.vaccineAdministration.count({ where: { reversesId: va.id } })) throw new DomainError(Codes.GUARD_FAILED, `This ${va.product?.name ?? 'vaccine'} dose was already reversed.`, { reason: 'already_reversed' })
      const { id: _id, createdAt: _c, product: _p, certificate: _cert, certificateId: _ci, administrationId: _a, reason: _r, reversesId: _rv, ...copy } = va as typeof va & { createdAt?: Date }
      const row = await uow.tx.vaccineAdministration.create({ data: { ...copy, policyVersions: (va.policyVersions ?? []) as never, source: 'reversal', reversesId: va.id, reason, vaccinatedById: staff.id } })
      if (va.certificate) await uow.tx.rabiesCertificate.update({ where: { id: va.certificate.id }, data: { voidedAt: uow.now, voidReason: reason } })
      const scheduled = await uow.tx.patientReminder.updateMany({ where: { sourceKey: `VA:${va.id}`, status: { not: 'suppressed' } }, data: { status: 'suppressed', suppressedReason: `Vaccine reversed: ${reason}`.slice(0, 300), version: { increment: 1 } } })
      const satisfied = await uow.tx.reminderSatisfaction.findMany({ where: { OR: [{ vaccineAdministrationId: va.id }, { sourceKey: `VA:${va.id}` }] }, select: { reminderId: true } })
      let reopened = 0
      for (const s of satisfied) {
        const r = await uow.tx.patientReminder.findUnique({ where: { id: s.reminderId! }, select: { id: true, status: true, dueOn: true, sourceKey: true, rule: { select: { leadDays: true, graceDays: true, lapseDays: true } } } })
        if (!r || r.status !== 'satisfied' || r.sourceKey === `VA:${va.id}`) continue
        const { on } = await locationDay(uow, (await uow.tx.patientReminder.findUnique({ where: { id: r.id }, select: { locationId: true } }))!.locationId!, uow.now)
        const status = reminderStatusOn({ dueOn: day(r.dueOn)!, status: 'scheduled' }, { leadDays: r.rule?.leadDays ?? 30, graceDays: r.rule?.graceDays ?? 30, lapseDays: r.rule?.lapseDays ?? 180 }, on)
        await uow.tx.patientReminder.update({ where: { id: r.id }, data: { status, version: { increment: 1 } } })
        reopened++
      }
      auditCreate(uow, actor, 'VaccineAdministration', row.id, 'vaccine.reversed', { reverses: va.id, product: va.product?.name ?? null, certificate: va.certificate?.ref ?? null, reason, remindersSuppressed: scheduled.count, remindersReopened: reopened })
      return { id: row.id, reverses: va.id, certificateVoided: va.certificate?.ref ?? null, remindersSuppressed: scheduled.count, remindersReopened: reopened }
    })
    return { replay: result.replay, ...result.value }
  })
}

export async function suppressReminder(_root: unknown, args: { reminderId: string; expectedVersion: number; reason: string; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canWriteRecord'], tool: 'reminder.suppress', humanOnly: true }, args, async actor => {
    const reason = text(args.reason, 'reason', 300)
    const result = await command(context.prisma, { name: 'reminder.suppress', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const row = await transition(uow, { model: 'PatientReminder', id: args.reminderId, from: ['scheduled', 'due', 'overdue', 'lapsed'], to: 'suppressed', expectedVersion: args.expectedVersion, actor, eventType: 'reminder.suppressed', reason, data: { suppressedReason: reason } })
      return { id: row.id, status: row.status }
    })
    return { replay: result.replay, ...result.value }
  })
}

export async function addManualReminder(_root: unknown, args: { patientId: string; typeId: string; dueOn: string; idempotencyKey: string }, context: Ctx) {
  return gated(context, { permissions: ['canWriteRecord'], tool: 'reminder.add', humanOnly: true }, args, async actor => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.dueOn)) throw new DomainError(Codes.INVALID_INPUT, 'dueOn is YYYY-MM-DD.', { field: 'dueOn' })
    const result = await command(context.prisma, { name: 'reminder.add', actor, idempotencyKey: args.idempotencyKey, params: args }, async uow => {
      const staff = await staffOf(uow, actor)
      const patient = await activePatient(uow, args.patientId)
      const type = await uow.tx.reminderType.findUnique({ where: { id: args.typeId }, select: { id: true, active: true } })
      if (!type?.active) throw new DomainError(Codes.NOT_FOUND, 'Reminder type not found.')
      const locationId = staff.homeLocationId ?? (await uow.tx.location.findFirst({ where: { active: true }, select: { id: true }, orderBy: { createdAt: 'asc' } }))!.id
      const row = await uow.tx.patientReminder.upsert({
        where: { patientId_typeId_dueOn: { patientId: patient.id, typeId: type.id, dueOn: new Date(`${args.dueOn}T00:00:00Z`) } },
        create: { patientId: patient.id, locationId, typeId: type.id, dueOn: new Date(`${args.dueOn}T00:00:00Z`), status: 'scheduled', source: 'manual', sourceKey: `MAN:${args.idempotencyKey}` },
        update: {},
      })
      auditCreate(uow, actor, 'PatientReminder', row.id, 'reminder.added', { typeId: type.id, dueOn: args.dueOn })
      return { id: row.id }
    })
    return { replay: result.replay, ...result.value }
  })
}

/**
 * Daily reminder job for one location (lease `reminders:{location}:{date}`): moves reminders through
 * due/overdue/lapsed for the location's calendar day and queues one notify.reminder per client per
 * day (dedupe key), batching every due pet of the household into one message. Purpose `care`.
 */
export async function runReminderJob(uow: UnitOfWork, locationId: string) {
  const { on } = await locationDay(uow, locationId, uow.now)
  const open = await uow.tx.patientReminder.findMany({
    where: { locationId, status: { in: ['scheduled', 'due', 'overdue'] }, dueOn: { lte: new Date(`${addDays(on, 60)}T00:00:00Z`) } },
    select: { id: true, dueOn: true, status: true, lastNotifiedAt: true, patientId: true, rule: { select: { leadDays: true, graceDays: true, lapseDays: true } }, type: { select: { name: true } }, patient: { select: { name: true, status: true, ownerships: { where: { role: 'primary', effectiveTo: null }, select: { clientId: true }, take: 1 } } } },
    take: 5000,
  })
  let changed = 0
  const toNotify = new Map<string, { reminderIds: string[]; lines: string[] }>()
  for (const r of open) {
    if (r.patient?.status !== 'active') {
      await uow.tx.patientReminder.update({ where: { id: r.id }, data: { status: 'suppressed', suppressedReason: `Patient ${r.patient?.status ?? 'missing'}`, version: { increment: 1 } } })
      changed++
      continue
    }
    const rule = { leadDays: r.rule?.leadDays ?? 30, graceDays: r.rule?.graceDays ?? 30, lapseDays: r.rule?.lapseDays ?? 180 }
    const next = reminderStatusOn({ dueOn: day(r.dueOn)!, status: r.status }, rule, on)
    if (next !== r.status) {
      await uow.tx.patientReminder.update({ where: { id: r.id }, data: { status: next, version: { increment: 1 } } })
      changed++
    }
    const notifiedRecently = r.lastNotifiedAt && r.lastNotifiedAt.getTime() > uow.now.getTime() - 14 * 86_400_000
    const clientId = r.patient?.ownerships[0]?.clientId
    if ((next === 'due' || next === 'overdue') && !notifiedRecently && clientId) {
      const entry = toNotify.get(clientId) ?? { reminderIds: [], lines: [] }
      entry.reminderIds.push(r.id)
      entry.lines.push(`${r.patient!.name}: ${r.type?.name ?? 'reminder'} ${next === 'overdue' ? 'overdue since' : 'due'} ${calendarDayText(day(r.dueOn))}`)
      toNotify.set(clientId, entry)
    }
  }
  for (const [clientId, entry] of toNotify) {
    uow.emit({ topic: 'notify.reminder', aggregateType: 'Client', aggregateId: clientId, payload: { clientId, locationId, reminderIds: entry.reminderIds, lines: entry.lines, purpose: 'care' }, dedupeKey: `notify.reminder:${clientId}:${on}` })
    await uow.tx.patientReminder.updateMany({ where: { id: { in: entry.reminderIds } }, data: { lastNotifiedAt: uow.now } })
  }
  return { on, checked: open.length, changed, notified: toNotify.size }
}
