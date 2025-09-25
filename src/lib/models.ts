// Centralize model IDs. Default chat model to 'gpt-5' per project requirement,
// but allow override via env. Keep STT on Whisper, and let TTS prefer an env
// model (default 'gpt-5') with fallbacks in the TTS route.
export const CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || 'gpt-5';
// Prefer a supported TTS by default; allow override via env
export const TTS_MODEL  = process.env.OPENAI_TTS_MODEL  || 'gpt-4o-mini-tts';
// Use a faster STT by default for lower latency; keep env override
export const STT_MODEL  = process.env.OPENAI_STT_MODEL  || 'gpt-4o-mini-transcribe';
