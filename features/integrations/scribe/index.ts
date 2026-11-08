/*
 * Ambient scribe (INTEGRATIONS §8, DOMAIN I-R3). Two adapters, one per step:
 *   TranscriptionAdapter: room audio → transcript with speaker turns.
 *     - manual (default): the clinician pastes or dictates the transcript; nothing leaves the clinic.
 *     - whisper_compatible: any OpenAI-compatible /audio/transcriptions endpoint (self-hosted
 *       Whisper / faster-whisper, or a hosted one) at SCRIBE_STT_URL.
 *   ScribeModelAdapter: transcript → SOAP section drafts with evidence spans.
 *     - manual (default): no model; the transcript is offered as a single history draft for the
 *       clinician to edit.
 *     - llm: any OpenAI-compatible chat endpoint (OpenRouter, vLLM, Ollama) at SCRIBE_LLM_URL with
 *       SCRIBE_LLM_MODEL; JSON-only output validated before it is stored.
 * Neither adapter ever writes the record: drafts are accepted block by block by a person, and the
 * encounter still needs a veterinarian's signature.
 */

import { z } from 'zod'

export type TranscriptSegment = { speaker: string; text: string; startSec?: number; endSec?: number }
export type Transcript = { text: string; segments: TranscriptSegment[]; provider: string; ref: string }

export interface TranscriptionAdapter {
  readonly key: string
  transcribe(input: { audio?: Uint8Array | null; mimeType?: string | null; pastedText?: string | null; language?: string }): Promise<Transcript>
}

export const DRAFT_SECTION_KINDS = ['history', 'subjective', 'objective', 'assessment', 'plan', 'discharge', 'communication'] as const
export const DraftSchema = z.object({
  sections: z.array(z.object({
    kind: z.enum(DRAFT_SECTION_KINDS),
    body: z.string().min(1).max(8000),
    evidence: z.array(z.string().max(400)).max(20).default([]),
  })).max(10),
  suggestedCharges: z.array(z.object({ description: z.string().max(200), reason: z.string().max(400) })).max(20).default([]),
  confidence: z.string().regex(/^(0(\.\d{1,4})?|1(\.0{1,4})?)$/).default('0'),
})
export type Draft = z.infer<typeof DraftSchema>

export interface ScribeModelAdapter {
  readonly key: string
  readonly modelRef: string
  draft(input: { transcript: Transcript; species: string | null; patientName: string; templateHints?: string[] }): Promise<Draft>
}

