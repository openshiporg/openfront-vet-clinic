import { canonicalJson, sha256 } from '../lib/canonical'
import { dec, Decimal, toBpsInt, toScale, ZERO, type DecimalInput } from '../lib/decimal'

/*
 * Dose calculation (DOMAIN I-O2, SCHEMA §5.2). Pure and exact: every number is a decimal string in
 * and out, so the same inputs give byte-identical outputs on any machine, and the stored row can be
 * recomputed and compared at any time (verifyDose).
 *
 *   total   = dose rate × weight (per kg) | × body surface area (per m²) | × 1 (per animal)
 *   volume  = total ÷ concentration (liquids, injectables)      quantity = total ÷ strength (solids)
 *   rounded = to the nearest measurable increment (syringe graduations, tablet fractions)
 *
 * Safety checks (ported from the pharmacy vertical's clinical-safety rules and made veterinary):
 * the practice formulary range for the species, breed genetic cautions (MDR1), patient drug
 * sensitivities, weight age, and rounding deviation. A `block` needs a recorded override reason.
 *
 * Range (2026.11-3): a dose outside the formulary range is refused outright, on either side and on
 * every basis (per kg, per lb, per m² through the body surface area of the dosing weight, per
 * animal); no override reason lets it through. A dose a species needs outside the range is a
 * formulary change (PracticeSettings / DrugProduct.doseRanges), made and audited there. A manual
 * quantity override is a measuring adjustment, never a different dose: the amount it delivers is
 * checked against the range too and refused outside it.
 */

export const DOSE_CALC_VERSION = 'dose-2026.11-3'

/** Blocks no override reason can pass: every out-of-range dose, and a manual quantity that cannot be checked. */
export const HARD_BLOCKS: readonly string[] = ['above_range', 'below_range', 'override_out_of_range', 'range_unconvertible_override']

export type DoseUnit = 'mg' | 'mcg' | 'g' | 'mL' | 'IU' | 'unit' | 'tablet' | 'capsule' | 'dose'
export type DosePer = 'kg' | 'm2' | 'animal'
export const DOSE_PERS: readonly DosePer[] = ['kg', 'm2', 'animal']
export const DOSE_UNITS: readonly DoseUnit[] = ['mg', 'mcg', 'g', 'mL', 'IU', 'unit', 'tablet', 'capsule', 'dose']
const KG_PER_LB = '0.45359237'

export type DoseProduct = {
  id?: string | null
  genericName: string
  form: string
  strength?: DecimalInput | null
  strengthUnit?: string | null
  per?: string | null
  concentration?: DecimalInput | null
  concentrationUnit?: string | null
  measurableIncrement?: DecimalInput | null
  doseRanges?: Record<string, { min?: string; max?: string; unit: string; per: DosePer | 'lb' }> | null
  cautionFlags?: string[] | null
}

export type DoseInput = {
  weightKg: DecimalInput
  weightAgeHours?: number | null
  maxWeightAgeHours?: number | null
  doseAmount: DecimalInput
  doseUnit: DoseUnit
  dosePer: DosePer
  species: string
  product?: DoseProduct | null
  geneticFlags?: string[]
  sensitivities?: string[]
  manualOverrideQty?: DecimalInput | null
  overrideReason?: string | null
}

export type DoseWarning = { code: string; severity: 'warn' | 'block'; message: string }

export type DoseResult = {
  weightKg: string
  doseAmount: string
  doseUnit: DoseUnit
  dosePer: DosePer
  bsaM2: string | null
  bsaConstant: string | null
  totalAmount: string
  totalUnit: string
  concentration: string | null
  concentrationUnit: string | null
  computedQty: string | null
  computedUnit: string | null
  roundingRule: { increment: string; mode: 'half_even' } | null
  roundedQty: string | null
  deliveredAmount: string | null
  deviationBps: number | null
  manualOverrideQty: string | null
  overrideReason: string
  warnings: DoseWarning[]
  calcVersion: string
  hash: string
}

