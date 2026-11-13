import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { 
  Tool,
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { 
  getIntrospectionQuery, 
  buildClientSchema, 
  GraphQLSchema,
  isNonNullType,
  isListType,
  isInputObjectType,
} from 'graphql';
import { getBaseUrl } from '@/features/dashboard/lib/getBaseUrl';
import { keystoneContext } from '@/features/keystone/context';
import { authorizeMcpRequest } from '@/features/keystone/mcp-oauth/http';
import { internalGraphqlEndpoint } from '@/features/keystone/lib/internal-origin';
import { DOMAIN_TOOLS, runDomainTool } from '@/features/keystone/mcp';
import { buildListRead, listQueryAllowlist, MAX_TAKE, QueryInputError } from '@/features/keystone/mcp/safeQuery';

// Generated list queries MCP may read (never custom queries, never never-for-agents lists).
const LIST_READS = listQueryAllowlist((keystoneContext as any).__internal.lists);

// Get simple type name for display
function getSimpleTypeName(type: any): string {
  if (isNonNullType(type)) {
    return getSimpleTypeName(type.ofType);
  }
  if (isListType(type)) {
    return `[${getSimpleTypeName(type.ofType)}]`;
  }
  return type.name || type.toString();
}

// Execute GraphQL query as the caller: their session cookie, or their MCP OAuth bearer token
async function executeGraphQL(query: string, graphqlEndpoint: string, auth: Record<string, string>, variables?: Record<string, unknown>): Promise<any> {
  const response = await fetch(graphqlEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...auth,
    },
    body: JSON.stringify({ query, variables }),
  });

  const result = await response.json();
  if (result.errors) {
    throw new Error(`GraphQL execution failed: ${JSON.stringify(result.errors)}`);
  }
  return result;
}

// Get GraphQL schema from introspection
async function getGraphQLSchema(graphqlEndpoint: string, auth: Record<string, string>): Promise<GraphQLSchema> {
  const response = await fetch(graphqlEndpoint, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      ...auth,
    },
    body: JSON.stringify({ query: getIntrospectionQuery() }),
  });
  
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  
  const result = await response.json();
  if (result.errors) {
    throw new Error(`GraphQL introspection failed: ${JSON.stringify(result.errors)}`);
  }
  
  return buildClientSchema(result.data);
}

