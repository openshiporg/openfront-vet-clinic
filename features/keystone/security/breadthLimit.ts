import { GraphQLError, Kind, getNamedType, isInterfaceType, isListType, isObjectType, isScalarType, isUnionType, getNullableType, type DocumentNode, type FieldNode, type FragmentDefinitionNode, type GraphQLField, type GraphQLInterfaceType, type GraphQLNamedType, type GraphQLObjectType, type GraphQLSchema, type GraphQLUnionType, type OperationDefinitionNode, type SelectionSetNode, type ValueNode } from 'graphql'

/*
 * Review r4 F1 (DoS): the take cap (500) and depth cap bound one list and one path, not a document.
 * 40 aliases of `patients(take: 500)` pulled ~20k rows in one request. This bounds the breadth of one
 * operation: how many root fields (aliases included) it runs, how many rows its lists may return in
 * total, and how many separate resolver calls (database queries) it makes.
 */
export const API_MAX_ROOT_FIELDS = 20
export const API_MAX_ROOT_ROWS = 5000
/** A root list with no `take` returns up to the list's maxTake (models/index.ts API_MAX_TAKE). */
export const API_DEFAULT_PAGE = 500
/**
 * Review r6 #1: a nested list with no `take` is estimated at this many rows per parent row. Charging it the
 * full 500 made every screen that nests a short list (a patient's active alerts, a stay's cages) cost
 * millions of rows and broke the dashboard. Fan-out is bounded separately by API_MAX_RESOLVER_CALLS,
 * which does not depend on this estimate.
 */
export const API_NESTED_DEFAULT = 50
export const API_MAX_SELECTION_FIELDS = 60
/**
 * Review r6 #2: Keystone runs one query per parent row for every nested list and every `<rel>Count`
 * field. 500 rows x 59 counts ran 29,500 queries and stalled the app for everyone. This caps those calls.
 */
export const API_MAX_RESOLVER_CALLS = 2000
/**
 * Review r6 #2/#3: one selection set may name the same list or count field at most this many times (aliases).
 * Real screens use two to four (`active: clientsCount`, `prospect: clientsCount`, …); 55 aliased `licenses` under
 * `authenticatedItem` or 59 aliased `weightsCount` under each patient are fan-out, whatever the estimate per row.
 */
export const API_MAX_ALIASES_PER_FIELD = 10
/** A custom root resolver returning JSON (availability search, audit chain check, policy matrix) is one heavy call. */
export const API_CUSTOM_RESOLVER_COST = 500
/** Review r6 #5: 50 aliased `__schema` returned 7.4 MB. One or two introspection fields is all a client needs. */
export const API_MAX_INTROSPECTION_FIELDS = 2
const API_MAX_VISITED = 20000

type Vars = Record<string, unknown> | null | undefined
type Composite = GraphQLObjectType | GraphQLInterfaceType | GraphQLUnionType

function takeOf(value: ValueNode | undefined, variables: Vars, fallback: number): number {
  if (!value) return fallback
  if (value.kind === Kind.INT) return Math.abs(parseInt(value.value, 10))
  if (value.kind === Kind.VARIABLE) {
    const v = variables?.[value.name.value]
    return typeof v === 'number' && Number.isFinite(v) ? Math.abs(Math.trunc(v)) : fallback
  }
  return fallback
}

/**
 * Review r6 #1: `encounters(where: { ref: { equals: "ENC-…" } })` returns at most one row whatever its take, because
 * `ref` is unique. A `where` that pins a unique field (`equals`, or `in` with a known list) bounds the rows.
 */
