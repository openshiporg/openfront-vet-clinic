import { GraphQLError, Kind, getNamedType, isListType, getNullableType, type DocumentNode, type FragmentDefinitionNode, type GraphQLSchema, type SelectionSetNode, type ValueNode } from 'graphql'

/*
 * Review r4 F1 (DoS): the take cap (500) and depth cap bound one list and one path, not a document.
 * 40 aliases of `patients(take: 500)` pulled ~20k rows in one request. This bounds the breadth of one
 * operation: how many root fields (aliases included) it runs and how many rows they may ask for in
 * total (each list field counts its `take`, or the page size when none is given). Introspection is free.
 */
export const API_MAX_ROOT_FIELDS = 20
export const API_MAX_ROOT_ROWS = 5000
export const API_DEFAULT_PAGE = 500

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

function rootFields(set: SelectionSetNode, fragments: Map<string, FragmentDefinitionNode>, seen: Set<string>, out: import('graphql').FieldNode[]) {
  for (const s of set.selections) {
    if (s.kind === Kind.FIELD) out.push(s)
    else if (s.kind === Kind.INLINE_FRAGMENT) rootFields(s.selectionSet, fragments, seen, out)
    else if (!seen.has(s.name.value)) {
      const fragment = fragments.get(s.name.value)
      if (fragment) rootFields(fragment.selectionSet, fragments, new Set(seen).add(s.name.value), out)
    }
  }
}

export type Breadth = { fields: number; rows: number }

export function measureBreadth(schema: GraphQLSchema, document: DocumentNode, operationName: string | null | undefined, variables: Vars): Breadth {
  const fragments = new Map(document.definitions.filter((d): d is FragmentDefinitionNode => d.kind === Kind.FRAGMENT_DEFINITION).map(d => [d.name.value, d]))
  const operations = document.definitions.filter((d): d is import('graphql').OperationDefinitionNode => d.kind === Kind.OPERATION_DEFINITION)
  const operation = operationName ? operations.find(o => o.name?.value === operationName) : operations[0]
  if (!operation) return { fields: 0, rows: 0 }
  const rootType = operation.operation === 'mutation' ? schema.getMutationType() : operation.operation === 'query' ? schema.getQueryType() : null
  const defs = rootType?.getFields() ?? {}
  const fields: import('graphql').FieldNode[] = []
  rootFields(operation.selectionSet, fragments, new Set(), fields)
  let count = 0
  let rows = 0
  for (const f of fields) {
    if (f.name.value.startsWith('__')) continue
    count++
    const def = defs[f.name.value]
    if (def && isListType(getNullableType(def.type))) rows += takeOf(f.arguments?.find(a => a.name.value === 'take')?.value, variables)
    else if (def && getNamedType(def.type)) rows += 1
  }
  return { fields: count, rows }
}

/** graphql-yoga / envelop plugin: refuse an operation that is too wide before it runs. */
export function breadthLimitPlugin(limits = { fields: API_MAX_ROOT_FIELDS, rows: API_MAX_ROOT_ROWS }) {
  return {
    onExecute({ args, setResultAndStopExecution }: { args: { schema: GraphQLSchema; document: DocumentNode; operationName?: string | null; variableValues?: Vars }; setResultAndStopExecution: (r: unknown) => void }) {
      const { fields, rows } = measureBreadth(args.schema, args.document, args.operationName, args.variableValues)
      if (fields > limits.fields || rows > limits.rows) {
        const message = fields > limits.fields
          ? `The query runs ${fields} top-level fields; at most ${limits.fields} are allowed in one request.`
          : `The query asks for about ${rows} rows across its top-level fields; at most ${limits.rows} are allowed in one request.`
        setResultAndStopExecution({ errors: [new GraphQLError(message, { extensions: { code: 'QUERY_TOO_BROAD' } })] })
      }
    },
  }
}
