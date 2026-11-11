import { describe, expect, it } from 'vitest'
import { buildAsapFile, type AsapFile } from '../lib/asap'
import { locationCalendar } from '../lib/calendar'
import { discrepancyDeadlines, orderFormExpiry } from './discrepancy'

const FILE: AsapFile = {
  controlNumber: 'PDS-000001', createdDate: '20261110', createdTime: '091500', senderDea: 'BC1234563', senderName: 'Cedar Creek Animal Hospital',
  pharmacyDea: 'BC1234563', pharmacyName: 'Cedar Creek Animal Hospital', pharmacyAddress: '410 Alder Way', pharmacyCity: 'Sacramento', pharmacyState: 'CA', pharmacyPostal: '95819',
  dispenses: [{
    rxNumber: 'RX-000412', dateWritten: '2026-11-09T17:02:00Z', refillsAuthorised: 0, dateFilled: '2026-11-10T16:40:00Z', refillNumber: 0, ndc: '0409-1234-01', quantity: '10', daysSupply: 5, schedule: 'CII',
    ownerLastName: 'Ward', ownerFirstName: 'Dana', ownerAddress: '12 Elm St', ownerCity: 'Sacramento', ownerState: 'CA', ownerPostal: '95818', species: 'canine', animalName: 'Biscuit',
    prescriberDea: 'AM1234563', prescriberLastName: 'Marsh', prescriberFirstName: 'Elena',
  }],
}

describe('ASAP 4.2B writer', () => {
  it('matches the golden file byte for byte', () => {
    expect(buildAsapFile(FILE)).toBe(
      'TH*4.2*PDS-000001*01**20261110*091500*P*~\n' +
      'IS*BC1234563*Cedar Creek Animal Hospital*Cedar Creek Animal Hospital controlled-substance dispensing report~\n' +
      'PHA**BC1234563**Cedar Creek Animal Hospital*410 Alder Way**Sacramento*CA*95819~\n' +
      'PAT****Ward*Dana****12 Elm St**Sacramento*CA*95818******02*Biscuit~\n' +
      'DSP*00*RX-000412*20261109*0*20261110*0*01*0409-1234-01*10*5*****CII~\n' +
      'PRE**AM1234563**Marsh*Elena~\n' +
      'TT*PDS-000001*7~\n',
    )
  })
  it('is a pure function and strips delimiters from values', () => {
    const dirty = { ...FILE, dispenses: [{ ...FILE.dispenses[0], animalName: 'Bis*cu~it\n' }] }
    expect(buildAsapFile(dirty)).toBe(buildAsapFile(dirty))
    expect(buildAsapFile(dirty)).not.toMatch(/Bis\*cu/)
  })
})

describe('discrepancy and order-form clocks', () => {
  const cal = locationCalendar({ code: 'CC-MAIN', timeZone: 'America/Los_Angeles' })
  const rules = { theftLossNoticeBusinessDays: 1, form106Days: 45 }
  it('counts the notice day in business days: a Friday discovery is due Monday', () => {
    expect(discrepancyDeadlines(cal, '2026-11-06', rules).noticeDueOn).toBe('2026-11-09')
  })
  it('skips a holiday: Tuesday 10 Nov discovery is due Thursday 12 Nov (Veterans Day is the 11th)', () => {
    expect(discrepancyDeadlines(cal, '2026-11-10', rules).noticeDueOn).toBe('2026-11-12')
  })
  it('puts Form 106 forty-five days out', () => {
    expect(discrepancyDeadlines(cal, '2026-11-10', rules).form106DueOn).toBe('2026-12-25')
  })
  it('an order form is valid sixty days from issue', () => {
    expect(orderFormExpiry('2026-11-10')).toBe('2027-01-09')
  })
})
