import type { PolicyKind, PolicyLayer } from '../domain/policy'

/**
 * Seed policy packs (DOMAIN §7, BUILD-PLAN §5): the federal baseline, the California pack, and the
 * practice's own local choices (witnessing, count frequency, boarding vaccines). Every rule cites its
 * source; rules we could not check against a primary text are listed in `unverified`, which keeps the
 * version's `verified` flag false and shows a banner wherever it applies. Changing any of this is a
 * new PolicyVersion through maker-checker, never a code change.
 *
 * Source keys are RESEARCH.md §21 references ([S#]).
 */

export type SourceRef = { ref: string; title: string; url?: string; section?: string }
export type PackSeed = {
  code: string; name: string; kind: PolicyKind; jurisdiction: string; layer: PolicyLayer
  bind: 'practice' | 'locations_in_state'
  effectiveFrom: string; rules: Record<string, unknown>; sourceRefs: SourceRef[]; unverified: string[]; verifiedAt: string | null
}

const VERIFIED_AT = '2026-11-07T00:00:00Z'
const ECFR = (part: string) => `https://www.law.cornell.edu/cfr/text/21/${part}`

const S = {
  S25: { ref: 'S25', title: '21 CFR 1304.11 Inventory requirements', url: ECFR('1304.11') },
  S27: { ref: 'S27', title: '21 CFR 1304.04 Maintenance of records and inventories', url: ECFR('1304.04') },
  S30: { ref: 'S30', title: '21 CFR 1301.76 Other security controls for practitioners', url: ECFR('1301.76'), section: '(b)' },
  S31: { ref: 'S31', title: '21 CFR 1317.95 Destruction procedures', url: ECFR('1317.95') },
  S34: { ref: 'S34', title: '21 CFR 530.3(i) Valid veterinarian-client-patient relationship', url: 'https://www.ecfr.gov/current/title-21/part-530/section-530.3' },
  S35: { ref: 'S35', title: 'FDA, VCPR, prescribing/dispensing and telemedicine', url: 'https://www.fda.gov/animal-veterinary/product-safety-information/veterinarian-client-patient-relationships-prescribingdispensing-animal-drugs-and-telemedicine' },
  S37: { ref: 'S37', title: 'NASPHV Compendium of Animal Rabies Prevention and Control', url: 'https://www.cdc.gov/mmwr/preview/mmwrhtml/rr5603a1.htm' },
  S39: { ref: 'S39', title: '16 CCR 2032.3 Record keeping; records; contents; transfer', url: 'https://www.law.cornell.edu/regulations/california/16-CCR-2032.3' },
  S46: { ref: 'S46', title: '21 CFR 1304.21 General requirements for continuing records', url: ECFR('1304.21') },
  S47: { ref: 'S47', title: '21 CFR 1305.13 Procedure for filling DEA Forms 222', url: ECFR('1305.13') },
  S48: { ref: 'S48', title: '21 CFR 1301.12 Separate registrations for separate locations', url: ECFR('1301.12') },
  S49: { ref: 'S49', title: '21 CFR 1306.12 Refilling prescriptions (Schedule II)', url: ECFR('1306.12') },
  S50: { ref: 'S50', title: '21 CFR 1306.22 Refilling of prescriptions (Schedules III and IV)', url: ECFR('1306.22') },
  S52: { ref: 'S52', title: '21 CFR 1304.04 (2-year retention; order forms at each location)', url: ECFR('1304.04') },
  S53: { ref: 'S53', title: 'California DOJ, CURES (HSC §11165(d); veterinarians report within 7 days)', url: 'https://oag.ca.gov/cures' },
  S54: { ref: 'S54', title: '21 CFR 558.6 Veterinary feed directive drugs', url: ECFR('558.6') },
  S56: { ref: 'S56', title: 'FCC 24-17 Declaratory Ruling (AI voices are artificial voices under the TCPA)', url: 'https://docs.fcc.gov/public/attachments/FCC-24-17A1.pdf' },
  TCPA: { ref: '47 CFR 64.1200(c)(1)', title: 'TCPA calling-time restriction (8 a.m. to 9 p.m. local)', url: 'https://www.law.cornell.edu/cfr/text/47/64.1200' },
  WIRETAP: { ref: '18 U.S.C. 2511(2)(d)', title: 'Federal one-party consent to record', url: 'https://www.law.cornell.edu/uscode/text/18/2511' },
  CAPC632: { ref: 'Cal. Penal Code §632', title: 'California confidential communications (all-party consent)', url: 'https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?sectionNum=632.&lawCode=PEN' },
  CABP4857: { ref: 'Cal. B&P §4857', title: 'Confidentiality of veterinary records', url: 'https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?sectionNum=4857.&lawCode=BPC' },
  CABP4826: { ref: 'Cal. B&P §4826.6', title: 'Veterinarian-client-patient relationship and telehealth', url: 'https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?sectionNum=4826.6.&lawCode=BPC' },
  CABP17600: { ref: 'Cal. B&P §17600 et seq.', title: 'California Automatic Renewal Law', url: 'https://leginfo.legislature.ca.gov/faces/codes_displayText.xhtml?lawCode=BPC&division=7.&part=3.&chapter=1.&article=9.' },
  CAHSC121690: { ref: 'Cal. HSC §121690', title: 'Dog rabies vaccination', url: 'https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?sectionNum=121690.&lawCode=HSC' },
  CA2036: { ref: '16 CCR 2036', title: 'Animal health care tasks for RVTs', url: 'https://www.law.cornell.edu/regulations/california/16-CCR-2036' },
  CABP4836: { ref: 'Cal. B&P §4836.1', title: 'Veterinary assistant controlled substance permit', url: 'https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?sectionNum=4836.1.&lawCode=BPC' },
  CDTFA: { ref: 'CDTFA Pub. 32 / Reg. 1591', title: 'Sales tax on veterinary medicines and products', url: 'https://www.cdtfa.ca.gov/' },
  PRACTICE: { ref: 'practice', title: 'Cedar Creek Animal Hospital standard operating procedure (practice choice)' },
}