function uniqueBound(schema: GraphQLSchema, named: GraphQLNamedType, where: ValueNode | undefined, variables: Vars): number | null {
  const unique = schema.getType(`${named.name}WhereUniqueInput`)
  if (!unique || !('getFields' in unique)) return null
  const keys = new Set(Object.keys((unique as any).getFields()))
  const fromValue = (v: unknown): number | null => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null
    let best: number | null = null
    for (const [k, filter] of Object.entries(v as Record<string, unknown>)) {
      if (!keys.has(k) || !filter || typeof filter !== 'object') continue
      const f = filter as Record<string, unknown>
      const n = typeof f.equals === 'string' && Object.keys(f).length === 1 ? 1 : Array.isArray(f.in) && Object.keys(f).length === 1 ? f.in.length : null
      if (n !== null) best = best === null ? n : Math.min(best, n)
    }
    return best
  }
  const literal = (v: ValueNode): unknown => {
    switch (v.kind) {
      case Kind.OBJECT: return Object.fromEntries(v.fields.map(f => [f.name.value, literal(f.value)]))
      case Kind.LIST: return v.values.map(literal)
      case Kind.STRING: return v.value
      case Kind.VARIABLE: return variables?.[v.name.value]
      default: return null
    }
  }
  return where ? fromValue(literal(where)) : null
}

/** Fields of a selection set, flattening fragments; each keeps the type condition it was selected under (unions). */
function collect(set: SelectionSetNode, fragments: Map<string, FragmentDefinitionNode>, seen: Set<string>, on: string | null, out: { field: FieldNode; on: string | null }[]) {
  for (const s of set.selections) {
    if (s.kind === Kind.FIELD) out.push({ field: s, on })
    else if (s.kind === Kind.INLINE_FRAGMENT) collect(s.selectionSet, fragments, seen, s.typeCondition?.name.value ?? on, out)
    else if (!seen.has(s.name.value)) {
      const fragment = fragments.get(s.name.value)
      if (fragment) collect(fragment.selectionSet, fragments, new Set(seen).add(s.name.value), fragment.typeCondition.name.value, out)
    }
  }
}

const isComposite = (t: GraphQLNamedType | undefined | null): t is Composite => !!t && (isObjectType(t) || isInterfaceType(t) || isUnionType(t))

function fieldDef(schema: GraphQLSchema, parent: Composite, on: string | null, name: string): GraphQLField<unknown, unknown> | undefined {
  // A type condition names the concrete member (`... on User`) or the parent itself.
  const cond = on ? schema.getType(on) : null
  if (cond && (isObjectType(cond) || isInterfaceType(cond))) return cond.getFields()[name]
  if (isObjectType(parent) || isInterfaceType(parent)) return parent.getFields()[name]
  return undefined
}

export type Breadth = { fields: number; rows: number; widest: number; calls: number; introspection: number; aliases: number }

/**
 * The cost of a document (reviews r5 and r6):
 * - rows: every list counts its `take` (a root list with none counts 500, a nested one 50) times the rows of
 *   the lists above it; every `<rel>Count` counts one per parent row; a custom JSON root resolver counts 1000.
 * - calls: every nested list and every `<rel>Count` runs one query per parent row; root fields run one each.
 * - widest: no selection set may hold more than API_MAX_SELECTION_FIELDS fields.
 * Fragments, inline fragments and union members (`authenticatedItem { ... on User { … } }`) are all walked.
 */