/** Meeh constants for body surface area (m² = K × grams^(2/3) ÷ 10⁴), by species code: dog 10.1, cat 10.0. */
export const BSA_CONSTANTS: Record<string, string> = { canine: '10.1', feline: '10.0' }

const MASS_TO_MG: Record<string, string> = { mcg: '0.001', mg: '1', g: '1000' }

/** Body surface area in m² (4 places), from kilograms. */
export function bodySurfaceArea(weightKg: DecimalInput, species: string): { m2: Decimal; constant: Decimal } {
  const k = BSA_CONSTANTS[species]
  if (!k) throw new RangeError(`No body-surface-area constant for ${species}; dose this drug per kg or per animal.`)
  const grams = dec(weightKg).times(1000)
  const m2 = dec(k).times(grams.pow(dec(2).div(3))).div(10_000)
  return { m2: m2.toDecimalPlaces(4, Decimal.ROUND_HALF_EVEN), constant: dec(k) }
}

/** Convert an amount between mass units exactly; other units must already match. */
export function convertAmount(amount: Decimal, from: string, to: string): Decimal {
  if (from === to) return amount
  if (MASS_TO_MG[from] && MASS_TO_MG[to]) return amount.times(MASS_TO_MG[from]).div(MASS_TO_MG[to])
  throw new RangeError(`Cannot convert ${from} to ${to}.`)
}

/** Syringe graduations by volume (practice default; a product increment overrides). */
export function defaultIncrement(form: string, volumeOrQty: Decimal): string {
  if (form === 'tablet' || form === 'chewable') return '0.25'
  if (form === 'capsule') return '1'
  if (volumeOrQty.lt('1')) return '0.01'
  if (volumeOrQty.lt('10')) return '0.1'
  return '0.2'
}

export function roundTo(value: Decimal, increment: DecimalInput): Decimal {
  const step = dec(increment)
  if (step.lte(0)) throw new RangeError('Rounding increment must be positive')
  return value.div(step).toDecimalPlaces(0, Decimal.ROUND_HALF_EVEN).times(step)
}

function numeratorUnit(concentrationUnit: string | null | undefined) {
  const [num] = String(concentrationUnit ?? '').split('/')
  return num || null
}

