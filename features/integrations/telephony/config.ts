import { manualTelephony, setTelephony, twilioTelephony } from './index'

/** Choose the SMS adapter from the environment once at start-up: Twilio when configured, else manual. */
export function configureTelephonyFromEnv(env: Record<string, string | undefined> = process.env) {
  if (env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN) {
    setTelephony(twilioTelephony({ accountSid: env.TWILIO_ACCOUNT_SID, authToken: env.TWILIO_AUTH_TOKEN, messagingServiceSid: env.TWILIO_MESSAGING_SERVICE_SID || undefined }))
    return 'twilio'
  }
  setTelephony(manualTelephony)
  return 'manual'
}
