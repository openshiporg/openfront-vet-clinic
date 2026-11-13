/* Plain data, no imports: the onboarding dialog (client) lists it and seed/labs.ts loads it. */

/*
 * The in-house analyser catalog a new practice may take at onboarding: the in-house lab, two common tests priced from the standard
 * fee list, the analytes, their codes and reference ranges for dogs and cats. Ranges are typical adult published intervals; the
 * practice edits them to its own analysers. Reference laboratories are the practice's own to add (Lab set-up screen).
 */
export const IN_HOUSE = { code: 'INHOUSE', name: 'In-house analysers', kind: 'in_house', intake: 'manual' } as const

export const ANALYTES = [
  { code: 'WBC', name: 'White blood cells', unit: '10^9/L' },
  { code: 'HCT', name: 'Haematocrit', unit: '%' },
  { code: 'PLT', name: 'Platelets', unit: '10^9/L' },
  { code: 'GLU', name: 'Glucose', unit: 'mmol/L' },
  { code: 'BUN', name: 'Urea nitrogen', unit: 'mmol/L' },
  { code: 'CREA', name: 'Creatinine', unit: 'umol/L' },
  { code: 'ALT', name: 'Alanine aminotransferase', unit: 'U/L' },
  { code: 'TP', name: 'Total protein', unit: 'g/L' },
  { code: 'T4', name: 'Total thyroxine', unit: 'nmol/L' },
  { code: 'USG', name: 'Urine specific gravity', unit: '' },
] as const

// [test code, name, fee code, turnaround hours, analytes]
export const TESTS = [
  ['GLU', 'Blood glucose', 'LAB-IH-GLUCOSE', 1, ['GLU']],
  ['PCVTP', 'Packed cell volume and total protein', 'LAB-IH-PCV-TP', 1, ['HCT', 'TP']],
] as const

// [analyte, species code, low, high, critical low, critical high]
export const RANGES = [
  ['WBC', 'canine', '5.5', '16.9', null, '40'], ['WBC', 'feline', '5.5', '19.5', null, '40'],
  ['HCT', 'canine', '37', '55', '20', null], ['HCT', 'feline', '30', '45', '15', null],
  ['PLT', 'canine', '175', '500', '50', null], ['PLT', 'feline', '175', '600', '50', null],
  ['GLU', 'canine', '4.1', '7.9', '3.0', '20'], ['GLU', 'feline', '4.0', '8.8', '3.0', '25'],
  ['BUN', 'canine', '2.5', '9.6', null, '30'], ['BUN', 'feline', '5.7', '12.9', null, '30'],
  ['CREA', 'canine', '44', '159', null, '500'], ['CREA', 'feline', '71', '212', null, '500'],
  ['ALT', 'canine', '10', '125', null, '1000'], ['ALT', 'feline', '12', '130', null, '1000'],
  ['TP', 'canine', '52', '82', '35', null], ['TP', 'feline', '57', '89', '35', null],
  ['T4', 'canine', '13', '51', null, null], ['T4', 'feline', '10', '60', null, null],
  ['USG', 'canine', '1.015', '1.045', null, null], ['USG', 'feline', '1.035', '1.060', null, null],
] as const

/** What the in-house catalog adds, for the onboarding list and the lab set-up screen. */
export const IN_HOUSE_CATALOG = {
  lab: IN_HOUSE.name,
  tests: TESTS.map(t => t[1]),
  analytes: ANALYTES.length,
}