/** Split "Speaker: text" lines (pasted transcripts) into segments; anything else is one segment. */
export function parsePasted(text: string): TranscriptSegment[] {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  return lines.map(line => {
    const m = /^([A-Za-z][A-Za-z .'-]{0,30}):\s*(.+)$/.exec(line)
    return m ? { speaker: m[1].trim(), text: m[2].trim() } : { speaker: 'unknown', text: line }
  })
}

export const manualTranscription: TranscriptionAdapter = {
  key: 'manual',
  async transcribe(input) {
    const text = (input.pastedText ?? '').trim()
    if (!text) throw new Error('Paste or dictate the conversation; no transcription service is connected.')
    return { text, segments: parsePasted(text), provider: 'manual', ref: `manual:${text.length}` }
  },
}

export function whisperCompatibleTranscription(config: { url: string; apiKey?: string; model?: string; fetch?: typeof fetch }): TranscriptionAdapter {
  const http = config.fetch ?? fetch
  return {
    key: 'whisper_compatible',
    async transcribe(input) {
      if (!input.audio?.length) return manualTranscription.transcribe(input)
      const form = new FormData()
      form.append('file', new Blob([new Uint8Array(input.audio)], { type: input.mimeType ?? 'audio/webm' }), 'visit.webm')
      form.append('model', config.model ?? 'whisper-1')
      form.append('response_format', 'verbose_json')
      if (input.language) form.append('language', input.language)
      const response = await http(`${config.url.replace(/\/$/, '')}/audio/transcriptions`, { method: 'POST', headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}, body: form })
      if (!response.ok) throw new Error(`Transcription failed (${response.status})`)
      const json = (await response.json()) as { text?: string; segments?: { text: string; start?: number; end?: number; speaker?: string }[]; id?: string }
      const text = String(json.text ?? '').trim()
      return { text, segments: (json.segments ?? []).map(s => ({ speaker: s.speaker ?? 'unknown', text: s.text.trim(), startSec: s.start, endSec: s.end })), provider: 'whisper_compatible', ref: json.id ?? `stt:${text.length}` }
    },
  }
}

export const manualScribeModel: ScribeModelAdapter = {
  key: 'manual',
  modelRef: 'none',
  async draft({ transcript }) {
    // No model: offer the conversation as a history draft, with the owner's words as evidence.
    const owner = transcript.segments.filter(s => !/^(dr|doctor|vet|tech|rvt)\b/i.test(s.speaker)).map(s => s.text)
    return { sections: [{ kind: 'history', body: (owner.length ? owner : [transcript.text]).join(' ').slice(0, 8000), evidence: owner.slice(0, 5) }], suggestedCharges: [], confidence: '0' }
  },
}

const SYSTEM_PROMPT = `You are a veterinary medical scribe. From the exam-room transcript, write concise SOAP sections for the veterinarian to review.
Rules: use only facts said in the transcript; never invent vitals, doses or diagnoses; if something was not said, leave it out.
Write the assessment as differentials when the veterinarian did not state a diagnosis. Quote short transcript evidence for each section.
Reply with JSON only: {"sections":[{"kind":"subjective|objective|assessment|plan|history|discharge|communication","body":"...","evidence":["..."]}],"suggestedCharges":[{"description":"...","reason":"..."}],"confidence":"0.00-1.00"}`

export function llmScribeModel(config: { url: string; apiKey: string; model: string; fetch?: typeof fetch }): ScribeModelAdapter {
  const http = config.fetch ?? fetch
  return {
    key: 'llm',
    modelRef: config.model,
    async draft({ transcript, species, patientName, templateHints }) {
      const user = `Patient: ${patientName} (${species ?? 'species not recorded'}).${templateHints?.length ? ` Practice template headings: ${templateHints.join(', ')}.` : ''}\nTranscript:\n${transcript.segments.length ? transcript.segments.map(s => `${s.speaker}: ${s.text}`).join('\n') : transcript.text}`
      const response = await http(`${config.url.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: config.model, temperature: 0, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: user.slice(0, 60_000) }] }),
      })
      if (!response.ok) throw new Error(`Scribe model failed (${response.status})`)
      const json = (await response.json()) as { choices?: { message?: { content?: string } }[] }
      const content = json.choices?.[0]?.message?.content ?? ''
      const start = content.indexOf('{')
      const parsed = DraftSchema.safeParse(JSON.parse(start >= 0 ? content.slice(start, content.lastIndexOf('}') + 1) : '{}'))
      if (!parsed.success) throw new Error('The scribe model returned an unusable draft.')
      return parsed.data
    },
  }
}

let transcription: TranscriptionAdapter = manualTranscription
let scribeModel: ScribeModelAdapter = manualScribeModel

export const scribeAdapters = () => ({ transcription, model: scribeModel })
export function setScribeAdapters(next: { transcription?: TranscriptionAdapter; model?: ScribeModelAdapter }) {
  if (next.transcription) transcription = next.transcription
  if (next.model) scribeModel = next.model
}

/** Choose adapters from the environment once at start-up; manual unless configured. */
export function configureScribeFromEnv(env: Record<string, string | undefined> = process.env) {
  setScribeAdapters({
    transcription: env.SCRIBE_STT_URL ? whisperCompatibleTranscription({ url: env.SCRIBE_STT_URL, apiKey: env.SCRIBE_STT_API_KEY, model: env.SCRIBE_STT_MODEL }) : manualTranscription,
    model: env.SCRIBE_LLM_URL && env.SCRIBE_LLM_API_KEY && env.SCRIBE_LLM_MODEL ? llmScribeModel({ url: env.SCRIBE_LLM_URL, apiKey: env.SCRIBE_LLM_API_KEY, model: env.SCRIBE_LLM_MODEL }) : manualScribeModel,
  })
  return { transcription: transcription.key, model: scribeModel.key }
}