export async function POST(request: Request, { params }: { params: Promise<{ transport: string }> }) {
  try {
    const { transport } = await params;
    
    // Construct GraphQL endpoint
    const graphqlEndpoint = internalGraphqlEndpoint() ?? `${await getBaseUrl()}/api/graphql`;
    
    // Parse the JSON-RPC request
    const body = await request.json();

    // Every call runs as one Keystone user: the session cookie (built-in assistant)
    // or an MCP OAuth token. Without either, answer with the OAuth challenge.
    const authorization = await authorizeMcpRequest(keystoneContext, request, body);
    if (authorization instanceof Response) return authorization;
    const auth = authorization.forwardHeaders;

    // Notifications have no response body (Streamable HTTP: 202 Accepted)
    if (typeof body.method === 'string' && body.method.startsWith('notifications/')) {
      return new Response(null, { status: 202 });
    }

    // Get the GraphQL schema
    const schema = await getGraphQLSchema(graphqlEndpoint, auth);
    
    // Handle the request based on method
    if (body.method === 'initialize') {
      return new Response(JSON.stringify({
        jsonrpc: '2.0',
        id: body.id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: { listChanged: true },
          },
          serverInfo: {
            name: 'openfront-vet-clinic',
            version: '0.1.0'
          }
        }
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } else if (body.method === 'ping') {
      return new Response(JSON.stringify({
        jsonrpc: '2.0',
        id: body.id,
        result: {}
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } else if (body.method === 'tools/list') {
      // Return tools
      const tools: Tool[] = [{
        name: 'listModels',
        description: 'List all available GraphQL models/types in the system',
        inputSchema: {
          type: 'object',
          properties: {},
          required: []
        }
      }, {
        name: 'queryData',
        description: `Read rows of one list as you (your role decides what you see). At most ${MAX_TAKE} rows per call; page with offset.`,
        inputSchema: {
          type: 'object',
          properties: {
            operation: {
              type: 'string',
              description: 'A list query name from listModels (e.g., "patients", "clients", "appointments")'
            },
            fields: {
              type: 'string',
              description: 'Field names to return, nested with braces (e.g., "id name species { name }"). No arguments or aliases; at most 4 levels.'
            },
            limit: { type: 'integer', minimum: 1, maximum: MAX_TAKE, description: `Rows to return (default 25, at most ${MAX_TAKE})` },
            offset: { type: 'integer', minimum: 0, description: 'Rows to skip, for paging' },
            where: { type: 'object', description: 'Optional filter in the list\'s own where syntax (e.g. {"status":{"equals":"open"}}). Runs as you: a field you may not read cannot be filtered on.' }
          },
          required: ['operation', 'fields'],
          additionalProperties: false
        }
      }, {
        name: 'searchModels',
        description: 'Search for models by name pattern',
        inputSchema: {
          type: 'object',
          properties: {
            searchTerm: {
              type: 'string',
              description: 'The search term to find models (e.g., "User", "Patient", "Role")'
            }
          },
          required: ['searchTerm']
        }
      }, {
        name: 'getFieldsForType',
        description: 'Get all available fields for a specific GraphQL type',
        inputSchema: {
          type: 'object',
          properties: {
            typeName: {
              type: 'string',
              description: 'The GraphQL type name to get fields for (e.g., "User", "Patient", "Role")'
            }
          },
          required: ['typeName']
        }
      }, {
        name: 'lookupInputType',
        description: 'Get the structure of a GraphQL input type for mutations',
        inputSchema: {
          type: 'object',
          properties: {
            inputTypeName: {
              type: 'string',
              description: 'The GraphQL input type name (e.g., "UserCreateInput", "ClientUpdateInput")'
            }
          },
          required: ['inputTypeName']
        }
      }, {
        name: 'modelSpecificSearch',
        description: 'Perform intelligent search on a specific model using the same logic as the dashboard search functionality',
        inputSchema: {
          type: 'object',
          properties: {
            modelName: {
              type: 'string',
              description: 'The model name to search (e.g., "Client", "User", "Patient"). Will be automatically converted to the correct GraphQL operation name.'
            },
            searchQuery: {
              type: 'string',
              description: 'The search term to find within the model. Supports both ID matching and text field searching with case-insensitive matching.'
            },
            fields: {
              type: 'string',
              description: 'Field names to return from matching items (e.g., "id name email"). No arguments or aliases; at most 4 levels.'
            },
            limit: { type: 'integer', minimum: 1, maximum: MAX_TAKE, description: `Rows to return (default 10, at most ${MAX_TAKE})` }
          },
          required: ['modelName', 'searchQuery', 'fields'],
          additionalProperties: false
        }
      }];
      
      // Generic reads above; every write is a domain tool that runs one audited command.
      tools.push(...DOMAIN_TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })));
      return new Response(JSON.stringify({
        jsonrpc: '2.0',
        id: body.id,
        result: { tools }
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } else if (body.method === 'tools/call') {
      // Handle tool call
      const { name, arguments: args } = body.params;

      try {
        if (name === 'listModels') {
          const allModels: any[] = [];
          
          // Get all types from schema
          const typeMap = schema.getTypeMap();
          
          for (const [typeName, type] of Object.entries(typeMap)) {
            // Skip built-in GraphQL types
            if (typeName.startsWith('__')) continue;
            
            // Find related operations for this type
            const relatedOps: string[] = [];
            
            // Check queries
            if (schema.getQueryType()) {
              const queryFields = schema.getQueryType()!.getFields();
              for (const [queryName] of Object.entries(queryFields)) {
                const baseTypeName = typeName.toLowerCase().replace(/input$|type$/i, '');
                if (queryName.toLowerCase().includes(baseTypeName) || 
                    queryName.toLowerCase() === baseTypeName + 's' ||
                    queryName.toLowerCase() === baseTypeName) {
                  relatedOps.push(`Query: ${queryName}`);
                }
              }
            }
            
            // Check mutations  
            if (schema.getMutationType()) {
              const mutationFields = schema.getMutationType()!.getFields();
              for (const [mutationName] of Object.entries(mutationFields)) {
                const baseTypeName = typeName.toLowerCase().replace(/input$|type$/i, '');
                if (mutationName.toLowerCase().includes(baseTypeName)) {
                  relatedOps.push(`Mutation: ${mutationName}`);
                }
              }
            }
            
            allModels.push({
              typeName,
              description: type.description || `GraphQL type: ${typeName}`,
              kind: type.constructor.name,
              relatedOperations: relatedOps
            });
          }
          
          // Sort by name
          allModels.sort((a, b) => a.typeName.localeCompare(b.typeName));
          
          const result = {
            totalModels: allModels.length,
            models: allModels
          };
          
          return new Response(JSON.stringify({
            jsonrpc: '2.0',
            id: body.id,
            result: {
              content: [{
                type: 'text',
                text: JSON.stringify(result, null, 2),
              }],
            }
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        
        if (name === 'queryData') {
          // F3: allowlisted list query, rebuilt selection, capped rows; runs as the caller.
          const built = buildListRead(LIST_READS, { operation: args?.operation, fields: args?.fields, limit: args?.limit, offset: args?.offset, where: args?.where }, schema);
          const result = await executeGraphQL(built.query, graphqlEndpoint, auth, built.variables);
          
          return new Response(JSON.stringify({
            jsonrpc: '2.0',
            id: body.id,
            result: {
              content: [{
                type: 'text',
                text: JSON.stringify(result, null, 2),
              }],
            }
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        
        if (name === 'searchModels') {
          const { searchTerm } = args;
          const searchLower = searchTerm.toLowerCase();
          
          const matchingModels: any[] = [];
          
          // Get all types from schema
          const typeMap = schema.getTypeMap();
          
          for (const [typeName, type] of Object.entries(typeMap)) {
            // Skip built-in GraphQL types
            if (typeName.startsWith('__')) continue;
            
            // Check if type name matches search term
            if (typeName.toLowerCase().includes(searchLower)) {
              // Find related operations for this type
              const relatedOps: string[] = [];
              
              // Check queries
              if (schema.getQueryType()) {
                const queryFields = schema.getQueryType()!.getFields();
                for (const [queryName] of Object.entries(queryFields)) {
                  const baseTypeName = typeName.toLowerCase().replace(/input$|type$/i, '');
                  if (queryName.toLowerCase().includes(baseTypeName) || 
                      queryName.toLowerCase() === baseTypeName + 's' ||
                      queryName.toLowerCase() === baseTypeName) {
                    relatedOps.push(`Query: ${queryName}`);
                  }
                }
              }
              
              // Check mutations  
              if (schema.getMutationType()) {
                const mutationFields = schema.getMutationType()!.getFields();
                for (const [mutationName] of Object.entries(mutationFields)) {
                  const baseTypeName = typeName.toLowerCase().replace(/input$|type$/i, '');
                  if (mutationName.toLowerCase().includes(baseTypeName)) {
                    relatedOps.push(`Mutation: ${mutationName}`);
                  }
                }
              }
              
              matchingModels.push({
                typeName,
                description: type.description || `GraphQL type: ${typeName}`,
                kind: type.constructor.name,
                relatedOperations: relatedOps
              });
            }
          }
          
          // Sort by name
          matchingModels.sort((a, b) => a.typeName.localeCompare(b.typeName));
          
          const result = {
            searchTerm,
            matchingModels: matchingModels.length,
            models: matchingModels
          };
          
          return new Response(JSON.stringify({
            jsonrpc: '2.0',
            id: body.id,
            result: {
              content: [{
                type: 'text',
                text: JSON.stringify(result, null, 2),
              }],
            }
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        
        if (name === 'getFieldsForType') {
          const { typeName } = args;
          
          // Get the specific type from schema
          const typeMap = schema.getTypeMap();
          const type = typeMap[typeName];
          
          if (!type) {
            return new Response(JSON.stringify({
              jsonrpc: '2.0',
              id: body.id,
              result: {
                content: [{
                  type: 'text',
                  text: JSON.stringify({
                    error: `Type '${typeName}' not found in schema`,
                    availableTypes: Object.keys(typeMap).filter(name => !name.startsWith('__'))
                  }, null, 2),
                }],
              }
            }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          
          const fields: any[] = [];
          
          // Check if type has fields (ObjectType or InputObjectType)
          if ('getFields' in type && typeof type.getFields === 'function') {
            const typeFields = type.getFields();
            
            for (const [fieldName, field] of Object.entries(typeFields)) {
              const fieldInfo: any = {
                name: fieldName,
                type: getSimpleTypeName(field.type),
                description: field.description || null
              };
              
              // Add args if it's a field with arguments
              if ('args' in field && field.args && field.args.length > 0) {
                fieldInfo.args = field.args.map((arg: any) => ({
                  name: arg.name,
                  type: getSimpleTypeName(arg.type),
                  description: arg.description || null,
                  defaultValue: arg.defaultValue
                }));
              }
              
              fields.push(fieldInfo);
            }
          }
          
          const result = {
            typeName,
            typeKind: type.constructor.name,
            description: type.description || null,
            fields: fields
          };
          
          return new Response(JSON.stringify({
            jsonrpc: '2.0',
            id: body.id,
            result: {
              content: [{
                type: 'text',
                text: JSON.stringify(result, null, 2),
              }],
            }
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        
        if (name === 'lookupInputType') {
          const { inputTypeName } = args;
          
          // Get the specific input type from schema
          const typeMap = schema.getTypeMap();
          const inputType = typeMap[inputTypeName];
          
          if (!inputType) {
            return new Response(JSON.stringify({
              jsonrpc: '2.0',
              id: body.id,
              result: {
                content: [{
                  type: 'text',
                  text: JSON.stringify({
                    error: `Input type '${inputTypeName}' not found in schema`,
                    availableInputTypes: Object.keys(typeMap).filter(name => 
                      !name.startsWith('__') && name.toLowerCase().includes('input')
                    )
                  }, null, 2),
                }],
              }
            }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          
          const inputFields: any[] = [];
          
          // Check if it's an input object type
          if (isInputObjectType(inputType)) {
            const fields = inputType.getFields();
            
            for (const [fieldName, field] of Object.entries(fields)) {
              const inputField = field as any;
              const inputFieldInfo: any = {
                name: fieldName,
                type: getSimpleTypeName(inputField.type),
                description: inputField.description || null,
                required: isNonNullType(inputField.type),
                defaultValue: inputField.defaultValue
              };
              
              inputFields.push(inputFieldInfo);
            }
          }
          
          const result = {
            inputTypeName,
            typeKind: inputType.constructor.name,
            description: inputType.description || null,
            fields: inputFields,
            isInputType: isInputObjectType(inputType)
          };
          
          return new Response(JSON.stringify({
            jsonrpc: '2.0',
            id: body.id,
            result: {
              content: [{
                type: 'text',
                text: JSON.stringify(result, null, 2),
              }],
            }
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        
        if (name === 'modelSpecificSearch') {
          const { modelName, searchQuery, fields, limit } = args ?? {};
          
          // Get all types from schema to find the correct model
          const typeMap = schema.getTypeMap();
          let foundModel = null;
          let operationName = null;
          
          // Find the model by name (case-insensitive)
          const modelNameLower = modelName.toLowerCase();
          for (const [typeName] of Object.entries(typeMap)) {
            if (typeName.toLowerCase() === modelNameLower || 
                typeName.toLowerCase() === modelNameLower + 's' ||
                typeName.toLowerCase().replace(/s$/, '') === modelNameLower) {
              foundModel = typeName;
              break;
            }
          }
          
          if (!foundModel) {
            return new Response(JSON.stringify({
              jsonrpc: '2.0',
              id: body.id,
              result: {
                content: [{
                  type: 'text',
                  text: JSON.stringify({
                    error: `Model '${modelName}' not found in schema`,
                    availableModels: Object.keys(typeMap).filter(name => !name.startsWith('__'))
                  }, null, 2),
                }],
              }
            }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          
          // Find the corresponding query operation
          if (schema.getQueryType()) {
            const queryFields = schema.getQueryType()!.getFields();
            const modelLower = foundModel.toLowerCase();
            
            // Try various naming conventions
            const possibleNames = [
              modelLower + 's',  // products
              modelLower,        // product
              foundModel.charAt(0).toLowerCase() + foundModel.slice(1) + 's', // Products -> products
              foundModel.charAt(0).toLowerCase() + foundModel.slice(1)        // Products -> product
            ];
            
            for (const name of possibleNames) {
              if (queryFields[name]) {
                operationName = name;
                break;
              }
            }
          }
          
          if (!operationName) {
            return new Response(JSON.stringify({
              jsonrpc: '2.0',
              id: body.id,
              result: {
                content: [{
                  type: 'text',
                  text: JSON.stringify({
                    error: `No query operation found for model '${modelName}'`,
                    foundModel,
                    availableOperations: schema.getQueryType() ? Object.keys(schema.getQueryType()!.getFields()) : []
                  }, null, 2),
                }],
              }
            }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          
          // Get the actual fields available on this model by checking the GraphQL schema
          const queryField = schema.getQueryType()?.getFields()[operationName];
          const returnType = queryField?.type;
          let availableFields: string[] = [];
          
          // Extract the element type from list types and non-null wrappers
          let elementType = returnType;
          while (elementType && (isListType(elementType) || isNonNullType(elementType))) {
            elementType = elementType.ofType;
          }
          
          if (elementType && 'getFields' in elementType && typeof elementType.getFields === 'function') {
            const modelFields = elementType.getFields();
            availableFields = Object.keys(modelFields);
          }
          
          // Search text goes in as a variable; the selection and row cap go through the same F3 checks.
          const searchTerm = String(searchQuery ?? '').trim().slice(0, 200);
          const searchConditions: Record<string, unknown>[] = [];
          if (searchTerm && availableFields.includes('id')) searchConditions.push({ id: { equals: searchTerm } });
          const commonSearchFields = ['name', 'title', 'label', 'description', 'email', 'displayName', 'ref'];
          const validSearchFields = commonSearchFields.filter(field => availableFields.includes(field));
          for (const fieldName of validSearchFields) {
            searchConditions.push(fieldName === 'ref' ? { ref: { equals: searchTerm } } : { [fieldName]: { contains: searchTerm, mode: 'insensitive' } });
          }
          const built = buildListRead(LIST_READS, { operation: operationName, fields, limit: limit ?? 10, where: searchConditions.length ? { OR: searchConditions } : {} }, schema);
          const result = await executeGraphQL(built.query, graphqlEndpoint, auth, built.variables);
          
          return new Response(JSON.stringify({
            jsonrpc: '2.0',
            id: body.id,
            result: {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  searchQuery: searchTerm,
                  modelName: foundModel,
                  operationName,
                  availableFields,
                  validSearchFields,
                  results: result,
                  total: result?.data?.[operationName]?.length || 0
                }, null, 2),
              }],
            }
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        
        const domain = DOMAIN_TOOLS.find((tool) => tool.name === name);
        if (domain) {
          const output = await runDomainTool(domain, args ?? {}, { graphqlEndpoint, auth });
          return new Response(JSON.stringify({
            jsonrpc: '2.0',
            id: body.id,
            result: { content: [{ type: 'text', text: JSON.stringify(output, null, 2) }] },
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json', ...(domain.writes ? { 'X-Data-Changed': 'true' } : {}) },
          });
        }

        throw new Error(`Tool ${name} not found`);
      } catch (error) {
        return new Response(JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            isError: true,
            content: [{
              type: 'text',
              text: error instanceof QueryInputError ? `Refused: ${error.message}` : `Error executing ${name}: ${error}`,
            }],
          }
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    } else {
      return new Response(JSON.stringify({
        jsonrpc: '2.0',
        id: body.id,
        error: { code: -32601, message: 'Method not found' }
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch (error) {
    return new Response(JSON.stringify({
      jsonrpc: '2.0',
      id: null,
      error: { 
        code: -32603, 
        message: 'Internal error',
        data: error instanceof Error ? error.message : String(error)
      }
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// Stateless Streamable HTTP: no server-initiated SSE stream, so GET is 405 (MCP spec).
export async function GET() {
  return new Response(JSON.stringify({ error: 'Method not allowed. POST JSON-RPC to this endpoint.' }), {
    status: 405,
    headers: { 'Content-Type': 'application/json', Allow: 'POST' },
  });
}
