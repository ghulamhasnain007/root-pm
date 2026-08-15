import 'dotenv/config';

export const config = {
  port: parseInt(process.env.PORT ?? '3001', 10),
  host: process.env.HOST ?? '0.0.0.0',
  geminiApiKey: process.env.GEMINI_API_KEY ?? '',
  // gemini-3.1-flash-live-preview is the current recommended default for
  // voice-first builds — stronger reliable function calling, and (unlike
  // the older 2.5 native-audio preview) doesn't reject realtimeInput.audio
  // mid-session with a 1007 "CONTENT_TYPE_AUDIO not supported" close once
  // clientContent has been mixed in anywhere in the session's history.
  geminiModel: process.env.GEMINI_MODEL ?? 'gemini-3.1-flash-live-preview',
  defaultMeetingDurationMs: 5 * 60 * 1000,
  corsOrigin: '*',
  // Taiga — lets the ambient voice assistant read/write the real PM
  // platform (TaigaTaskStore) instead of only its own MongoDB slice.
  taiga: {
    url: process.env.TAIGA_URL ?? '',
    username: process.env.TAIGA_USER ?? '',
    password: process.env.TAIGA_PASS ?? '',
    projectSlug: process.env.TAIGA_PROJECT_SLUG ?? '',
  },
} as const;

if (!config.geminiApiKey) {
  throw new Error('GEMINI_API_KEY environment variable is required. Get one free at https://aistudio.google.com/apikey');
}

/** True when all four Taiga settings are present — the ambient assistant
 *  then uses TaigaTaskStore for task actions. */
export function isTaigaConfigured(): boolean {
  return Boolean(config.taiga.url && config.taiga.username && config.taiga.password && config.taiga.projectSlug);
}
