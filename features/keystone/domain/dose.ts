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
 */

export const DOSE_CALC_VERSION = 'dose-2026.11-1'

export type DoseUnit = 'mg' | 'mcg' | 'g' | 'mL' | 'IU' | 'unit' | 'tablet' | 'capsule' | 'dose'
export type DosePer = 'kg' | 'm2' | 'animal'

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
  doseRanges?: Record<string, { min?: string; max?: string; unit: string; per: DosePer }> | null
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
    if (range && range.unit === input.doseUnit && range.per === input.dosePer) {
      if (range.max && doseAmount.gt(range.max)) warnings.push({ code: 'above_range', severity: 'block', message: `${doseAmount.toString()} ${input.doseUnit}/${input.dosePer} is above the formulary maximum for a ${input.species} (${range.max}).` })
      if (range.min && doseAmount.lt(range.min)) warnings.push({ code: 'below_range', severity: 'warn', message: `${doseAmount.toString()} ${input.doseUnit}/${input.dosePer} is below the formulary minimum for a ${input.species} (${range.min}).` })
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

/** Recompute a stored dose from its inputs and compare byte for byte (SCHEMA §5.2 CHECK). */
export function verifyDose(stored: Pick<DoseResult, 'totalAmount' | 'roundedQty' | 'computedQty' | 'hash'>, input: DoseInput) {
  const again = calculateDose(input)
  return again.totalAmount === stored.totalAmount && again.roundedQty === stored.roundedQty && again.computedQty === stored.computedQty && again.hash === stored.hash
}

/** The quantity that is actually drawn up: an override when one was recorded, else the rounded volume. */
export const quantityToGive = (dose: Pick<DoseResult, 'manualOverrideQty' | 'roundedQty' | 'computedQty'>) =>
  dose.manualOverrideQty ?? dose.roundedQty ?? dose.computedQty ?? null

export const blockingWarnings = (warnings: DoseWarning[]) => warnings.filter(w => w.severity === 'block')

export const isPositive = (value: DecimalInput) => dec(value).gt(ZERO)
