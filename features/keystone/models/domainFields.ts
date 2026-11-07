import { bigInt, decimal, integer, select, text } from '@keystone-6/core/fields'

/** Ledger cash in minor units (SCHEMA G2). */
export const minor = (options: { required?: boolean; defaultValue?: bigint; description?: string } = {}) =>
  bigInt({
    ...(options.defaultValue !== undefined ? { defaultValue: options.defaultValue } : {}),
    validation: { isRequired: options.required ?? options.defaultValue !== undefined },
    ...(options.description ? { ui: { description: options.description } } : {}),
  })

/** ISO-4217 currency code, default USD. */
export const ccy = () =>
  text({ defaultValue: 'USD', validation: { isRequired: true, match: { regex: /^[A-Z]{3}$/, explanation: 'ISO 4217 currency code required' } } })

const exact = (precision: number, scale: number) => (options: { required?: boolean; description?: string } = {}) =>
  decimal({
    precision,
    scale,
    validation: { isRequired: options.required ?? false },
    ...(options.description ? { ui: { description: options.description } } : {}),
  })

/** Clinical and stock quantities, doses, strengths and concentrations: numeric(18,6) (SCHEMA G3: mcg and 0.01 mL need 6 dp). */
export const qty = exact(18, 6)
/** Rates (%, tax, production, deposit fraction): numeric(12,6). */
export const rate = exact(12, 6)
/** Body weights: numeric(10,4), always with a weightUnit. */
export const wt = exact(10, 4)
/** Latitude/longitude: numeric(9,6) (G12: no floats anywhere). */
export const geo = exact(9, 6)

/** The unit set (SCHEMA §0.1 `unit`). */
export const UNITS = ['mg', 'mcg', 'g', 'kg', 'mL', 'L', 'tablet', 'capsule', 'unit', 'IU', 'each', 'dose', 'application', 'drop', 'cm', 'in', 'lb', 'oz'] as const
export const unit = (initial: string | null = null) => choice(UNITS, initial)
export const WEIGHT_UNITS = ['kg', 'lb', 'g'] as const

/** Integer basis points (SCHEMA G4). */
export const bps = (defaultValue?: number) =>
  integer({ ...(defaultValue !== undefined ? { defaultValue } : {}), validation: { isRequired: defaultValue !== undefined } })

const option = (value: string) => ({ label: value.replaceAll('_', ' ').replaceAll('.', ' · '), value })

/**
 * A lifecycle status. It changes only through transition mutations (SCHEMA G7): never through the
 * generated create/update operations.
 */
export const lifecycle = (values: readonly string[], initial = values[0]) =>
  select({
    type: 'string',
    options: values.map(option),
    defaultValue: initial,
    validation: { isRequired: true },
    access: { create: () => false, update: () => false },
    ui: { createView: { fieldMode: 'hidden' }, itemView: { fieldMode: 'read' } },
  })

/** A plain choice that staff may edit. */
export const choice = (values: readonly string[], initial: string | null = values[0]) =>
  select({
    type: 'string',
    options: values.map(option),
    ...(initial !== null ? { defaultValue: initial } : {}),
    validation: { isRequired: initial !== null },
  })

/** Compare-and-set version (SCHEMA G6). Incremented only by server code. */
export const versionField = () =>
  integer({
    defaultValue: 0,
    validation: { isRequired: true },
    access: { create: () => false, update: () => false },
    ui: { createView: { fieldMode: 'hidden' }, itemView: { fieldMode: 'read' } },
  })

/** Server-written text that is visible but never edited through the API. */
export const systemText = (options: { indexed?: boolean | 'unique'; required?: boolean; nullable?: boolean } = {}) =>
  text({
    ...(options.indexed ? { isIndexed: options.indexed } : {}),
    ...(options.nullable ? { db: { isNullable: true } } : {}),
    validation: { isRequired: options.required ?? false },
    access: { create: () => false, update: () => false },
    ui: { createView: { fieldMode: 'hidden' }, itemView: { fieldMode: 'read' } },
  })

export const readOnly = { access: { create: () => false, update: () => false }, ui: { createView: { fieldMode: 'hidden' as const }, itemView: { fieldMode: 'read' as const } } }

/** A choice fixed at creation by server code (e.g. a grant scope): visible, never edited. */
export const fixedChoice = (values: readonly string[]) =>
  select({
    type: 'string',
    options: values.map(option),
    validation: { isRequired: true },
    access: { create: () => false, update: () => false },
    ui: { createView: { fieldMode: 'hidden' }, itemView: { fieldMode: 'read' } },
  })
