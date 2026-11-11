/**
 * ASAP 4.2B prescription-monitoring file (American Society for Automation in Pharmacy, Telecommunications
 * Standard for Prescription Monitoring Programs, version 4.2B). Segments end with "~", fields are separated
 * by "*", dates are CCYYMMDD. The writer is a pure function of its input (no clock, no randomness), so a
 * golden file proves the bytes. Only fields a veterinary dispenser reports are written; CURES' own data
 * dictionary is the final word on which are required, and the policy pack lists that as unverified.
 */
export type AsapDispense = {
  rxNumber: string
  dateWritten: string
  refillsAuthorised: number
  dateFilled: string
  refillNumber: number
  ndc: string
  quantity: string
  daysSupply: number
  schedule: string
  ownerLastName: string
  ownerFirstName: string
  ownerAddress: string
  ownerCity: string
  ownerState: string
  ownerPostal: string
  species: string
  animalName: string
  prescriberDea: string
  prescriberLastName: string
  prescriberFirstName: string
}

export type AsapFile = {
  controlNumber: string
  /** CCYYMMDD */
  createdDate: string
  /** HHMMSS */
  createdTime: string
  senderDea: string
  senderName: string
  pharmacyDea: string
  pharmacyName: string
  pharmacyAddress: string
  pharmacyCity: string
  pharmacyState: string
  pharmacyPostal: string
  dispenses: AsapDispense[]
}

const SPECIES: Record<string, string> = { canine: '02', feline: '03', equine: '04', other: '99' }
export const asapSpeciesCode = (species: string) => SPECIES[species.toLowerCase()] ?? '99'

/** Delimiters may not appear inside a value. */
const clean = (value: string | number) => String(value).replace(/[*~\r\n]/g, ' ').trim()
const ymd = (iso: string) => iso.slice(0, 10).replaceAll('-', '')
const segment = (name: string, ...fields: (string | number)[]) => `${name}*${fields.map(clean).join('*')}~`

export function buildAsapFile(file: AsapFile): string {
  const out: string[] = []
  out.push(segment('TH', '4.2', file.controlNumber, '01', '', file.createdDate, file.createdTime, 'P', '~'))
  out.push(segment('IS', file.senderDea, file.senderName, `${file.pharmacyName} controlled-substance dispensing report`))
  out.push(segment('PHA', '', file.pharmacyDea, '', file.pharmacyName, file.pharmacyAddress, '', file.pharmacyCity, file.pharmacyState, file.pharmacyPostal))
  for (const d of file.dispenses) {
    out.push(segment('PAT', '', '', '', d.ownerLastName, d.ownerFirstName, '', '', '', d.ownerAddress, '', d.ownerCity, d.ownerState, d.ownerPostal, '', '', '', '', '', asapSpeciesCode(d.species), d.animalName))
    out.push(segment('DSP', '00', d.rxNumber, ymd(d.dateWritten), d.refillsAuthorised, ymd(d.dateFilled), d.refillNumber, '01', d.ndc, d.quantity, d.daysSupply, '', '', '', '', d.schedule))
    out.push(segment('PRE', '', d.prescriberDea, '', d.prescriberLastName, d.prescriberFirstName))
  }
  const count = out.length + 1
  out.push(segment('TT', file.controlNumber, count))
  return out.join('\n') + '\n'
}