export function calculateDose(input: DoseInput): DoseResult {
  const warnings: DoseWarning[] = []
  const weightKg = dec(input.weightKg)
  if (weightKg.lte(0)) throw new RangeError('A dose needs a positive weight.')
  const doseAmount = dec(input.doseAmount)
  if (doseAmount.lte(0)) throw new RangeError('A dose rate must be positive.')
  // Every basis is explicit: an unknown one (e.g. per lb) is never treated as per animal.
  if (!(DOSE_PERS as readonly string[]).includes(input.dosePer)) throw new RangeError(`"${input.dosePer}" is not a dose basis: dose per kg, per m² or per animal (1 mg/lb = 2.2046 mg/kg).`)
  if (!(DOSE_UNITS as readonly string[]).includes(input.doseUnit)) throw new RangeError(`"${input.doseUnit}" is not a dose unit.`)
  if (input.maxWeightAgeHours != null && input.weightAgeHours != null && input.weightAgeHours > input.maxWeightAgeHours) {
    warnings.push({ code: 'weight_stale', severity: 'block', message: `The weight is ${input.weightAgeHours} hours old; this context allows ${input.maxWeightAgeHours}. Weigh the patient or record why the old weight is used.` })
  }

  let multiplier = new Decimal(1)
  let bsa: { m2: Decimal; constant: Decimal } | null = null
  if (input.dosePer === 'kg') multiplier = weightKg
  else if (input.dosePer === 'm2') { bsa = bodySurfaceArea(weightKg, input.species); multiplier = bsa.m2 }
  const total = doseAmount.times(multiplier)

  const product = input.product ?? null
  let computed: Decimal | null = null
  let computedUnit: string | null = null
  let roundingIncrement: string | null = null
  let rounded: Decimal | null = null
  let delivered: Decimal | null = null
  let deviationBps: number | null = null
  let concentration: Decimal | null = null

  if (product) {
    const isMass = Boolean(MASS_TO_MG[input.doseUnit])
    const concUnit = numeratorUnit(product.concentrationUnit)
    if (product.concentration != null && concUnit && (isMass ? MASS_TO_MG[concUnit] : concUnit === input.doseUnit)) {
      concentration = dec(product.concentration)
      if (concentration.lte(0)) throw new RangeError('Product concentration must be positive.')
      const totalInConc = isMass ? convertAmount(total, input.doseUnit, concUnit) : total
      computed = totalInConc.div(concentration)
      computedUnit = 'mL'
    } else if (product.strength != null && product.strengthUnit && (isMass ? MASS_TO_MG[product.strengthUnit] : product.strengthUnit === input.doseUnit)) {
      const strength = dec(product.strength)
      if (strength.lte(0)) throw new RangeError('Product strength must be positive.')
      const totalInStrength = isMass ? convertAmount(total, input.doseUnit, product.strengthUnit) : total
      computed = totalInStrength.div(strength)
      computedUnit = product.per || product.form
      concentration = strength
    } else if (['tablet', 'capsule', 'mL', 'dose'].includes(input.doseUnit)) {
      computed = total
      computedUnit = input.doseUnit
    }
    if (computed) {
      roundingIncrement = product.measurableIncrement != null ? dec(product.measurableIncrement).toString() : defaultIncrement(product.form, computed)
      rounded = roundTo(computed, roundingIncrement)
      if (rounded.isZero()) {
        warnings.push({ code: 'below_measurable', severity: 'block', message: `The dose (${toScale(computed, 4)} ${computedUnit}) is below the smallest measurable amount (${roundingIncrement}); dilute or choose another product.` })
      }
      // Delivered amount in the product's numerator unit (mg of drug in the rounded volume).
      delivered = concentration && computedUnit !== input.doseUnit ? rounded.times(concentration) : rounded
      // Volume and mass are proportional, so the deviation is the same ratio in either unit.
      deviationBps = toBpsInt(rounded.minus(computed).div(computed))
      if (Math.abs(deviationBps) > 1000) warnings.push({ code: 'rounding_deviation', severity: 'warn', message: `Rounding changes the delivered dose by ${(deviationBps / 100).toString()}%.` })
    }

    const range = product.doseRanges?.[input.species]
    if (range) {
      // Compare in the formulary's own unit and basis: the total in its unit, divided by its basis.
      const conc = product.concentration != null ? dec(product.concentration) : null
      const rate = rateInRangeBasis(total, input.doseUnit, range, weightKg, input.species, conc && conc.gt(0) ? conc : null, numeratorUnit(product.concentrationUnit))
      const shown = `${doseAmount.toString()} ${input.doseUnit}/${input.dosePer}`
      if (!rate) {
        warnings.push({ code: 'range_unconvertible', severity: 'block', message: `${shown} cannot be compared with the formulary range (${range.unit}/${range.per}); enter the dose in ${range.unit}/${range.per}.` })
      } else {
        const asRange = `${toScale(rate, 4).replace(/\.?0+$/, '')} ${range.unit}/${range.per}`
        const same = range.unit === input.doseUnit && range.per === input.dosePer
        if (range.max && rate.gt(range.max)) warnings.push({ code: 'above_range', severity: 'block', message: `${shown}${same ? '' : ` (${asRange})`} is above the formulary maximum for a ${input.species} (${range.max} ${range.unit}/${range.per}).` })
        if (range.min && rate.lt(range.min)) warnings.push({ code: 'below_range', severity: 'block', message: `${shown}${same ? '' : ` (${asRange})`} is below the formulary minimum for a ${input.species} (${range.min} ${range.unit}/${range.per}).` })
      }
      // A manual quantity (mL, tablets) delivers its own amount: it must sit inside the range as well.
      const manual = input.manualOverrideQty != null && input.manualOverrideQty !== '' ? dec(input.manualOverrideQty) : null
      if (manual && manual.gt(0)) {
        // The quantity is in the computed unit (mL of a liquid, tablets of a solid): back to drug amount.
        const manualTotal = !concentration || !computedUnit || computedUnit === input.doseUnit ? { amount: manual, unit: input.doseUnit }
          : { amount: manual.times(concentration), unit: (product.concentration != null ? numeratorUnit(product.concentrationUnit) : product.strengthUnit) ?? input.doseUnit }
        const manualRate = rateInRangeBasis(manualTotal.amount, manualTotal.unit, range, weightKg, input.species, null, null)
        const qtyShown = `${manual.toString()} ${computedUnit ?? input.doseUnit}`
        if (!manualRate) {
          warnings.push({ code: 'range_unconvertible_override', severity: 'block', message: `The manual quantity ${qtyShown} cannot be checked against the formulary range; order the dose rate instead.` })
        } else if ((range.max && manualRate.gt(range.max)) || (range.min && manualRate.lt(range.min))) {
          const asRange = `${toScale(manualRate, 4).replace(/\.?0+$/, '')} ${range.unit}/${range.per}`
          warnings.push({ code: 'override_out_of_range', severity: 'block', message: `The manual quantity ${qtyShown} delivers ${asRange}, outside the formulary range for a ${input.species} (${range.min ?? '0'}–${range.max ?? '∞'} ${range.unit}/${range.per}). A manual quantity only adjusts measuring; order the dose rate itself.` })
        }
      }
    } else if (product.doseRanges && !range) {
      warnings.push({ code: 'no_species_range', severity: 'warn', message: `The formulary has no ${input.species} dose range for ${product.genericName}; check the dose against a current reference.` })
    }
    const flags = (product.cautionFlags ?? []).filter(f => (input.geneticFlags ?? []).includes(f))
    for (const f of flags) warnings.push({ code: 'genetic_caution', severity: 'block', message: `${product.genericName} is a caution for this breed (${f.replace(/_/g, ' ')}).` })
    const generic = product.genericName.toLowerCase()
    if ((input.sensitivities ?? []).some(s => s.toLowerCase().includes(generic))) {
      warnings.push({ code: 'patient_sensitivity', severity: 'block', message: `The patient has a recorded sensitivity to ${product.genericName}.` })
    }
  }

  const override = input.manualOverrideQty != null && input.manualOverrideQty !== '' ? dec(input.manualOverrideQty) : null
  const overrideReason = (input.overrideReason ?? '').trim()
  if (override && overrideReason.length < 8) throw new RangeError('A manual dose override needs a reason.')

  const body = {
    weightKg: toScale(weightKg, 'wt'),
    doseAmount: toScale(doseAmount, 'qty'),
    doseUnit: input.doseUnit,
    dosePer: input.dosePer,
    bsaM2: bsa ? toScale(bsa.m2, 'qty') : null,
    bsaConstant: bsa ? toScale(bsa.constant, 'qty') : null,
    totalAmount: toScale(total, 'qty'),
    totalUnit: input.doseUnit,
    concentration: concentration ? toScale(concentration, 'qty') : null,
    concentrationUnit: concentration ? (product?.concentration != null ? product?.concentrationUnit ?? null : `${product?.strengthUnit}/${product?.per || product?.form}`) : null,
    computedQty: computed ? toScale(computed, 'qty') : null,
    computedUnit,
    roundingRule: roundingIncrement ? { increment: roundingIncrement, mode: 'half_even' as const } : null,
    roundedQty: rounded ? toScale(rounded, 'qty') : null,
    deliveredAmount: delivered ? toScale(delivered, 'qty') : null,
    deviationBps,
    manualOverrideQty: override ? toScale(override, 'qty') : null,
    overrideReason,
    warnings,
    calcVersion: DOSE_CALC_VERSION,
  }
  return { ...body, hash: sha256(canonicalJson({ input: { ...input, product: product ? { ...product, id: product.id ?? null } : null }, output: body })) }
}

