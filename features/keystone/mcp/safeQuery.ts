import { Kind, parse, validate, type DocumentNode, type GraphQLSchema } from 'graphql'
import { NEVER_TOOL_PATTERNS } from './registry'

/*
 * F3 (review r3b): the generic MCP read tools used to paste the caller's `operation` and `fields`
 * straight into a GraphQL document, so a caller could close the selection and add another root
 * field, aliases or arguments, and nothing capped the rows. Now:
 *  - `operation` must be one of the generated list queries (patients, clients, …): never a custom
 *    query, never a root field the caller names freely, never a never-for-agents list;
 *  - `fields` is parsed against a strict grammar (names and nested braces only: no arguments,
 *    aliases, directives, fragments, strings or commas that change meaning) and rebuilt;
 *  - nesting is capped at MAX_DEPTH, the field count at MAX_FIELDS, rows at MAX_TAKE;
 *  - search text goes in as a GraphQL variable, never into the document;
 *  - the rebuilt document is validated against the caller's own schema before it runs, and it
 *    runs as the caller, so list, field and relation-filter access apply on top.
 */
export const MAX_DEPTH = 4
export const MAX_FIELDS = 80
export const MAX_TAKE = 200
export const DEFAULT_TAKE = 25

const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/

export class QueryInputError extends Error {}

type Node = { name: string; children: Node[] | null }

/** Parse and rebuild a selection like `id name owner { id displayName }`. */
export function parseSelection(input: unknown): string {
  if (typeof input !== 'string' || !input.trim() || input.length > 2000) throw new QueryInputError('fields must be a short list of field names, e.g. "id name"')
  const tokens = input.match(/[A-Za-z_][A-Za-z0-9_]*|[{}]|\s+|,|./g) ?? []
  let i = 0
  let count = 0
  const skip = () => { while (i < tokens.length && (/^\s+$/.test(tokens[i]) || tokens[i] === ',')) i++ }
  const parseSet = (depth: number): Node[] => {
    if (depth > MAX_DEPTH) throw new QueryInputError(`fields are nested too deeply (at most ${MAX_DEPTH} levels)`)
    const nodes: Node[] = []
    for (skip(); i < tokens.length && tokens[i] !== '}'; skip()) {
      const t = tokens[i]
      if (!NAME.test(t)) throw new QueryInputError(`"${t.slice(0, 20)}" is not allowed in fields; use plain field names and { } only`)
      if (t.startsWith('__')) throw new QueryInputError('Introspection fields are not allowed in fields')
      if (++count > MAX_FIELDS) throw new QueryInputError(`Too many fields (at most ${MAX_FIELDS})`)
      i++
      while (i < tokens.length && /^\s+$/.test(tokens[i])) i++
      let children: Node[] | null = null
      if (tokens[i] === '{') {
        i++
        children = parseSet(depth + 1)
        if (tokens[i] !== '}') throw new QueryInputError('Unclosed "{" in fields')
        i++
        if (!children.length) throw new QueryInputError('Empty { } in fields')
      }
      nodes.push({ name: t, children })
    }
    return nodes
  }
  const nodes = parseSet(1)
  if (i < tokens.length) throw new QueryInputError('Unbalanced "}" in fields')
  if (!nodes.length) throw new QueryInputError('Select at least one field')
  const render = (list: Node[]): string => list.map(n => (n.children ? `${n.name} { ${render(n.children)} }` : n.name)).join(' ')
  return render(nodes)
}

export type ListQuery = { operation: string; typeName: string; whereInputName: string; countName: string }

/**
 * The root fields MCP may read: generated list queries only (from Keystone's own list metadata),
 * minus anything on the never-for-agents list. `lists` is keystoneContext.__internal.lists.
 */
export function listQueryAllowlist(lists: Record<string, any>): Map<string, ListQuery> {
  const allowed = new Map<string, ListQuery>()
  for (const [key, list] of Object.entries(lists)) {
    if (!list.graphql?.isEnabled?.query) continue
    const names = list.graphql.names
    if (NEVER_TOOL_PATTERNS.some(({ pattern }) => pattern.test(key) || pattern.test(names.listQueryName))) continue
    allowed.set(names.listQueryName, { operation: names.listQueryName, typeName: names.outputTypeName, whereInputName: names.whereInputName, countName: names.listQueryCountName })
  }
  return allowed
}

export function parseTake(input: unknown): number {
  if (input === undefined || input === null || input === '') return DEFAULT_TAKE
  const n = typeof input === 'string' && /^\d+$/.test(input) ? Number(input) : input
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1) throw new QueryInputError('limit must be a whole number of rows, at least 1')
  if (n > MAX_TAKE) throw new QueryInputError(`limit is at most ${MAX_TAKE} rows`)
  return n
}

export function parseSkip(input: unknown): number {
  if (input === undefined || input === null || input === '') return 0
  if (typeof input !== 'number' || !Number.isInteger(input) || input < 0 || input > 100_000) throw new QueryInputError('offset must be a whole number from 0')
  return input
}

/** Depth of the deepest selection in a document (root field = 1). */
export function selectionDepth(document: DocumentNode): number {
  const depth = (set: any): number => (!set ? 0 : 1 + Math.max(0, ...set.selections.map((s: any) => (s.kind === Kind.FIELD ? depth(s.selectionSet) : depth(s.selectionSet)))))
  return Math.max(0, ...document.definitions.map((d: any) => depth(d.selectionSet) - 1))
}

export type BuiltQuery = { query: string; variables: Record<string, unknown>; operation: string }

/** Build the one safe list read: `{ <operation>(where, take, skip) { <fields> } }`. */
export function buildListRead(
  allowlist: Map<string, ListQuery>,
  input: { operation: unknown; fields: unknown; limit?: unknown; offset?: unknown; where?: Record<string, unknown> | null },
  schema?: GraphQLSchema,
): BuiltQuery {
  const operation = typeof input.operation === 'string' ? input.operation : ''
  const entry = NAME.test(operation) ? allowlist.get(operation) : undefined
  if (!entry) throw new QueryInputError('operation must be one of the list queries from listModels (for example "patients" or "clients")')
  const selection = parseSelection(input.fields)
  const take = parseTake(input.limit)
  const skip = parseSkip(input.offset)
  const query = `query McpListRead($where: ${entry.whereInputName}!, $take: Int!, $skip: Int!) { ${entry.operation}(where: $where, take: $take, skip: $skip) { ${selection} } }`
  const document = parse(query)
  if (selectionDepth(document) > MAX_DEPTH) throw new QueryInputError(`fields are nested too deeply (at most ${MAX_DEPTH} levels)`)
  if (document.definitions.length !== 1) throw new QueryInputError('One query only')
  if (schema) {
    const errors = validate(schema, document)
    if (errors.length) throw new QueryInputError(`fields: ${errors.map(e => e.message).join('; ').slice(0, 400)}`)
  }
  return { query, variables: { where: input.where ?? {}, take, skip }, operation: entry.operation }
}
