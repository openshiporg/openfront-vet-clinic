/*
 * Phase 2 reference data for Cedar Creek Animal Hospital (fictional practice). Vaccine products are
 * modelled on the kinds of USDA-licensed products US practices stock; names are generic descriptions,
 * not trademarks, and USDA product codes are left blank for the practice to fill from its own
 * stock. Reminder intervals follow the published guideline structure (core/non-core, initial series
 * to 16 weeks, booster at one year, then 1- or 3-year by label) and are marked unverified until the
 * practice's medical director checks them against current AAHA canine and AAHA/AAFP feline
 * guidelines [RESEARCH §6.1]. Dose ranges are the practice formulary, also unverified.
 */

export const REMINDER_TYPES = [
  { id: 'seed_rt_rabies', code: 'RABIES', name: 'Rabies', kind: 'vaccine' },
  { id: 'seed_rt_dhpp', code: 'DHPP', name: 'Distemper / parvo (DHPP)', kind: 'vaccine' },
  { id: 'seed_rt_lepto', code: 'LEPTO', name: 'Leptospirosis', kind: 'vaccine' },
  { id: 'seed_rt_bord', code: 'BORDETELLA', name: 'Bordetella (kennel cough)', kind: 'vaccine' },
  { id: 'seed_rt_civ', code: 'CIV', name: 'Canine influenza', kind: 'vaccine' },
  { id: 'seed_rt_fvrcp', code: 'FVRCP', name: 'Feline distemper (FVRCP)', kind: 'vaccine' },
  { id: 'seed_rt_felv', code: 'FELV', name: 'Feline leukaemia (FeLV)', kind: 'vaccine' },
  { id: 'seed_rt_heartworm', code: 'HW_TEST', name: 'Heartworm test', kind: 'test' },
  { id: 'seed_rt_wellness', code: 'WELLNESS', name: 'Annual wellness exam', kind: 'procedure' },
  { id: 'seed_rt_dental', code: 'DENTAL', name: 'Dental check', kind: 'procedure' },
] as const

export const VACCINE_PRODUCTS = [
  { id: 'seed_vx_rabies3_k9', name: 'Rabies 3-year (canine/feline, killed)', manufacturer: 'Zoetis', antigens: ['rabies'], species: ['canine', 'feline'], doi: 36, minAgeWeeks: 12, isRabies: true, route: 'sc', type: 'seed_rt_rabies' },
  { id: 'seed_vx_rabies1_fel', name: 'Rabies 1-year (feline, recombinant)', manufacturer: 'Boehringer Ingelheim', antigens: ['rabies'], species: ['feline'], doi: 12, minAgeWeeks: 12, isRabies: true, route: 'sc', type: 'seed_rt_rabies' },
  { id: 'seed_vx_dapp', name: 'DAPP (distemper, adenovirus-2, parvovirus, parainfluenza)', manufacturer: 'Merck Animal Health', antigens: ['CDV', 'CAV2', 'CPV', 'CPiV'], species: ['canine'], doi: 36, minAgeWeeks: 6, isRabies: false, route: 'sc', type: 'seed_rt_dhpp' },
  { id: 'seed_vx_lepto4', name: 'Leptospirosis 4-serovar', manufacturer: 'Zoetis', antigens: ['L. canicola', 'L. grippotyphosa', 'L. icterohaemorrhagiae', 'L. pomona'], species: ['canine'], doi: 12, minAgeWeeks: 8, isRabies: false, route: 'sc', type: 'seed_rt_lepto' },
  { id: 'seed_vx_bord_in', name: 'Bordetella intranasal', manufacturer: 'Merck Animal Health', antigens: ['B. bronchiseptica', 'CPiV'], species: ['canine'], doi: 12, minAgeWeeks: 8, isRabies: false, route: 'intranasal', type: 'seed_rt_bord' },
  { id: 'seed_vx_civ', name: 'Canine influenza bivalent (H3N2/H3N8)', manufacturer: 'Merck Animal Health', antigens: ['H3N2', 'H3N8'], species: ['canine'], doi: 12, minAgeWeeks: 8, isRabies: false, route: 'sc', type: 'seed_rt_civ' },
  { id: 'seed_vx_fvrcp', name: 'FVRCP (panleukopenia, herpesvirus-1, calicivirus)', manufacturer: 'Boehringer Ingelheim', antigens: ['FPV', 'FHV1', 'FCV'], species: ['feline'], doi: 36, minAgeWeeks: 6, isRabies: false, route: 'sc', type: 'seed_rt_fvrcp' },
  { id: 'seed_vx_felv', name: 'FeLV (recombinant)', manufacturer: 'Boehringer Ingelheim', antigens: ['FeLV'], species: ['feline'], doi: 12, minAgeWeeks: 8, isRabies: false, route: 'transdermal', type: 'seed_rt_felv' },
] as const

