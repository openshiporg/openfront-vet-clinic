import { convertToModelMessages, streamText, stepCountIs } from 'ai';
import { createMCPClient } from '@ai-sdk/mcp';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { getBaseUrl } from '@/features/dashboard/lib/getBaseUrl';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { IncomingMessage } from 'node:http';
import { keystoneContext } from '@/features/keystone/context';
import { permissions } from '@/features/keystone/access';
import { PUBLIC_REQUEST_ERROR, safeErrorSummary } from '@/features/dashboard/lib/security';
import { createScopedMcpFetch } from './scopedMcpFetch';
import { DOMAIN_TOOLS } from '@/features/keystone/mcp/registry';

const WRITE_TOOLS = new Set(DOMAIN_TOOLS.filter((tool) => tool.writes).map((tool) => tool.name));

export async function POST(req: Request) {
  let mcpClient: any = null;
  let dataHasChanged = false;

  try {
    const body = await req.json();
    let messages = body.messages || [];
    const prompt = body.prompt || body.messages?.[body.messages.length - 1]?.content || '';

    const MAX_MESSAGES = 20;
    if (messages.length > MAX_MESSAGES) {
      messages = messages.slice(-MAX_MESSAGES);
    }

    let apiKey: string;
    let model: string;
    let maxTokens: number | undefined;
    const baseURL = 'https://openrouter.ai/api/v1';

    if (body.useLocalKeys === true) {
      if (typeof body.apiKey !== 'string' || !body.apiKey || typeof body.model !== 'string' || !body.model) {
        return Response.json({ error: 'Local API key and model are required.' }, { status: 400 });
      }
      apiKey = body.apiKey;
      model = body.model;
      maxTokens = body.maxTokens ? parseInt(String(body.maxTokens), 10) : undefined;
    } else {
      // Reuse Keystone's session and permissions; never accept browser-supplied shared credentials.
      // Forward only the session cookie, not bearer/API-key headers.
      const context = await keystoneContext.withRequest({
        headers: { cookie: req.headers.get('cookie') || '' },
        method: req.method,
        url: '/api/completion',
      } as IncomingMessage);
      if (!context.session?.itemId) {
        return Response.json({ error: 'Please sign in to use shared AI.' }, { status: 401 });
      }
      const dashboardPermission = Reflect.get(permissions, 'canAccessDashboard');
      // Two family members use the same role flag in dashboard middleware but
      // do not export a named helper. Preserve that existing policy there.
      const canAccessDashboard = typeof dashboardPermission === 'function'
        ? await dashboardPermission({ session: context.session })
        : context.session.data?.role?.canAccessDashboard === true;
      if (canAccessDashboard !== true) {
        return Response.json({ error: 'Dashboard access is required.' }, { status: 403 });
      }
      if (!process.env.OPENROUTER_API_KEY || !process.env.OPENROUTER_MODEL) {
        return Response.json({ error: 'Shared AI is not available.' }, { status: 503 });
      }
      apiKey = process.env.OPENROUTER_API_KEY;
      model = process.env.OPENROUTER_MODEL;
      maxTokens = process.env.OPENROUTER_MAX_TOKENS
        ? parseInt(process.env.OPENROUTER_MAX_TOKENS, 10) : 4000;
    }

    try {
      const testResponse = await fetch('https://openrouter.ai/api/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        redirect: 'error',
      });
      if (!testResponse.ok) {
        console.error('AI key validation failed.');
        return Response.json({ error: 'Unable to validate AI credentials.' }, { status: 401 });
      }
    } catch (error) {
      console.error('AI key validation failed:', safeErrorSummary(error));
      return Response.json({ error: 'Unable to validate AI credentials.' }, { status: 401 });
    }

    const baseUrl = await getBaseUrl();
    const mcpEndpoint = `${baseUrl}/api/mcp-transport/http`;
    const cookie = req.headers.get('cookie') || '';

    const endpoint = new URL(mcpEndpoint);
    const transport = new StreamableHTTPClientTransport(endpoint, {
      fetch: createScopedMcpFetch(endpoint, cookie),
    });
    mcpClient = await createMCPClient({ transport });
    const aiTools = await mcpClient.tools();

    const systemInstructions = `You are the assistant inside Openfront Vet Clinic, a veterinary practice management system. You act as the signed-in staff member, with exactly their permissions.

READING DATA:
You read through the KeystoneJS GraphQL API with the discovery tools: searchModels finds a model from the user's words ("pet" → Patient, "owner" → Client), getFieldsForType lists its fields (call it on related types too), queryData runs a read, and modelSpecificSearch searches one model the way the dashboard does. Money fields ending in "Minor" are integer cents; doses, weights, quantities and concentrations are exact decimal strings. Show them exactly, never rounded through floating point. Every read of a client or patient record is written to the read audit.

CHANGING DATA:
There are no generic create, update or delete tools. Every change is a named domain command (for example loadPracticeSetup). Each command checks permissions on the server, needs an idempotencyKey (make a new unique one per user intent, reuse it only to retry the same intent), and is written to the hash-chained audit log. If no command fits what the user wants, say so and point them to the right dashboard screen.

You never approve anything, and you never establish a VCPR, prescribe, decide a refill, sign a record, touch the controlled-substance register, authorise euthanasia, discount, refund or write off. Those are licensed or second-person acts done by staff in the dashboard. You do not give medical advice; for a sick or injured animal, tell the user to speak to a veterinarian, and for an emergency, to call the hospital or the nearest emergency clinic now.

EXAMPLES:
- "Which policies are unverified?" → policyMatrix() and list the rows with verified=false
- "Who is licensed to prescribe at Elk Grove?" → searchModels("licence") → queryData(operation="professionalLicenses", fields="licenseNumber kind status expiresOn staffMember { displayName }")
- "Is the audit log intact?" → verifyAuditChain()

Always finish the workflow and return actual data, not just schema discovery.`;

    const openrouter = createOpenRouter({ apiKey, baseURL });

    // Support both the SDK sidebar and the older content-based submission hook.
    const inputMessages = messages.length > 0
      ? messages.map((message: any, index: number) => ({
          ...message,
          id: message.id || `message-${index}`,
          parts: message.parts || [{ type: 'text', text: message.content || '' }],
        }))
      : [{ id: `prompt-${Date.now()}`, role: 'user', parts: [{ type: 'text', text: prompt }] }];

    const streamTextConfig: any = {
      model: openrouter(model),
      tools: aiTools,
      messages: await convertToModelMessages(inputMessages),
      system: systemInstructions,
      stopWhen: stepCountIs(10),
      onStepFinish: async (step: { toolCalls?: any[] }) => {
        if (step.toolCalls && step.toolCalls.length > 0) {
          for (const toolCall of step.toolCalls) {
            if (WRITE_TOOLS.has(toolCall.toolName)) {
              dataHasChanged = true;
              console.log('Domain command completed');
              break;
            }
          }
        }
      },
      onFinish: async () => {
        console.log('Completion finished successfully', { dataHasChanged });
        await mcpClient.close();
      },
      onError: async (error: unknown) => {
        console.error('Stream error occurred:', safeErrorSummary(error));
        await mcpClient.close();
      },
    };

    if (maxTokens) {
      streamTextConfig.maxOutputTokens = maxTokens;
    }

    const result = streamText(streamTextConfig);

    return result.toUIMessageStreamResponse({
      originalMessages: inputMessages,
      onError: () => PUBLIC_REQUEST_ERROR,
    });
  } catch (error) {
    if (mcpClient) {
      try {
        await mcpClient.close();
      } catch {}
    }

    console.error('Completion API Error:', safeErrorSummary(error));

    return new Response(JSON.stringify({
      error: PUBLIC_REQUEST_ERROR
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
