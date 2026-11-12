import type { Actor } from '../lib/actor'
import type { UnitOfWork } from '../lib/unitOfWork'
import { auditCreate } from '../lib/cas'

/*
 * Cedar Creek's standard fee schedule, published, with an emergency surcharge rule. Services are not taxed; retail goods are;
 * dispensed prescription medicines and vaccines given in the clinic follow the sales-tax pack for California (the pack is the
 * single place that says which categories pay). Prices are in cents.
 */

type Fee = { code: string; name: string; category: string; price: number; tax: string; unit?: string; min?: number; drug?: string; vaccine?: string; orderKind?: string; dispensing?: number }

const FEES: Fee[] = [
  { code: 'EXAM-OUTPATIENT', name: 'Wellness or sick exam', category: 'exam', price: 7800, tax: 'professional_service' },
  { code: 'EXAM-EMERGENCY', name: 'Emergency exam', category: 'exam', price: 15500, tax: 'professional_service' },
  { code: 'EXAM-INPATIENT_DAY', name: 'Day hospital exam', category: 'exam', price: 6500, tax: 'professional_service' },
  { code: 'EXAM-TECH_VISIT', name: 'Technician visit', category: 'exam', price: 3500, tax: 'professional_service' },
  { code: 'EXAM-TELEHEALTH', name: 'Telehealth consultation', category: 'consultation', price: 4500, tax: 'professional_service' },
  { code: 'EXAM-SURGERY', name: 'Surgical consultation', category: 'consultation', price: 6500, tax: 'professional_service' },
  { code: 'EXAM-DENTAL', name: 'Dental assessment', category: 'dental', price: 6500, tax: 'professional_service' },
  { code: 'VAX-RABIES3', name: 'Rabies vaccine, 3-year', category: 'vaccine', price: 2800, tax: 'vaccine_administered', vaccine: 'seed_vx_rabies3_k9' },
  { code: 'VAX-RABIES1-FEL', name: 'Rabies vaccine, 1-year cat', category: 'vaccine', price: 2600, tax: 'vaccine_administered', vaccine: 'seed_vx_rabies1_fel' },
  { code: 'VAX-DAPP', name: 'DAPP vaccine', category: 'vaccine', price: 3400, tax: 'vaccine_administered', vaccine: 'seed_vx_dapp' },
  { code: 'VAX-LEPTO', name: 'Leptospirosis vaccine', category: 'vaccine', price: 3200, tax: 'vaccine_administered', vaccine: 'seed_vx_lepto4' },
  { code: 'VAX-BORD', name: 'Bordetella vaccine', category: 'vaccine', price: 2800, tax: 'vaccine_administered', vaccine: 'seed_vx_bord_in' },
  { code: 'VAX-CIV', name: 'Canine influenza vaccine', category: 'vaccine', price: 3600, tax: 'vaccine_administered', vaccine: 'seed_vx_civ' },
  { code: 'VAX-FVRCP', name: 'FVRCP vaccine', category: 'vaccine', price: 3000, tax: 'vaccine_administered', vaccine: 'seed_vx_fvrcp' },
  { code: 'VAX-FELV', name: 'FeLV vaccine', category: 'vaccine', price: 3400, tax: 'vaccine_administered', vaccine: 'seed_vx_felv' },
  // Dispensed and injected medicines: the price is per unit given; dispensing adds a fee, an injection adds its own.
  { code: 'RX-CARPROFEN', name: 'Carprofen tablets', category: 'medication', price: 140, tax: 'rx_animal_drug', unit: 'tablet', drug: 'seed_drug_carprofen', dispensing: 500 },
  { code: 'RX-GABAPENTIN', name: 'Gabapentin capsules', category: 'medication', price: 90, tax: 'rx_animal_drug', unit: 'capsule', drug: 'seed_drug_gabapentin', dispensing: 500 },
  { code: 'RX-MELOXICAM-INJ', name: 'Meloxicam injection', category: 'injection', price: 1800, tax: 'rx_animal_drug', unit: 'mL', drug: 'seed_drug_meloxicam' },
  { code: 'RX-CEFOVECIN', name: 'Cefovecin long-acting antibiotic injection', category: 'injection', price: 6800, tax: 'rx_animal_drug', unit: 'mL', drug: 'seed_drug_cefovecin' },
  { code: 'RX-MAROPITANT', name: 'Maropitant anti-nausea injection', category: 'injection', price: 2600, tax: 'rx_animal_drug', unit: 'mL', drug: 'seed_drug_maropitant' },
  { code: 'RX-LRS', name: 'IV fluids, lactated Ringer\u2019s (1 L)', category: 'treatment', price: 3200, tax: 'rx_animal_drug', unit: 'each', drug: 'seed_drug_lrs' },
  { code: 'RX-BUTORPHANOL', name: 'Butorphanol injection', category: 'injection', price: 2200, tax: 'rx_animal_drug', unit: 'mL', drug: 'seed_drug_butorphanol' },
  { code: 'RX-BUPRENORPHINE', name: 'Buprenorphine injection', category: 'injection', price: 2400, tax: 'rx_animal_drug', unit: 'mL', drug: 'seed_drug_buprenorphine' },
  { code: 'RX-HYDROMORPHONE', name: 'Hydromorphone injection', category: 'injection', price: 2800, tax: 'rx_animal_drug', unit: 'mL', drug: 'seed_drug_hydromorphone' },
  { code: 'RX-KETAMINE', name: 'Ketamine anaesthetic', category: 'anaesthesia', price: 2400, tax: 'rx_animal_drug', unit: 'mL', drug: 'seed_drug_ketamine' },
  { code: 'RX-MIDAZOLAM', name: 'Midazolam sedation', category: 'anaesthesia', price: 1800, tax: 'rx_animal_drug', unit: 'mL', drug: 'seed_drug_midazolam' },
  // Services ordered in the chart.
  { code: 'LAB-CBC-CHEM', name: 'Blood panel: complete blood count and chemistry', category: 'laboratory', price: 14500, tax: 'professional_service', orderKind: 'lab' },
  { code: 'IMG-RADIOGRAPH', name: 'Radiographs, two views', category: 'imaging', price: 21000, tax: 'professional_service', orderKind: 'imaging' },
  { code: 'PROC-PROCEDURE', name: 'In-clinic procedure', category: 'surgery', price: 18500, tax: 'professional_service', orderKind: 'procedure' },
  { code: 'TRT-TREATMENT', name: 'Treatment and nursing care', category: 'treatment', price: 4500, tax: 'professional_service', orderKind: 'treatment' },
  { code: 'TRT-NURSING', name: 'Nursing care', category: 'treatment', price: 2500, tax: 'professional_service', orderKind: 'nursing' },
  { code: 'TRT-FLUIDS', name: 'IV fluid therapy', category: 'treatment', price: 6500, tax: 'professional_service', orderKind: 'fluid' },
  { code: 'DIET-PRESCRIPTION', name: 'Therapeutic diet, per can', category: 'diet', price: 380, tax: 'diet', orderKind: 'diet', unit: 'can' },
  { code: 'DENT-CLEANING', name: 'Dental cleaning with polish (under anaesthesia)', category: 'dental', price: 42500, tax: 'professional_service' },
  { code: 'DENT-EXTRACTION', name: 'Tooth extraction, per tooth', category: 'dental', price: 8500, tax: 'professional_service' },
  { code: 'SURG-SPAY-K9', name: 'Spay, dog', category: 'surgery', price: 62000, tax: 'professional_service' },
  { code: 'SURG-NEUTER-FEL', name: 'Neuter, cat', category: 'surgery', price: 24500, tax: 'professional_service' },
  { code: 'ANES-MONITOR', name: 'Anaesthesia and monitoring', category: 'anaesthesia', price: 18000, tax: 'professional_service' },
  { code: 'HOSP-DAY', name: 'Hospitalisation, per day', category: 'hospitalisation', price: 11000, tax: 'professional_service' },
  { code: 'EUTH-CREMATION', name: 'Euthanasia with private cremation', category: 'euthanasia', price: 38500, tax: 'professional_service' },
  { code: 'CARE-MEMORIAL', name: 'Paw print memorial', category: 'aftercare', price: 4500, tax: 'merchandise' },
  { code: 'FEE-RECORDS', name: 'Records copy', category: 'fee', price: 1500, tax: 'professional_service' },
]

