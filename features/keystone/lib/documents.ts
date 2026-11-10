import { createHash } from 'node:crypto'
import type { Tx } from '../lib/db'
import type { UnitOfWork } from '../lib/unitOfWork'
import { calendarDayText } from '../domain/vaccines'

/*
 * Clinical document rendering (INTEGRATIONS §6): signing, discharging and issuing a certificate render, inline in the same transaction, turning a frozen source (a signed
 * encounter's signedContent, a rabies certificate, a discharge instruction) into a self-contained
 * HTML document stored on ClinicalDocument with its SHA-256. Rendering is deterministic: the same
 * source always gives the same bytes, so the hash proves the document was not altered and a
 * re-render after a crash changes nothing. PDF printing is the browser's (print stylesheet), and an
 * object store or e-sign adapter can take the body later without changing the source of truth.
 */

const esc = (value: unknown) =>
  String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

const words = (code: unknown) => String(code ?? '').replace(/_/g, ' ')
/** An instant in the clinic's zone with the zone written out ("Nov 8, 2026, 2:54 PM PST"). */
const zoned = (iso: string, timeZone: string) => new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(iso))
const instant = (iso: unknown, timeZone: string) => {
  if (!iso) return ''
  const d = new Date(String(iso))
  return Number.isNaN(d.getTime()) ? esc(iso) : new Intl.DateTimeFormat('en-US', { timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(d)
}

function page(title: string, body: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
body{font:14px/1.5 system-ui,sans-serif;color:#111;max-width:760px;margin:24px auto;padding:0 16px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:20px 0 6px;border-bottom:1px solid #ddd}
dl{display:grid;grid-template-columns:max-content 1fr;gap:2px 12px;margin:0}dt{color:#555}dd{margin:0}
pre{white-space:pre-wrap;font:inherit;margin:0}table{border-collapse:collapse;width:100%}td,th{text-align:left;padding:2px 6px;border-bottom:1px solid #eee;vertical-align:top}
.meta{color:#555;font-size:12px}@media print{body{margin:0}}
</style></head><body>${body}</body></html>`
}

const dl = (rows: [string, unknown][]) =>
  `<dl>${rows.filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`

type Signed = {
  encounter: { ref: string; kind: string; startedAt: string; reason?: string | null }
  patient: { ref?: string; name?: string; species?: string; breed?: string | null; sex?: string; reproductiveStatus?: string; dateOfBirth?: string | null }
  client: { ref?: string; name?: string; address?: string; phone?: string } | null
  sections: { kind: string; ordinal: number; body: string }[]
  vitals: Record<string, unknown>[]
  findings: { system: string; status: string; text: string }[]
  diagnoses: { term: string; certainty: string }[]
  orders: { ref: string; kind: string; description: string; status: string; route?: string | null; frequency?: string | null; administrations?: { qty: string; unit: string; route: string; lotNumber?: string | null; givenAt: string }[] }[]
  vaccines: { product?: { name: string }; lotNumber: string; administeredOn: string; dueNextOn?: string | null; site?: string; route?: string }[]
  anaesthesia: { ref: string; status: string; asaStatus: string }[]
  signer?: { name?: string; source?: string; staffMemberId?: string }
  signedAt?: string
}

const SECTION_ORDER = ['history', 'subjective', 'objective', 'assessment', 'plan', 'surgery_report', 'discharge', 'communication']

export function renderEncounterRecord(c: Signed, hash: string, timeZone: string, practice: string) {
  const sections = [...c.sections].sort((a, b) => (SECTION_ORDER.indexOf(a.kind) - SECTION_ORDER.indexOf(b.kind)) || a.ordinal - b.ordinal).filter(s => s.body.trim())
  const signer = c.signer?.source ? `${c.signer.name || 'Unnamed clinician'} (imported from ${c.signer.source})` : c.signer?.name
  const body = `
<h1>Medical record ${esc(c.encounter.ref)}</h1>
<p class="meta">${esc(practice)} · ${esc(words(c.encounter.kind))} · ${instant(c.encounter.startedAt, timeZone)}</p>
<h2>Patient</h2>${dl([['Name', c.patient.name], ['Patient no.', c.patient.ref], ['Species', c.patient.species], ['Breed', c.patient.breed], ['Sex', [c.patient.sex, c.patient.reproductiveStatus].filter(Boolean).map(words).join(', ')], ['Born', calendarDayText(c.patient.dateOfBirth)]])}
${c.client ? `<h2>Client</h2>${dl([['Name', c.client.name], ['Client no.', c.client.ref], ['Address', c.client.address], ['Phone', c.client.phone]])}` : ''}
${c.encounter.reason ? `<h2>Reason for visit</h2><pre>${esc(c.encounter.reason)}</pre>` : ''}
${sections.map(s => `<h2>${esc(words(s.kind).replace(/^\w/, ch => ch.toUpperCase()))}</h2><pre>${esc(s.body)}</pre>`).join('')}
${c.vitals.length ? `<h2>Vitals</h2><table>${c.vitals.map(v => `<tr><td>${instant(v.at, timeZone)}</td><td>${esc(Object.entries(v).filter(([k, x]) => k !== 'at' && x !== null && x !== '').map(([k, x]) => `${words(k)} ${x}`).join(' · '))}</td></tr>`).join('')}</table>` : ''}
${c.findings.length ? `<h2>Physical exam</h2><table>${c.findings.map(f => `<tr><td>${esc(words(f.system))}</td><td>${esc(words(f.status))}</td><td>${esc(f.text)}</td></tr>`).join('')}</table>` : ''}
${c.diagnoses.length ? `<h2>Diagnoses</h2><table>${c.diagnoses.map(d => `<tr><td>${esc(d.term)}</td><td>${esc(words(d.certainty))}</td></tr>`).join('')}</table>` : ''}
${c.orders.length ? `<h2>Orders and treatments</h2><table>${c.orders.map(o => `<tr><td>${esc(o.ref)}</td><td>${esc(o.description)}${o.route ? ` · ${esc(o.route)}` : ''}${o.frequency ? ` · ${esc(o.frequency)}` : ''}</td><td>${esc(words(o.status))}</td></tr>${(o.administrations ?? []).map(a => `<tr><td></td><td class="meta">Given ${esc(a.qty)} ${esc(a.unit)} ${esc(a.route)} ${a.lotNumber ? `lot ${esc(a.lotNumber)}` : ''}</td><td class="meta">${instant(a.givenAt, timeZone)}</td></tr>`).join('')}`).join('')}</table>` : ''}
${c.vaccines.length ? `<h2>Vaccines</h2><table>${c.vaccines.map(v => `<tr><td>${esc(v.product?.name)}</td><td>lot ${esc(v.lotNumber)}</td><td>${esc(calendarDayText(v.administeredOn))}</td><td>${v.dueNextOn ? `next due ${esc(calendarDayText(v.dueNextOn))}` : ''}</td></tr>`).join('')}</table>` : ''}
${c.anaesthesia.length ? `<h2>Anaesthesia</h2><table>${c.anaesthesia.map(a => `<tr><td>${esc(a.ref)}</td><td>ASA ${esc(a.asaStatus)}</td><td>${esc(words(a.status))}</td></tr>`).join('')}</table>` : ''}
<h2>Signature</h2>${dl([['Signed by', signer], ['Signed at', instant(c.signedAt, timeZone)], ['Content hash (SHA-256)', hash]])}
<p class="meta">This record is frozen at signing. Corrections appear as dated addenda and never change the text above.</p>`
  return page(`Medical record ${c.encounter.ref}`, body)
}

type Cert = { ref: string; vaccinatedOn: Date; nextDueOn: Date; durationMonths: number; tagNumber: string | null; fields: Record<string, unknown>; missingFields: string[]; createdAt?: Date | null }

/**
 * The certificate's dates are the clinic's calendar days (the vaccine was given on that local date),
 * and the issue time is shown in the clinic's time zone, named, so a reader in another zone cannot
 * mistake the day.
 */
export function renderRabiesCertificate(cert: Cert, practice: string, timeZone = 'America/Los_Angeles') {
  const f = cert.fields ?? {}
  const label = (k: string) => words(k).replace(/^\w/, ch => ch.toUpperCase())
  const rows = Object.entries(f).map(([k, v]) => [label(k), k === 'date_given' || k === 'next_due' ? calendarDayText(String(v)) : v] as [string, unknown])
  const body = `
<h1>Rabies vaccination certificate ${esc(cert.ref)}</h1>
<p class="meta">${esc(practice)} · Form 51-equivalent (NASPHV) fields · ${esc(cert.durationMonths)}-month vaccination</p>
${dl([['Vaccinated', `${calendarDayText(cert.vaccinatedOn.toISOString())} (clinic date, ${timeZone})`], ['Next due', calendarDayText(cert.nextDueOn.toISOString())], ['Tag number', cert.tagNumber], ['Issued', cert.createdAt ? `${zoned(cert.createdAt.toISOString(), timeZone)}` : null], ['Clinic time zone', timeZone]])}
<h2>Certificate</h2>${dl(rows)}
${cert.missingFields.length ? `<h2>Incomplete</h2><p>This certificate is missing: ${esc(cert.missingFields.map(words).join(', '))}. Complete them before giving it to the owner or the licensing agency.</p>` : ''}`
  return page(`Rabies certificate ${cert.ref}`, body)
}

type Discharge = { body: string; medsSummary: string | null; recheckOn: Date | null; patientName: string; staffName: string | null; at: Date }

export function renderDischarge(d: Discharge, timeZone: string, practice: string) {
  const body = `
<h1>Discharge instructions for ${esc(d.patientName)}</h1>
<p class="meta">${esc(practice)} · ${instant(d.at.toISOString(), timeZone)}${d.staffName ? ` · ${esc(d.staffName)}` : ''}</p>
<h2>Home care</h2><pre>${esc(d.body)}</pre>
${d.medsSummary ? `<h2>Medications</h2><pre>${esc(d.medsSummary)}</pre>` : ''}
${d.recheckOn ? `<h2>Recheck</h2><p>Please book a recheck for ${esc(calendarDayText(d.recheckOn.toISOString()))}.</p>` : ''}
<p class="meta">If your pet's breathing changes, it collapses, bleeds, or cannot keep water down, call us or the nearest emergency hospital now.</p>`
  return page(`Discharge instructions for ${d.patientName}`, body)
}

const sha = (html: string) => createHash('sha256').update(html, 'utf8').digest('hex')

async function practiceName(tx: Tx) {
  const loc = await tx.location.findFirst({ where: { active: true }, orderBy: { code: 'asc' }, select: { name: true, timeZone: true } })
  return { name: loc?.name ?? '', timeZone: loc?.timeZone ?? 'America/Los_Angeles' }
}

/** Store the rendered HTML on the ClinicalDocument and link it from the source (same transaction). */
async function store(uow: UnitOfWork, docId: string, html: string, link?: (tx: Tx) => Promise<unknown>) {
  const hash = sha(html)
  const updated = await uow.tx.clinicalDocument.updateMany({ where: { id: docId, status: { in: ['pending_render', 'failed'] } }, data: { status: 'rendered', body: html, mimeType: 'text/html', sha256: hash, renderedAt: uow.now, renderError: '', version: { increment: 1 } } })
  if (updated.count !== 1) return hash
  if (link) await link(uow.tx)
  uow.audit({ eventType: 'document.rendered', entityType: 'ClinicalDocument', entityId: docId, after: { sha256: hash }, metadata: { system: 'document-render' } })
  return hash
}

/** Render a signed encounter's ClinicalDocument (already created, pending_render). */
export async function renderEncounterDocument(uow: UnitOfWork, documentId: string) {
  const tx = uow.tx
  const practice = await practiceName(tx)
  const doc = await tx.clinicalDocument.findUnique({ where: { id: documentId }, select: { id: true, status: true, encounterId: true, sourceHash: true } })
  if (!doc || doc.status === 'rendered' || !doc.encounterId) return
  const enc = await tx.encounter.findUniqueOrThrow({ where: { id: doc.encounterId }, select: { id: true, signedContent: true, contentHash: true, location: { select: { name: true, timeZone: true } } } })
  if (!enc.signedContent || enc.contentHash !== doc.sourceHash) throw new Error(`Encounter ${enc.id} content does not match the document source hash`)
  const html = renderEncounterRecord(enc.signedContent as unknown as Signed, enc.contentHash!, enc.location?.timeZone ?? practice.timeZone, enc.location?.name ?? practice.name)
  await store(uow, doc.id, html, t => t.encounter.update({ where: { id: enc.id }, data: { documentId: doc.id } }))
}

/** Render a rabies certificate to a ClinicalDocument linked from the certificate. */
export async function renderRabiesDocument(uow: UnitOfWork, certificateId: string, locationId: string) {
  const tx = uow.tx
  const practice = await practiceName(tx)
  const cert = await tx.rabiesCertificate.findUnique({ where: { id: certificateId }, select: { id: true, ref: true, patientId: true, documentId: true, vaccinatedOn: true, nextDueOn: true, durationMonths: true, tagNumber: true, fields: true, missingFields: true, createdAt: true } })
  if (!cert || cert.documentId) return
  const loc = await tx.location.findUnique({ where: { id: locationId }, select: { name: true, timeZone: true } })
  const html = renderRabiesCertificate({ ...cert, fields: (cert.fields ?? {}) as Record<string, unknown>, missingFields: (cert.missingFields ?? []) as string[] }, loc?.name ?? practice.name, loc?.timeZone ?? practice.timeZone)
  const doc = await tx.clinicalDocument.create({ data: { patientId: cert.patientId, kind: 'rabies_certificate', title: `Rabies certificate ${cert.ref}`, status: 'pending_render', sourceType: 'RabiesCertificate', sourceId: cert.id, sourceHash: sha(JSON.stringify(cert.fields ?? {})) } })
  await store(uow, doc.id, html, t => t.rabiesCertificate.update({ where: { id: cert.id }, data: { documentId: doc.id } }))
}

/** Render a discharge instruction to a ClinicalDocument. */
export async function renderDischargeDocument(uow: UnitOfWork, instructionId: string) {
  const tx = uow.tx
  const practice = await practiceName(tx)
  const d = await tx.dischargeInstruction.findUnique({ where: { id: instructionId }, select: { id: true, body: true, medsSummary: true, recheckOn: true, createdAt: true, encounterId: true, patientId: true, patient: { select: { name: true } }, author: { select: { displayName: true } } } })
  if (!d) return
  const exists = await tx.clinicalDocument.findFirst({ where: { sourceType: 'DischargeInstruction', sourceId: d.id }, select: { id: true, status: true } })
  if (exists?.status === 'rendered') return
  const html = renderDischarge({ body: d.body, medsSummary: d.medsSummary || null, recheckOn: d.recheckOn, patientName: d.patient?.name ?? 'your pet', staffName: d.author?.displayName ?? null, at: d.createdAt ?? new Date() }, practice.timeZone, practice.name)
  const doc = exists ?? (await tx.clinicalDocument.create({ data: { patientId: d.patientId, encounterId: d.encounterId, kind: 'discharge', title: `Discharge instructions for ${d.patient?.name ?? 'patient'}`, status: 'pending_render', sourceType: 'DischargeInstruction', sourceId: d.id, sourceHash: sha(d.body) } }))
  await store(uow, doc.id, html)
}
