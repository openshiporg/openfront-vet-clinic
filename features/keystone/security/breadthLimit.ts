import { GraphQLError, Kind, getNamedType, isInterfaceType, isListType, isObjectType, getNullableType, type DocumentNode, type FieldNode, type FragmentDefinitionNode, type GraphQLInterfaceType, type GraphQLObjectType, type GraphQLSchema, type OperationDefinitionNode, type SelectionSetNode, type ValueNode } from 'graphql'

/*
 * Review r4 F1 (DoS): the take cap (500) and depth cap bound one list and one path, not a document.
 * 40 aliases of `patients(take: 500)` pulled ~20k rows in one request. This bounds the breadth of one
 * operation: how many root fields (aliases included) it runs and how many rows they may ask for in
 * total (each list field counts its `take`, or the page size when none is given). Introspection is free.
 */
export const API_MAX_ROOT_FIELDS = 20
export const API_MAX_ROOT_ROWS = 5000
export const API_DEFAULT_PAGE = 500
export const API_MAX_SELECTION_FIELDS = 60
const API_MAX_VISITED = 20000

type Vars = Record<string, unknown> | null | undefined

function takeOf(value: ValueNode | undefined, variables: Vars): number {
  if (!value) return API_DEFAULT_PAGE
  if (value.kind === Kind.INT) return Math.abs(parseInt(value.value, 10))
  if (value.kind === Kind.VARIABLE) {
    const v = variables?.[value.name.value]
    return typeof v === 'number' && Number.isFinite(v) ? Math.abs(Math.trunc(v)) : API_DEFAULT_PAGE
  }
  return API_DEFAULT_PAGE
}

function collect(set: SelectionSetNode, fragments: Map<string, FragmentDefinitionNode>, seen: Set<string>, out: FieldNode[]) {
  for (const s of set.selections) {
    if (s.kind === Kind.FIELD) out.push(s)
    else if (s.kind === Kind.INLINE_FRAGMENT) collect(s.selectionSet, fragments, seen, out)
    else if (!seen.has(s.name.value)) {
      const fragment = fragments.get(s.name.value)
      if (fragment) collect(fragment.selectionSet, fragments, new Set(seen).add(s.name.value), out)
    }
  }
}

export type Breadth = { fields: number; rows: number; widest: number }

/**
 * Review r5: the cost of a document is the rows of every list in the whole tree, each list counting its
 * `take` (or the default page) times the rows of the list it sits under. So `patients(take: 500) { w0..w99: weights { id } }`
 * costs 500 + 100 x 500 x 500, not 500. A selection set may also not repeat more than API_MAX_SELECTION_FIELDS fields.
 */
export function measureBreadth(schema: GraphQLSchema, document: DocumentNode, operationName: string | null | undefined, variables: Vars): Breadth {
  const fragments = new Map(document.definitions.filter((d): d is FragmentDefinitionNode => d.kind === Kind.FRAGMENT_DEFINITION).map(d => [d.name.value, d]))
  const operations = document.definitions.filter((d): d is OperationDefinitionNode => d.kind === Kind.OPERATION_DEFINITION)
  const operation = operationName ? operations.find(o => o.name?.value === operationName) : operations[0]
  if (!operation) return { fields: 0, rows: 0, widest: 0 }
  const rootType = operation.operation === 'mutation' ? schema.getMutationType() : operation.operation === 'query' ? schema.getQueryType() : null
  if (!rootType) return { fields: 0, rows: 0, widest: 0 }
  let rows = 0
  let widest = 0
  let visited = 0
  const walk = (set: SelectionSetNode, parent: GraphQLObjectType | GraphQLInterfaceType, multiplier: number, root: boolean): number => {
    const fields: FieldNode[] = []
    collect(set, fragments, new Set(), fields)
    for (let i = fields.length - 1; i >= 0; i--) if (fields[i].name.value.startsWith('__')) fields.splice(i, 1)
    widest = Math.max(widest, fields.length)
    let count = 0
    for (const f of fields) {
      count++
      if (++visited > API_MAX_VISITED) { rows = Infinity; return count }
      const def = parent.getFields()[f.name.value]
      if (!def) continue
      const list = isListType(getNullableType(def.type))
      const own = list ? takeOf(f.arguments?.find(a => a.name.value === 'take')?.value, variables) : 1
      const cost = multiplier * own
      if (list || root) rows += cost
      const named = getNamedType(def.type)
      if (f.selectionSet && (isObjectType(named) || isInterfaceType(named))) walk(f.selectionSet, named, list ? cost : multiplier, false)
      if (rows === Infinity) return count
    }
    return count
  }
  const fields = walk(operation.selectionSet, rootType, 1, true)
  return { fields, rows, widest }
}

/** graphql-yoga / envelop plugin: refuse an operation that is too wide before it runs. */
export function breadthLimitPlugin(limits = { fields: API_MAX_ROOT_FIELDS, rows: API_MAX_ROOT_ROWS }) {
  return {
    onExecute({ args, setResultAndStopExecution }: { args: { schema: GraphQLSchema; document: DocumentNode; operationName?: string | null; variableValues?: Vars }; setResultAndStopExecution: (r: unknown) => void }) {
      const { fields, rows, widest } = measureBreadth(args.schema, args.document, args.operationName, args.variableValues)
      if (fields > limits.fields || rows > limits.rows || widest > API_MAX_SELECTION_FIELDS) {
        const message = widest > API_MAX_SELECTION_FIELDS && fields <= limits.fields
          ? `A selection asks for ${widest} fields at once; at most ${API_MAX_SELECTION_FIELDS} are allowed.`
          : fields > limits.fields
          ? `The query runs ${fields} top-level fields; at most ${limits.fields} are allowed in one request.`
          : `The query asks for about ${rows} rows across its lists; at most ${limits.rows} are allowed in one request.`
        setResultAndStopExecution({ errors: [new GraphQLError(message, { extensions: { code: 'QUERY_TOO_BROAD' } })] })
      }
    },
  }
}