export async function seedBilling(uow: UnitOfWork, actor: Actor, count: (k: string, n: number) => void) {
  const { tx, now } = uow
  if (await tx.feeSchedule.findFirst({ where: { code: 'standard' }, select: { id: true } })) return
  const schedule = await tx.feeSchedule.create({ data: { id: 'seed_fee_standard', name: 'Standard fees', code: 'standard' } })
  const version = await tx.feeScheduleVersion.create({ data: { id: 'seed_fee_standard_v1', scheduleId: schedule.id, versionNo: 1, label: 'Fees from January', status: 'draft' } })
  const drugs = new Set((await tx.drugProduct.findMany({ select: { id: true } })).map(d => d.id))
  const vaccines = new Set((await tx.vaccineProduct.findMany({ select: { id: true } })).map(v => v.id))
  const items = await tx.item.findMany({ select: { id: true, drugId: true, vaccineId: true } })
  const itemFor = new Map(items.map(i => [i.drugId ?? i.vaccineId ?? '', i.id]))
  let made = 0
  for (const f of FEES) {
    if (f.drug && !drugs.has(f.drug)) continue
    if (f.vaccine && !vaccines.has(f.vaccine)) continue
    await tx.feeItem.create({
      data: {
        versionId: version.id, code: f.code, name: f.name, category: f.category, priceMinor: BigInt(f.price), unit: (f.unit as never) ?? 'each', taxCategory: f.tax, orderKind: f.orderKind ?? '',
        drugId: f.drug ?? null, vaccineId: f.vaccine ?? null, itemId: itemFor.get(f.drug ?? f.vaccine ?? '') ?? null, dispensingFeeMinor: f.dispensing ? BigInt(f.dispensing) : null,
        minimumChargeMinor: f.drug && f.category === 'injection' ? 1500n : null,
      },
    })
    made += 1
  }
  await tx.priceRule.create({ data: { versionId: version.id, name: 'Emergency visit surcharge', kind: 'emergency', adjustmentBps: 2500, conditions: {} } })
  // Published by the seed itself (a change after this goes through approval).
  await tx.feeScheduleVersion.update({ where: { id: version.id }, data: { status: 'published', publishedAt: now, effectiveFrom: new Date('2026-01-01T00:00:00Z') } })
  auditCreate(uow, actor, 'FeeScheduleVersion', version.id, 'fees.published', { items: made, seeded: true })
  count('feeItems', made)
}
