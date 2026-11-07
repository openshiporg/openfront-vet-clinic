import { describe, expect, it } from 'vitest'
import { bpsPercent, fractionPercent, money, quantity, weight } from './format'

describe('display formatting is exact', () => {
  it('formats basis points as percent without floats', () => {
    expect([bpsPercent(-592), bpsPercent(786), bpsPercent(5), bpsPercent(0), bpsPercent(null), bpsPercent(-10000)]).toEqual(['−5.92%', '7.86%', '0.05%', '0.00%', '—', '−100.00%'])
  })
  it('formats weights as percent', () => {
    expect([fractionPercent('0.333333'), fractionPercent('1'), fractionPercent('0.05', 2), fractionPercent('0'), fractionPercent('x')]).toEqual(['33.3%', '100.0%', '5.00%', '0.0%', '—'])
  })
  it('formats money, quantities and weights from strings', () => {
    expect([money('9407596'), money('-5'), quantity('0.123456789'), weight('4.2003'), weight('12.4000')]).toEqual(['$94,075.96', '−$0.05', '0.123456', '4.2003 kg', '12.4 kg'])
  })
})
