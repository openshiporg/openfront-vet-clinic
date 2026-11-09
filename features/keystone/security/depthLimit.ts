import { GraphQLError, Kind, type ASTVisitor, type FragmentDefinitionNode, type SelectionSetNode, type ValidationContext } from 'graphql'

/*
 * F3 (review r3b): bound how deep one GraphQL operation may nest. Every relation hop is a join (and
 * a fan-out), so an unbounded `patients { ownerships { client { patients { … } } } }` is a cheap way
 * to make the server do a lot of work. Introspection (`__schema`, `__type`) is not counted: the
 * admin UI and MCP discovery need it and it never touches the database.
 */
export const API_MAX_DEPTH = 8

function depthOf(set: SelectionSetNode | undefined, fragments: Map<string, FragmentDefinitionNode>, seen: Set<string>): number {
  if (!set) return 0
  let max = 0
  for (const s of set.selections) {
    if (s.kind === Kind.FIELD) {
      if (s.name.value.startsWith('__')) continue
      max = Math.max(max, 1 + depthOf(s.selectionSet, fragments, seen))
    } else if (s.kind === Kind.INLINE_FRAGMENT) {
      max = Math.max(max, depthOf(s.selectionSet, fragments, seen))
    } else if (s.kind === Kind.FRAGMENT_SPREAD) {
      const name = s.name.value
      if (seen.has(name)) continue
      const fragment = fragments.get(name)
      if (!fragment) continue
      const next = new Set(seen).add(name)
      max = Math.max(max, depthOf(fragment.selectionSet, fragments, next))
    }
  }
  return max
}

export const depthLimitRule = (maxDepth = API_MAX_DEPTH) => (context: ValidationContext): ASTVisitor => {
  const document = context.getDocument()
  const fragments = new Map(document.definitions.filter((d): d is FragmentDefinitionNode => d.kind === Kind.FRAGMENT_DEFINITION).map(d => [d.name.value, d]))
  return {
    OperationDefinition(node) {
      const depth = depthOf(node.selectionSet, fragments, new Set())
      if (depth > maxDepth) context.reportError(new GraphQLError(`The query is nested ${depth} levels deep; at most ${maxDepth} are allowed.`, { nodes: [node], extensions: { code: 'QUERY_TOO_DEEP' } }))
    },
  }
}

/** graphql-yoga / envelop plugin adding the depth rule to validation. */
export function depthLimitPlugin(maxDepth = API_MAX_DEPTH) {
  return {
    onValidate({ addValidationRule }: { addValidationRule: (rule: unknown) => void }) {
      addValidationRule(depthLimitRule(maxDepth))
    },
  }
}