/** Lots at each location; one expired lot so the guard is visible on the vaccines screen. */
export const VACCINE_LOTS = [
  { id: 'seed_lot_rab_main', vaccine: 'seed_vx_rabies3_k9', location: 'seed_loc_main', lot: 'RB3-2611A', expiresOn: '2027-08-31' },
  { id: 'seed_lot_rab_eg', vaccine: 'seed_vx_rabies3_k9', location: 'seed_loc_elkgrove', lot: 'RB3-2609C', expiresOn: '2027-06-30' },
  { id: 'seed_lot_rabf_main', vaccine: 'seed_vx_rabies1_fel', location: 'seed_loc_main', lot: 'PRF-25418', expiresOn: '2027-03-31' },
  { id: 'seed_lot_dapp_main', vaccine: 'seed_vx_dapp', location: 'seed_loc_main', lot: 'NB-77310', expiresOn: '2027-11-30' },
  { id: 'seed_lot_dapp_old', vaccine: 'seed_vx_dapp', location: 'seed_loc_main', lot: 'NB-70142', expiresOn: '2026-10-31' },
  { id: 'seed_lot_dapp_eg', vaccine: 'seed_vx_dapp', location: 'seed_loc_elkgrove', lot: 'NB-77294', expiresOn: '2027-10-31' },
  { id: 'seed_lot_lepto_main', vaccine: 'seed_vx_lepto4', location: 'seed_loc_main', lot: 'L4-60918', expiresOn: '2027-05-31' },
  { id: 'seed_lot_bord_main', vaccine: 'seed_vx_bord_in', location: 'seed_loc_main', lot: 'BIN-3305', expiresOn: '2027-02-28' },
  { id: 'seed_lot_civ_main', vaccine: 'seed_vx_civ', location: 'seed_loc_main', lot: 'CIV-2214', expiresOn: '2027-04-30' },
  { id: 'seed_lot_fvrcp_main', vaccine: 'seed_vx_fvrcp', location: 'seed_loc_main', lot: 'PF-48820', expiresOn: '2027-09-30' },
  { id: 'seed_lot_felv_main', vaccine: 'seed_vx_felv', location: 'seed_loc_main', lot: 'PL-10377', expiresOn: '2027-07-31' },
] as const

export const DRUG_LOTS = [
  { id: 'seed_lot_carprofen_main', drug: 'seed_drug_carprofen', location: 'seed_loc_main', lot: 'CP-55102', expiresOn: '2027-12-31' },
  { id: 'seed_lot_gabapentin_main', drug: 'seed_drug_gabapentin', location: 'seed_loc_main', lot: 'GB-90311', expiresOn: '2028-01-31' },
  { id: 'seed_lot_meloxicam_main', drug: 'seed_drug_meloxicam', location: 'seed_loc_main', lot: 'MX-31877', expiresOn: '2027-06-30' },
  { id: 'seed_lot_cefovecin_main', drug: 'seed_drug_cefovecin', location: 'seed_loc_main', lot: 'CV-40219', expiresOn: '2027-03-31' },
  { id: 'seed_lot_maropitant_main', drug: 'seed_drug_maropitant', location: 'seed_loc_main', lot: 'MP-12088', expiresOn: '2027-08-31' },
  { id: 'seed_lot_lrs_main', drug: 'seed_drug_lrs', location: 'seed_loc_main', lot: 'LR-77015', expiresOn: '2028-04-30' },
] as const

