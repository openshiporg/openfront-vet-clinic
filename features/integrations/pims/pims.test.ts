import { describe, expect, it } from 'vitest'
import { importDate, importSex, mapHeaders, parseCsv, parseExport } from './index'

describe('PIMS CSV import', () => {
  it('parses RFC 4180 quoting, CRLF and embedded newlines', () => {
    expect(parseCsv('a,b\r\n"x, y","he said ""hi""\nthen left"\r\n\r\n')).toEqual([['a', 'b'], ['x, y', 'he said "hi"\nthen left']])
    expect(() => parseCsv('a\n"open')).toThrow(/quoted/)
  })
  it('maps Avimark and ezyVet headers by alias', () => {
    expect(mapHeaders('avimark', 'clients', ['Client Number', 'First Name', 'Last Name', 'Cell Phone', 'E-Mail']).mapping).toMatchObject({ externalId: 'Client Number', mobile: 'Cell Phone', email: 'E-Mail' })
    expect(mapHeaders('ezyvet', 'patients', ['Animal ID', 'Contact ID', 'Name', 'Species']).missingRequired).toEqual([])
    expect(mapHeaders('csv', 'patients', ['Name']).missingRequired).toEqual(['externalId', 'clientExternalId', 'species'])
  })
  it('lets an explicit mapping win', () => {
    const p = parseExport('csv', 'weights', 'Pet,When,Kg\n9,3/4/2025,12.5\n', { Pet: 'patientExternalId', When: 'date', Kg: 'weight' })
    expect(p.rows[0]).toEqual({ rowNumber: 2, values: { patientExternalId: '9', date: '3/4/2025', weight: '12.5' } })
  })
  it('reads US and ISO dates and rejects impossible ones', () => {
    expect(importDate('3/19/2014')).toBe('2014-03-19')
    expect(importDate('2014-03-19T00:00:00')).toBe('2014-03-19')
    expect(importDate('2/30/2024')).toBeNull()
    expect(importDate('03/19/14')).toBe('2014-03-19')
  })
  it('normalises sex codes', () => {
    expect(importSex('FS')).toEqual({ sex: 'female', reproductiveStatus: 'spayed' })
    expect(importSex('Male Neutered')).toEqual({ sex: 'male', reproductiveStatus: 'neutered' })
    expect(importSex('?')).toEqual({ sex: 'unknown', reproductiveStatus: 'unknown' })
  })
})
