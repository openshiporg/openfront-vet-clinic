import { keystoneContext } from '../../features/keystone/context'
import { useMcpScopeGuard as mcpScopeGuardPlugin } from '../../features/keystone/mcp-oauth/guard'
import { readAuditPlugin } from '../../features/keystone/security/readAudit'
import { depthLimitPlugin } from '../../features/keystone/security/depthLimit'
import { breadthLimitPlugin } from '../../features/keystone/security/breadthLimit'
import { createYoga } from "graphql-yoga";
// @ts-ignore
import processRequest from "graphql-upload/processRequest.js";
import { type NextApiRequest, type NextApiResponse } from 'next'

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const contentType = req.headers["content-type"];
  if (contentType?.startsWith("multipart/form-data")) {
    req.body = await processRequest(req, res);
  }

  return createYoga({
    // No GraphiQL or Sandbox page: GET for text/html is refused (406); queries go by POST.
    graphiql: false,
    graphqlEndpoint: "/api/graphql",
    schema: keystoneContext.graphql.schema,
    context: ({ req, res }: { req: any; res: any }) => {
      return keystoneContext.withRequest(req, res);
    },
    multipart: false,
    // MCP OAuth scopes only narrow: read-only tokens can't mutate, no token can manage credentials.
    // Every clinical or client record returned is written to ReadAudit; if that fails, nothing is returned.
    // Nesting is bounded for every caller (F3); rows per list query are bounded by graphql.maxTake.
    plugins: [depthLimitPlugin(), breadthLimitPlugin(), mcpScopeGuardPlugin(), readAuditPlugin(() => keystoneContext.prisma)],
  })(req, res);
}