/** Non-controlled formulary additions used on treatment sheets. */
export const CLINICAL_DRUGS = [
  { id: 'seed_drug_meloxicam', displayName: 'Meloxicam 5 mg/mL injection', genericName: 'meloxicam', brandName: 'Metacam', form: 'injectable', strength: '5', strengthUnit: 'mg', per: 'mL', concentration: '5', concentrationUnit: 'mg/mL', packageQty: '20', packageUnit: 'mL', approvalStatus: 'fda_approved', multiDoseBudDays: 28, ndc: '0010-6013-01' },
  { id: 'seed_drug_cefovecin', displayName: 'Cefovecin 80 mg/mL injection', genericName: 'cefovecin', brandName: 'Convenia', form: 'injectable', strength: '80', strengthUnit: 'mg', per: 'mL', concentration: '80', concentrationUnit: 'mg/mL', packageQty: '10', packageUnit: 'mL', approvalStatus: 'fda_approved', multiDoseBudDays: 28, ndc: '54771-5850-1' },
  { id: 'seed_drug_maropitant', displayName: 'Maropitant 10 mg/mL injection', genericName: 'maropitant', brandName: 'Cerenia', form: 'injectable', strength: '10', strengthUnit: 'mg', per: 'mL', concentration: '10', concentrationUnit: 'mg/mL', packageQty: '20', packageUnit: 'mL', approvalStatus: 'fda_approved', multiDoseBudDays: 90, ndc: '54771-5640-1' },
  { id: 'seed_drug_lrs', displayName: "Lactated Ringer's solution 1 L", genericName: "lactated Ringer's", brandName: '', form: 'injectable', strength: null, strengthUnit: '', per: 'mL', concentration: null, concentrationUnit: '', packageQty: '1000', packageUnit: 'mL', approvalStatus: 'human_label', multiDoseBudDays: null, ndc: '0338-0117-04' },
] as const

type Range = { min: string; max: string; unit: string; per: 'kg' }
const mgkg = (min: string, max: string): Range => ({ min, max, unit: 'mg', per: 'kg' })

/** Practice formulary dose ranges and caution flags (unverified; the medical director owns them). */
export const DOSE_FORMULARY: Record<string, { doseRanges: Record<string, Range>; cautionFlags?: string[]; measurableIncrement?: string }> = {
  seed_drug_meloxicam: { doseRanges: { canine: mgkg('0.1', '0.2'), feline: mgkg('0.05', '0.3') }, measurableIncrement: '0.01' },
  seed_drug_cefovecin: { doseRanges: { canine: mgkg('8', '8'), feline: mgkg('8', '8') }, measurableIncrement: '0.01' },
  seed_drug_maropitant: { doseRanges: { canine: mgkg('1', '1'), feline: mgkg('1', '1') }, measurableIncrement: '0.01' },
  seed_drug_carprofen: { doseRanges: { canine: mgkg('2', '4.4') }, measurableIncrement: '0.25' },
  seed_drug_gabapentin: { doseRanges: { canine: mgkg('5', '20'), feline: mgkg('5', '20') }, measurableIncrement: '1' },
  seed_drug_butorphanol: { doseRanges: { canine: mgkg('0.2', '0.4'), feline: mgkg('0.2', '0.4') }, cautionFlags: ['MDR1_risk'], measurableIncrement: '0.01' },
  seed_drug_buprenorphine: { doseRanges: { canine: mgkg('0.01', '0.02'), feline: mgkg('0.01', '0.03') }, measurableIncrement: '0.01' },
  seed_drug_hydromorphone: { doseRanges: { canine: mgkg('0.05', '0.1'), feline: mgkg('0.025', '0.05') }, measurableIncrement: '0.01' },
  seed_drug_midazolam: { doseRanges: { canine: mgkg('0.1', '0.3'), feline: mgkg('0.1', '0.3') }, measurableIncrement: '0.01' },
  seed_drug_ketamine: { doseRanges: { canine: mgkg('2', '5'), feline: mgkg('2', '5') }, measurableIncrement: '0.01' },
}

/** Breeds with the ABCB1 (MDR1) caution. */
export const MDR1_BREEDS = ['Border Collie', 'Rough Collie', 'Australian Shepherd']