export function measureBreadth(schema: GraphQLSchema, document: DocumentNode, operationName: string | null | undefined, variables: Vars): Breadth {
  const empty = { fields: 0, rows: 0, widest: 0, calls: 0, introspection: 0, aliases: 0 }
  const fragments = new Map(document.definitions.filter((d): d is FragmentDefinitionNode => d.kind === Kind.FRAGMENT_DEFINITION).map(d => [d.name.value, d]))
  const operations = document.definitions.filter((d): d is OperationDefinitionNode => d.kind === Kind.OPERATION_DEFINITION)
  const operation = operationName ? operations.find(o => o.name?.value === operationName) : operations[0]
  if (!operation) return empty
  const rootType = operation.operation === 'mutation' ? schema.getMutationType() : operation.operation === 'query' ? schema.getQueryType() : null
  if (!rootType) return empty
  const isQuery = operation.operation === 'query'
  let rows = 0
  let calls = 0
  let widest = 0
  let visited = 0
  let introspection = 0
  let aliases = 0
  const walk = (set: SelectionSetNode, parent: Composite, multiplier: number, root: boolean): number => {
    const all: { field: FieldNode; on: string | null }[] = []
    collect(set, fragments, new Set(), null, all)
    const fields = all.filter(f => !f.field.name.value.startsWith('__'))
    if (root) introspection += all.filter(f => f.field.name.value === '__schema' || f.field.name.value === '__type').length
    widest = Math.max(widest, fields.length)
    const repeats = new Map<string, number>()
    for (const { field: f, on } of fields) {
      if (++visited > API_MAX_VISITED) { rows = Infinity; return fields.length }
      const def = fieldDef(schema, parent, on, f.name.value)
      if (!def) continue
      const named = getNamedType(def.type)
      const list = isListType(getNullableType(def.type))
      const counter = !list && !root && /Count$/.test(f.name.value) && def.type.toString().startsWith('Int')
      const custom = root && isQuery && isScalarType(named) && named.name === 'JSON'
      let own = list ? takeOf(f.arguments?.find(a => a.name.value === 'take')?.value, variables, root ? API_DEFAULT_PAGE : API_NESTED_DEFAULT) : 1
      if (list) {
        const bound = uniqueBound(schema, named, f.arguments?.find(a => a.name.value === 'where')?.value, variables)
        if (bound !== null) own = Math.min(own, bound)
      }
      const cost = multiplier * own
      if (!root && (list || counter)) {
        const n = (repeats.get(f.name.value) ?? 0) + 1
        repeats.set(f.name.value, n)
        aliases = Math.max(aliases, n)
      }
      if (list || root) rows += custom ? API_CUSTOM_RESOLVER_COST : cost
      else if (counter) rows += multiplier
      // One database query per parent row for every list and count; to-one relations are batched by Keystone.
      if (root) calls += custom ? API_CUSTOM_RESOLVER_COST : 1
      else if (list || counter) calls += multiplier
      if (f.selectionSet && isComposite(named)) walk(f.selectionSet, named, list ? cost : multiplier, false)
      if (rows === Infinity) return fields.length
    }
    return fields.length
  }
  const fields = walk(operation.selectionSet, rootType, 1, true)
  return { fields, rows, widest, calls, introspection, aliases }
}

/** The reason a measured document is refused, or null when it is within every limit. */
export function breadthRefusal(b: Breadth, limits = { fields: API_MAX_ROOT_FIELDS, rows: API_MAX_ROOT_ROWS }): string | null {
  if (b.introspection > API_MAX_INTROSPECTION_FIELDS) return `The query asks for ${b.introspection} introspection fields; at most ${API_MAX_INTROSPECTION_FIELDS} are allowed.`
  if (b.widest > API_MAX_SELECTION_FIELDS && b.fields <= limits.fields) return `A selection asks for ${b.widest} fields at once; at most ${API_MAX_SELECTION_FIELDS} are allowed.`
  if (b.fields > limits.fields) return `The query runs ${b.fields} top-level fields; at most ${limits.fields} are allowed in one request.`
  if (b.rows > limits.rows) return `The query asks for about ${b.rows} rows across its lists; at most ${limits.rows} are allowed in one request.`
  if (b.calls > API_MAX_RESOLVER_CALLS) return `The query makes about ${b.calls} database lookups (nested lists and counts per row); at most ${API_MAX_RESOLVER_CALLS} are allowed in one request.`
  if (b.aliases > API_MAX_ALIASES_PER_FIELD) return `The query repeats one list or count ${b.aliases} times in a selection; at most ${API_MAX_ALIASES_PER_FIELD} are allowed.`
  return null
}

/** graphql-yoga / envelop plugin: refuse an operation that is too wide before it runs. */
export function breadthLimitPlugin(limits = { fields: API_MAX_ROOT_FIELDS, rows: API_MAX_ROOT_ROWS }) {
  return {
    onExecute({ args, setResultAndStopExecution }: { args: { schema: GraphQLSchema; document: DocumentNode; operationName?: string | null; variableValues?: Vars }; setResultAndStopExecution: (r: unknown) => void }) {
      const message = breadthRefusal(measureBreadth(args.schema, args.document, args.operationName, args.variableValues), limits)
      if (message) setResultAndStopExecution({ errors: [new GraphQLError(message, { extensions: { code: 'QUERY_TOO_BROAD' } })] })
    },
  }
}