/**
 * The dose rate expressed in a formulary range's unit and basis, or null when it cannot be: mass
 * units convert exactly (mcg/mg/g), a volume converts through the product concentration, and the
 * total is divided by the range's basis (kg, lb, m² or one animal) for this patient.
 */
function rateInRangeBasis(total: Decimal, unit: string, range: { unit: string; per: string }, weightKg: Decimal, species: string, concentration: Decimal | null, concentrationUnit: string | null): Decimal | null {
  let amount: Decimal | null = null
  if (unit === range.unit) amount = total
  else if (MASS_TO_MG[unit] && MASS_TO_MG[range.unit]) amount = convertAmount(total, unit, range.unit)
  else if (unit === 'mL' && concentration && concentrationUnit && MASS_TO_MG[concentrationUnit] && MASS_TO_MG[range.unit]) amount = convertAmount(total.times(concentration), concentrationUnit, range.unit)
  if (!amount) return null
  if (range.per === 'animal') return amount
  if (range.per === 'kg') return amount.div(weightKg)
  if (range.per === 'lb') return amount.div(weightKg.div(KG_PER_LB))
  if (range.per === 'm2') {
    if (!BSA_CONSTANTS[species]) return null
    return amount.div(bodySurfaceArea(weightKg, species).m2)
  }
  return null
}