/** Reminder protocols (one per species), published as version 1, unverified. */
export const REMINDER_PROTOCOLS = [
  {
    id: 'seed_rp_canine', code: 'CANINE_CORE', name: 'Canine wellness and vaccines', species: 'canine',
    rules: [
      { code: 'RABIES', satisfies: 'seed_rt_rabies', vaccines: ['seed_vx_rabies3_k9'], schedule: { boosterAfterFirstMonths: 12 }, leadDays: 30, graceDays: 30, lapseDays: 365 },
      { code: 'DHPP', satisfies: 'seed_rt_dhpp', vaccines: ['seed_vx_dapp'], schedule: { initialSeries: { doses: 4, intervalWeeks: 3, untilAgeWeeks: 16 } }, leadDays: 30, graceDays: 30, lapseDays: 365 },
      { code: 'LEPTO', satisfies: 'seed_rt_lepto', vaccines: ['seed_vx_lepto4'], schedule: { initialSeries: { doses: 2, intervalWeeks: 3, untilAgeWeeks: 52 } }, leadDays: 30, graceDays: 30, lapseDays: 180 },
      { code: 'BORDETELLA', satisfies: 'seed_rt_bord', vaccines: ['seed_vx_bord_in'], schedule: {}, leadDays: 21, graceDays: 14, lapseDays: 180 },
      { code: 'CIV', satisfies: 'seed_rt_civ', vaccines: ['seed_vx_civ'], schedule: { initialSeries: { doses: 2, intervalWeeks: 3, untilAgeWeeks: 520 } }, leadDays: 21, graceDays: 14, lapseDays: 180 },
    ],
    sourceRefs: [{ ref: 'S37', title: 'NASPHV Compendium of Animal Rabies Prevention and Control', url: 'https://www.cdc.gov/mmwr/preview/mmwrhtml/rr5603a1.htm' }, { ref: 'AAHA-C', title: 'AAHA Canine Vaccination Guidelines (practice to verify current edition)' }],
    unverified: ['DHPP', 'LEPTO', 'BORDETELLA', 'CIV'],
  },
  {
    id: 'seed_rp_feline', code: 'FELINE_CORE', name: 'Feline wellness and vaccines', species: 'feline',
    rules: [
      { code: 'RABIES', satisfies: 'seed_rt_rabies', vaccines: ['seed_vx_rabies3_k9', 'seed_vx_rabies1_fel'], schedule: { boosterAfterFirstMonths: 12 }, leadDays: 30, graceDays: 30, lapseDays: 365 },
      { code: 'FVRCP', satisfies: 'seed_rt_fvrcp', vaccines: ['seed_vx_fvrcp'], schedule: { initialSeries: { doses: 3, intervalWeeks: 4, untilAgeWeeks: 16 } }, leadDays: 30, graceDays: 30, lapseDays: 365 },
      { code: 'FELV', satisfies: 'seed_rt_felv', vaccines: ['seed_vx_felv'], schedule: { initialSeries: { doses: 2, intervalWeeks: 4, untilAgeWeeks: 52 } }, leadDays: 30, graceDays: 30, lapseDays: 180 },
    ],
    sourceRefs: [{ ref: 'S37', title: 'NASPHV Compendium of Animal Rabies Prevention and Control', url: 'https://www.cdc.gov/mmwr/preview/mmwrhtml/rr5603a1.htm' }, { ref: 'AAHA-F', title: 'AAHA/AAFP Feline Vaccination Guidelines (practice to verify current edition)' }],
    unverified: ['FVRCP', 'FELV'],
  },
] as const

export const WARDS = [
  { id: 'seed_ward_main_gen', location: 'seed_loc_main', name: 'Main ward', kind: 'general', cages: [['MW-01', 'small'], ['MW-02', 'small'], ['MW-03', 'medium'], ['MW-04', 'medium'], ['MW-05', 'large'], ['MW-06', 'run']] },
  { id: 'seed_ward_main_icu', location: 'seed_loc_main', name: 'ICU', kind: 'icu', cages: [['ICU-1', 'medium'], ['ICU-2', 'large']] },
  { id: 'seed_ward_main_iso', location: 'seed_loc_main', name: 'Isolation', kind: 'isolation', cages: [['ISO-1', 'large']] },
  { id: 'seed_ward_main_cat', location: 'seed_loc_main', name: 'Cat ward', kind: 'general', cages: [['CW-01', 'small'], ['CW-02', 'small'], ['CW-03', 'small']] },
  { id: 'seed_ward_eg_gen', location: 'seed_loc_elkgrove', name: 'Elk Grove ward', kind: 'general', cages: [['EG-01', 'small'], ['EG-02', 'medium'], ['EG-03', 'large']] },
] as const