const ALL_CS = ['CII', 'CIIN', 'CIII', 'CIIIN', 'CIV', 'CV'] as const

export const POLICY_PACKS: PackSeed[] = [
  // ── Controlled substances ───────────────────────────────────────────────────────────────
  {
    code: 'US/controlled_substances', name: 'DEA controlled substances (federal)', kind: 'controlled_substances', jurisdiction: 'US', layer: 'federal', bind: 'practice', effectiveFrom: '2026-01-01',
    rules: {
      recordRetentionYears: 2, biennialInventoryMaxDays: 730, theftLossNoticeBusinessDays: 1, form106Days: 45, orderFormValidityDays: 60, destructionWitnesses: 2,
      separateRegistrationPerLocation: true, ciiSeparateRecords: true,
      witnessRequired: { destroy: true },
      stateScheduled: [],
      pdmp: { required: false, maxDays: 0, format: 'none', schedules: [], program: 'none' },
    },
    sourceRefs: [S.S27, S.S52, S.S25, S.S30, S.S47, S.S31, S.S48, S.S46], unverified: [], verifiedAt: VERIFIED_AT,
  },
  {
    code: 'US-CA/controlled_substances', name: 'California controlled substances (CURES)', kind: 'controlled_substances', jurisdiction: 'US-CA', layer: 'state', bind: 'locations_in_state', effectiveFrom: '2026-01-01',
    rules: {
      recordRetentionYears: 3,
      stateScheduled: [],
      pdmp: { required: true, maxDays: 7, format: 'ASAP 4.2B', schedules: [...ALL_CS], program: 'CURES' },
    },
    sourceRefs: [S.S53, S.S39],
    unverified: ['recordRetentionYears (CA CS record retention aligned to 16 CCR 2032.3 three years)', 'stateScheduled (gabapentin is not CA-scheduled as of this version)'],
    verifiedAt: VERIFIED_AT,
  },
  {
    code: 'CCAH/controlled_substances', name: 'Cedar Creek controlled-substance procedure', kind: 'controlled_substances', jurisdiction: 'CCAH', layer: 'local', bind: 'practice', effectiveFrom: '2026-01-01',
    rules: {
      witnessRequired: { receive: false, administer: false, dispense: false, waste: true, destroy: true, transfer_out: true, transfer_in: false, adjust: true, return_to_supplier: true, loss: true },
      countFrequencyDays: { CI: 0, CII: 7, CIIN: 7, CIII: 7, CIIIN: 7, CIV: 30, CV: 30 },
    },
    sourceRefs: [S.PRACTICE], unverified: [], verifiedAt: VERIFIED_AT,
  },
  // ── VCPR ─────────────────────────────────────────────────────────────────────────────────
  {
    code: 'US/vcpr', name: 'FDA VCPR (extralabel and VFD)', kind: 'vcpr', jurisdiction: 'US', layer: 'federal', bind: 'practice', effectiveFrom: '2026-01-01',
    rules: { establishment: 'in_person_only', level: 'dvm', requiredFor: ['prescription', 'refill', 'extralabel', 'vfd', 'telehealth_treatment'] },
    sourceRefs: [S.S34, S.S35, S.S54], unverified: [], verifiedAt: VERIFIED_AT,
  },
  {
    code: 'US-CA/vcpr', name: 'California VCPR', kind: 'vcpr', jurisdiction: 'US-CA', layer: 'state', bind: 'locations_in_state', effectiveFrom: '2026-01-01',
    rules: { establishment: 'in_person_or_telehealth', durationMonths: 12, level: 'practice' },
    sourceRefs: [S.CABP4826],
    unverified: ['establishment (telehealth establishment and its limits under B&P §4826.6)', 'durationMonths', 'level (practice-level VCPR coverage)'],
    verifiedAt: null,
  },
  // ── Prescriptions ────────────────────────────────────────────────────────────────────────
  {
    code: 'US/prescription', name: 'Federal prescription rules', kind: 'prescription', jurisdiction: 'US', layer: 'federal', bind: 'practice', effectiveFrom: '2026-01-01',
    rules: {
      refillLimits: { CI: { maxRefills: 0, maxMonths: 0 }, CII: { maxRefills: 0, maxMonths: 0 }, CIIN: { maxRefills: 0, maxMonths: 0 }, CIII: { maxRefills: 5, maxMonths: 6 }, CIIIN: { maxRefills: 5, maxMonths: 6 }, CIV: { maxRefills: 5, maxMonths: 6 }, CV: { maxRefills: 5, maxMonths: 6 } },
      vfdDefaultExpiryMonths: 6,
    },
    sourceRefs: [S.S49, S.S50, S.S54], unverified: ['refillLimits.CV (federal law leaves CV refills to the prescriber; the practice applies the CIII/IV limit)'], verifiedAt: VERIFIED_AT,
  },
  {
    code: 'US-CA/prescription', name: 'California prescription and label rules', kind: 'prescription', jurisdiction: 'US-CA', layer: 'state', bind: 'locations_in_state', effectiveFrom: '2026-01-01',
    rules: {
      defaultExpiryMonths: 12, writtenRxOnRequest: true,
      labelFields: ['patient_name', 'species', 'client_name', 'drug_name', 'strength', 'quantity', 'directions', 'prescriber_name', 'practice_name_address_phone', 'date_dispensed', 'expiry_date', 'cautionary_statements', 'rx_number'],
    },
    sourceRefs: [S.S39], unverified: ['defaultExpiryMonths', 'writtenRxOnRequest', 'labelFields (CA label content)'], verifiedAt: null,
  },
  // ── Medical records and confidentiality ─────────────────────────────────────────────────
  {
    code: 'US-CA/medical_records', name: 'California medical records (16 CCR 2032.3)', kind: 'medical_records', jurisdiction: 'US-CA', layer: 'state', bind: 'locations_in_state', effectiveFrom: '2026-01-01',
    rules: {
      retentionYearsAfterLastVisit: 3,
      requiredFields: ['client_name_address_phone', 'patient_name_species_breed_age_sex_colour', 'date_of_visit', 'history', 'physical_exam', 'diagnosis_or_assessment', 'treatment_plan', 'medications_dose_route_frequency', 'anaesthesia_record', 'surgery_record', 'prognosis', 'author_identity'],
      clientCopyDays: 5, summaryInsteadOfCopyAllowed: true,
    },
    sourceRefs: [S.S39], unverified: ['clientCopyDays (5-day summary deadline)'], verifiedAt: VERIFIED_AT,
  },
  {
    code: 'US-CA/confidentiality', name: 'California record confidentiality', kind: 'confidentiality', jurisdiction: 'US-CA', layer: 'state', bind: 'locations_in_state', effectiveFrom: '2026-01-01',
    rules: {
      releaseBases: ['client_of_record', 'authorised_person', 'referral_with_authorisation', 'insurer_with_authorisation', 'court_order', 'subpoena', 'public_health'],
      agentMayRelease: ['client_of_record'],
    },
    sourceRefs: [S.CABP4857], unverified: ['releaseBases (B&P §4857 text)'], verifiedAt: null,
  },
  // ── Contact, consent and AI voice ───────────────────────────────────────────────────────
  {
    code: 'US/contact', name: 'TCPA and FCC AI voice (federal)', kind: 'contact', jurisdiction: 'US', layer: 'federal', bind: 'practice', effectiveFrom: '2026-01-01',
    rules: {
      quietHours: { start: '21:00', end: '08:00' }, aiVoiceDisclosure: true, recordingConsent: 'one_party',
      consentPurposes: { care: 'implied', transactional: 'implied', marketing: 'express_written', ai_voice: 'express', recording: 'implied' },
      outboundAiVoiceAllowed: false,
    },
    sourceRefs: [S.TCPA, S.S56, S.WIRETAP], unverified: [], verifiedAt: VERIFIED_AT,
  },
  {
    code: 'US-CA/contact', name: 'California recording consent', kind: 'contact', jurisdiction: 'US-CA', layer: 'state', bind: 'locations_in_state', effectiveFrom: '2026-01-01',
    rules: { recordingConsent: 'all_party', consentPurposes: { recording: 'express' } },
    sourceRefs: [S.CAPC632], unverified: ['quietHours (no stricter CA window confirmed; federal 8 a.m.-9 p.m. applies)'], verifiedAt: null,
  },
  // ── Rabies ───────────────────────────────────────────────────────────────────────────────
  {
    code: 'US-CA/rabies', name: 'California rabies vaccination', kind: 'rabies', jurisdiction: 'US-CA', layer: 'state', bind: 'locations_in_state', effectiveFrom: '2026-01-01',
    rules: {
      certificateFormat: 'NASPHV Form 51 equivalent', maxDurationMonths: 36, firstDoseMinAgeWeeks: 12, boosterAfterFirstMonths: 12,
      reportBitesTo: 'Sacramento County Animal Care Services', biteObservationDays: 10,
      certificateFields: ['owner_name_address', 'animal_name_species_breed_sex_age_colour', 'microchip', 'vaccine_manufacturer_product_lot', 'date_given', 'duration', 'next_due', 'tag_number', 'veterinarian_name_licence_signature'],
    },
    sourceRefs: [S.S37, S.CAHSC121690], unverified: ['firstDoseMinAgeWeeks', 'reportBitesTo'], verifiedAt: null,
  },
  // ── Supervision and licensure ───────────────────────────────────────────────────────────
  {
    code: 'US-CA/supervision', name: 'California RVT and assistant tasks', kind: 'supervision', jurisdiction: 'US-CA', layer: 'state', bind: 'locations_in_state', effectiveFrom: '2026-01-01',
    rules: {
      tasks: {
        induce_anaesthesia: { allowedKinds: ['dvm', 'rvt'], supervision: 'direct' },
        administer_controlled: { allowedKinds: ['dvm', 'rvt', 'assistant'], supervision: 'indirect' },
        administer_vaccine: { allowedKinds: ['dvm', 'rvt', 'assistant'], supervision: 'indirect' },
        dental_extraction: { allowedKinds: ['dvm'], supervision: 'none' },
        euthanasia: { allowedKinds: ['dvm'], supervision: 'none' },
      },
    },
    sourceRefs: [S.CA2036, S.CABP4836], unverified: ['tasks (task list and supervision levels per 16 CCR 2036)'], verifiedAt: null,
  },
  {
    code: 'US-CA/licensure', name: 'California licensed acts', kind: 'licensure', jurisdiction: 'US-CA', layer: 'state', bind: 'locations_in_state', effectiveFrom: '2026-01-01',
    rules: {
      licenceKindsByAction: {
        examine: ['veterinarian'], diagnose: ['veterinarian'], prescribe: ['veterinarian'], sign_record: ['veterinarian'], approve_refill: ['veterinarian'],
        perform_surgery: ['veterinarian'], authorise_euthanasia: ['veterinarian'], establish_vcpr: ['veterinarian'],
        induce_anaesthesia: ['veterinarian', 'registered_veterinary_technician'],
        administer_controlled: ['veterinarian', 'registered_veterinary_technician', 'veterinary_assistant_cs_permit'],
      },
      licenceMustMatchLocationState: true, expiryWarningDays: 60,
    },
    sourceRefs: [S.CA2036, S.CABP4836], unverified: [], verifiedAt: VERIFIED_AT,
  },
  // ── Telehealth, auto-renewal, tax, boarding ─────────────────────────────────────────────
  {
    code: 'US-CA/telehealth', name: 'California veterinary telehealth', kind: 'telehealth', jurisdiction: 'US-CA', layer: 'state', bind: 'locations_in_state', effectiveFrom: '2026-01-01',
    rules: { allowed: true, mayEstablishVcpr: true, prescribingLimits: 'Limits on supply without an in-person exam per B&P §4826.6; controlled substances need an in-person exam.' },
    sourceRefs: [S.CABP4826], unverified: ['mayEstablishVcpr', 'prescribingLimits'], verifiedAt: null,
  },
  {
    code: 'US-CA/auto_renewal', name: 'California Automatic Renewal Law', kind: 'auto_renewal', jurisdiction: 'US-CA', layer: 'state', bind: 'locations_in_state', effectiveFrom: '2026-01-01',
    rules: { disclosureRequired: true, affirmativeConsent: true, onlineCancellation: true, renewalNoticeDays: 15 },
    sourceRefs: [S.CABP17600], unverified: ['renewalNoticeDays'], verifiedAt: null,
  },
  {
    code: 'US-CA/sales_tax', name: 'California sales tax on veterinary sales', kind: 'sales_tax', jurisdiction: 'US-CA', layer: 'state', bind: 'locations_in_state', effectiveFrom: '2026-01-01',
    rules: {
      baseRate: '0.0725',
      taxableCategories: ['retail_product', 'diet', 'otc_parasiticide', 'supplies', 'merchandise'],
      exemptCategories: ['professional_service', 'rx_animal_drug', 'vaccine_administered', 'boarding', 'grooming'],
    },
    sourceRefs: [S.CDTFA], unverified: ['baseRate (district add-ons apply per location)', 'exemptCategories.rx_animal_drug', 'exemptCategories.vaccine_administered'], verifiedAt: null,
  },
  {
    code: 'CCAH/boarding', name: 'Cedar Creek boarding requirements', kind: 'boarding', jurisdiction: 'CCAH', layer: 'local', bind: 'practice', effectiveFrom: '2026-01-01',
    rules: { requiredVaccines: { dog: ['rabies', 'dapp', 'bordetella'], cat: ['rabies', 'fvrcp'] }, gracePeriodDays: 0 },
    sourceRefs: [S.PRACTICE], unverified: [], verifiedAt: VERIFIED_AT,
  },
]