/** Recompute a stored dose from its inputs and compare byte for byte (SCHEMA §5.2 CHECK). */
export function verifyDose(stored: Pick<DoseResult, 'totalAmount' | 'roundedQty' | 'computedQty' | 'hash'>, input: DoseInput) {
  const again = calculateDose(input)
  return again.totalAmount === stored.totalAmount && again.roundedQty === stored.roundedQty && again.computedQty === stored.computedQty && again.hash === stored.hash
}

/** The quantity that is actually drawn up: an override when one was recorded, else the rounded volume. */
export const quantityToGive = (dose: Pick<DoseResult, 'manualOverrideQty' | 'roundedQty' | 'computedQty'>) =>
  dose.manualOverrideQty ?? dose.roundedQty ?? dose.computedQty ?? null

/**
 * N1: the amount given must match the ordered quantity within a tolerance of 10% (never less than
 * 0.01 of the unit, one syringe graduation). Outside it, only a veterinarian with a reason may record
 * it. The database trigger Administration_qty_guard holds the same rule (vc_administration_qty_guard).
 */
export const ADMIN_QTY_TOLERANCE = { fraction: '0.10', floor: '0.01' } as const

export function administrationQtyProblem(planned: DecimalInput | null, given: DecimalInput, unit: string): string | null {
  if (planned == null) return null
  const p = dec(planned)
  const g = dec(given)
  if (p.lte(0)) return null
  const tolerance = Decimal.max(p.times(ADMIN_QTY_TOLERANCE.fraction), dec(ADMIN_QTY_TOLERANCE.floor))
  if (g.minus(p).abs().lte(tolerance)) return null
  const show = (d: Decimal) => d.toDecimalPlaces(4).toString()
  return `${show(g)} ${unit} is ${g.gt(p) ? 'more' : 'less'} than the ordered ${show(p)} ${unit} (allowed ${show(p.minus(tolerance).clamp(0, p))}–${show(p.plus(tolerance))} ${unit}).`
}

export const blockingWarnings = (warnings: DoseWarning[]) => warnings.filter(w => w.severity === 'block')

export const isPositive = (value: DecimalInput) => dec(value).gt(ZERO)
