/*
 * Inbound AI voice receptionist (INTEGRATIONS §7.2). The voice runtime (speech in, speech out, the
 * language model) is an adapter; the receptionist's decisions are the MCP reception tools, so every
 * action goes through the same commands, scopes and audit as a person at the front desk. Adapters:
 * - manual (default): calls ring the front desk; nothing is answered by the AI.
 * - hosted-voice-agent: any hosted voice-agent platform that can call MCP tools over HTTP with an
 *   OAuth client bound to the receptionist AgentIdentity (Vapi, Retell, ElevenLabs agents, …).
 * - twilio-media-streams: a self-hosted bridge (Twilio Media Streams + STT/LLM/TTS of your choice).
 * Outbound AI calls are modelled but refused (Euler decision 4; the database refuses them too).
 */

export type VoiceAgentKey = 'manual' | 'hosted-voice-agent' | 'twilio-media-streams'

export type AttachRequest = { callId: string; agentIdentityId: string; aiDisclosure: string; recordingDisclosure: string; locale: string }
export type VoiceAgentEvent =
  | { kind: 'transcript'; callId: string; speaker: 'caller' | 'agent'; text: string; at: string }
  | { kind: 'ended'; callId: string; summary: string; at: string }
  | { kind: 'ignored' }

export interface VoiceAgentAdapter {
  readonly key: VoiceAgentKey
  /** Hand the live call to the AI. A hand-off means the call stays with people. */
  attach(request: AttachRequest): Promise<{ status: 'attached'; sessionRef: string } | { status: 'handed_off'; reason: string }>
  hangupOrTransfer(request: { sessionRef: string; action: 'transfer' | 'transfer_urgent' | 'voicemail' | 'end'; to?: string; whisper?: string }): Promise<void>
  parseEvent(body: unknown): VoiceAgentEvent
}

/** The greeting every AI-answered call opens with, before anything else (FCC 24-17; CA all-party recording). */
export function disclosureScript(practiceName: string, recordingAllParty: boolean) {
  const recording = recordingAllParty
    ? 'This call is recorded so we can help you. If you would rather not be recorded, say "no recording" and I will stop recording.'
    : 'This call may be recorded.'
  return `Thank you for calling ${practiceName}. I am an automated AI assistant, not a person. ${recording} If your pet is having trouble breathing, has collapsed, or has eaten something poisonous, say "emergency" now.`
}

export const manualVoice: VoiceAgentAdapter = {
  key: 'manual',
  async attach() {
    return { status: 'handed_off', reason: 'No AI voice runtime is connected; the call rings the front desk.' }
  },
  async hangupOrTransfer() {},
  parseEvent() {
    return { kind: 'ignored' }
  },
}

export type HostedVoiceConfig = { baseUrl: string; apiKey: string; assistantId: string; fetch?: typeof fetch }

/**
 * A hosted voice-agent platform reached over REST: attach assigns the call to an assistant whose
 * tool server is this practice's MCP endpoint; events arrive at /api/webhooks/voice.
 */
export function hostedVoiceAgent(config: HostedVoiceConfig): VoiceAgentAdapter {
  const http = config.fetch ?? fetch
  const call = async (path: string, body: unknown) => {
    const response = await http(`${config.baseUrl.replace(/\/$/, '')}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const json = (await response.json().catch(() => ({}))) as { id?: string }
    if (!response.ok) throw new Error(`Voice agent ${path} failed (${response.status})`)
    return json
  }
  return {
    key: 'hosted-voice-agent',
    async attach(request) {
      const json = await call('/calls/attach', { assistantId: config.assistantId, externalCallId: request.callId, firstMessage: request.aiDisclosure, locale: request.locale, metadata: { agentIdentityId: request.agentIdentityId } })
      if (!json.id) return { status: 'handed_off', reason: 'The voice runtime did not accept the call.' }
      return { status: 'attached', sessionRef: String(json.id) }
    },
    async hangupOrTransfer(request) {
      await call(`/calls/${encodeURIComponent(request.sessionRef)}/control`, { action: request.action, to: request.to ?? null, whisper: request.whisper ?? null })
    },
    parseEvent(body) {
      const event = body as { type?: string; callId?: string; speaker?: string; text?: string; summary?: string; at?: string }
      const at = typeof event?.at === 'string' ? event.at : new Date().toISOString()
      if (event?.type === 'transcript' && event.callId) return { kind: 'transcript', callId: event.callId, speaker: event.speaker === 'agent' ? 'agent' : 'caller', text: String(event.text ?? '').slice(0, 2000), at }
      if (event?.type === 'ended' && event.callId) return { kind: 'ended', callId: event.callId, summary: String(event.summary ?? '').slice(0, 2000), at }
      return { kind: 'ignored' }
    },
  }
}

const FACTORIES: Record<VoiceAgentKey, ((config: Record<string, string>) => VoiceAgentAdapter) | null> = {
  manual: () => manualVoice,
  'hosted-voice-agent': c => hostedVoiceAgent({ baseUrl: c.baseUrl, apiKey: c.apiKey, assistantId: c.assistantId }),
  'twilio-media-streams': null,
}

export function voiceAgentAdapter(key: string, config: Record<string, string> = {}): VoiceAgentAdapter {
  const factory = FACTORIES[key as VoiceAgentKey]
  if (factory === undefined) throw new Error(`No voice agent adapter registered for ${key}`)
  if (factory === null) throw new Error(`The ${key} bridge is self-hosted: run it beside the app and register it here.`)
  return factory(config)
}