export const DIAGNOSIS_CODES = [
  ['P-0001', 'Otitis externa', ['canine', 'feline']], ['P-0002', 'Acute gastroenteritis', ['canine', 'feline']], ['P-0003', 'Periodontal disease', ['canine', 'feline']],
  ['P-0004', 'Atopic dermatitis', ['canine']], ['P-0005', 'Cranial cruciate ligament rupture', ['canine']], ['P-0006', 'Osteoarthritis', ['canine', 'feline']],
  ['P-0007', 'Chronic kidney disease', ['feline', 'canine']], ['P-0008', 'Hyperthyroidism', ['feline']], ['P-0009', 'Diabetes mellitus', ['canine', 'feline']],
  ['P-0010', 'Feline lower urinary tract disease', ['feline']], ['P-0011', 'Pyoderma', ['canine']], ['P-0012', 'Dental fracture', ['canine', 'feline']],
  ['P-0013', 'Healthy, wellness visit', ['canine', 'feline', 'rabbit', 'ferret']], ['P-0014', 'Laceration', ['canine', 'feline']], ['P-0015', 'Foreign body ingestion', ['canine', 'feline']],
  ['P-0016', 'Pancreatitis', ['canine', 'feline']], ['P-0017', 'Hypothyroidism', ['canine']], ['P-0018', 'Mitral valve disease', ['canine']],
  ['P-0019', 'Upper respiratory infection', ['feline', 'rabbit']], ['P-0020', 'Gastrointestinal stasis', ['rabbit']],
] as const

export const RECORD_TEMPLATES = [
  { id: 'seed_tpl_wellness_obj', name: 'Wellness exam (normal)', kind: 'wellness', sectionKind: 'objective', body: 'Bright, alert and responsive. Hydration normal. MM pink, CRT < 2 s. Heart: no murmur or arrhythmia. Lungs clear bilaterally. Abdomen soft, non-painful, no masses. Lymph nodes normal. Skin and coat healthy. Eyes, ears and nose clear. Musculoskeletal normal gait. Teeth: grade 1 tartar.' },
  { id: 'seed_tpl_wellness_plan', name: 'Wellness plan', kind: 'wellness', sectionKind: 'plan', body: 'Vaccines per protocol today. Continue monthly heartworm, flea and tick prevention. Dental home care discussed. Recheck in 12 months or sooner if concerns.' },
  { id: 'seed_tpl_sick_hx', name: 'Sick visit history', kind: 'sick', sectionKind: 'history', body: 'Presenting complaint:\nDuration:\nAppetite / water intake:\nVomiting / diarrhoea:\nUrination:\nEnergy:\nMedications and diet:\nToxin exposure:' },
  { id: 'seed_tpl_discharge_dental', name: 'Dental discharge', kind: 'discharge', sectionKind: 'discharge', body: 'Soft food only for 3 days. No chew toys for 7 days. Give pain medication as labelled with food. Call us if you see facial swelling, bleeding that does not stop, or refusal to eat for more than 24 hours.' },
] as const

export const GLOSSARY = [
  ['BAR', 'bright, alert, responsive'], ['QAR', 'quiet, alert, responsive'], ['MM', 'mucous membranes'], ['CRT', 'capillary refill time'], ['BCS', 'body condition score'],
  ['NSF', 'no significant findings'], ['WNL', 'within normal limits'], ['V/D', 'vomiting and diarrhoea'], ['PU/PD', 'polyuria and polydipsia'], ['TPR', 'temperature, pulse, respiration'],
  ['SID', 'once daily'], ['BID', 'twice daily'], ['TID', 'three times daily'], ['PRN', 'as needed'], ['SQ', 'subcutaneous'], ['CCL', 'cranial cruciate ligament'],
] as const
