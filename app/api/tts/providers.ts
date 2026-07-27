export type TtsPersona = 'jarvis' | 'friday';
export type TtsProviderId = 'max-local' | 'elevenlabs';

export interface TtsVoice {
  voice_id: string;
  name: string;
  labels: Record<string, string>;
  provider: TtsProviderId;
}

export interface TtsProviderStatus {
  id: TtsProviderId;
  configured: boolean;
  available: boolean;
  model?: string;
  device?: string;
  error?: string;
}

export interface TtsCatalogResult extends TtsProviderStatus {
  voices: TtsVoice[];
}

export interface TtsSynthesisInput {
  text: string;
  persona: TtsPersona;
  voiceId?: string;
  language?: string;
  emotion?: string;
  stream?: boolean;
  signal?: AbortSignal;
  stability: number;
  similarity: number;
  style: number;
  speed: number;
}

export interface TtsPcmStream {
  format: 'pcm_s16le';
  sampleRate: number;
  channels: 1;
}

export interface TtsAudioResult {
  ok: true;
  provider: TtsProviderId;
  voiceId: string;
  contentType: string;
  body: ReadableStream<Uint8Array> | null;
  stream?: TtsPcmStream;
}

export interface TtsFailureResult {
  ok: false;
  provider: TtsProviderId;
  error: string;
  status?: number;
}

export type TtsAttemptResult = TtsAudioResult | TtsFailureResult;

const ELEVENLABS_API = 'https://api.elevenlabs.io/v1';
const DEFAULT_JARVIS = 'pNInz6obpgDQGcFmaJgB';
const DEFAULT_FRIDAY = 'EXAVITQu4vr4xnSDxMaL';
const AUDIO_CONTENT_TYPE = /^audio\/(?:mpeg|mp3|wav|x-wav|ogg|webm|aac|mp4|flac|pcm)(?:;|$)/i;
const LOCAL_TTS_LANGUAGES = new Set(['ru', 'en', 'de', 'fr', 'es', 'it', 'pt', 'ja', 'ko', 'zh']);

function baseLanguageTag(locale: string | undefined): string {
  return String(locale || 'en').toLowerCase().split(/[-_]/)[0];
}

function envNumber(name: string, fallback: number, minimum: number, maximum: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;
}

function localTimeoutMs(): number {
  return envNumber('MAX17_TTS_TIMEOUT_MS', 25_000, 1_000, 55_000);
}

function metadataTimeoutMs(): number {
  return envNumber('MAX17_TTS_METADATA_TIMEOUT_MS', 2_500, 500, 10_000);
}

function elevenLabsTimeoutMs(): number {
  return envNumber('ELEVENLABS_TTS_TIMEOUT_MS', 25_000, 1_000, 55_000);
}

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function localConfig(): { baseUrl: string; token: string } | { error: string } | null {
  const raw = process.env.MAX17_TTS_URL?.trim();
  if (!raw) return null;

  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback(url.hostname))) {
      return { error: 'local_url_must_be_https' };
    }
    const token = process.env.MAX17_TTS_TOKEN?.trim() || '';
    if (!token && !isLoopback(url.hostname)) return { error: 'local_token_missing' };
    return { baseUrl: url.toString().replace(/\/+$/, ''), token };
  } catch {
    return { error: 'local_url_invalid' };
  }
}

function localHeaders(token: string): HeadersInit {
  if (!token) return {};
  return {
    Authorization: `Bearer ${token}`,
    'x-max17-tts-token': token,
  };
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const signal = externalSignal ? AbortSignal.any([controller.signal, externalSignal]) : controller.signal;
  try {
    return await fetch(url, { ...init, signal, cache: 'no-store' });
  } finally {
    clearTimeout(timer);
  }
}

async function safeJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function normalizeLocalVoice(value: unknown): TtsVoice | null {
  if (!value || typeof value !== 'object') return null;
  const voice = value as Record<string, unknown>;
  const rawId = String(voice.voice_id ?? voice.id ?? '').trim();
  if (!rawId) return null;
  const id = rawId.startsWith('max-local:') ? rawId : `max-local:${rawId}`;
  const labels =
    voice.labels && typeof voice.labels === 'object'
      ? Object.fromEntries(Object.entries(voice.labels as Record<string, unknown>).map(([key, item]) => [key, String(item)]))
      : {};
  return {
    voice_id: id,
    name: String(voice.name ?? rawId),
    labels: { ...labels, provider: 'MAX Voice' },
    provider: 'max-local',
  };
}

export function parseVoiceReference(value?: string): { provider?: TtsProviderId; id?: string } {
  const voiceId = value?.trim();
  if (!voiceId) return {};
  if (voiceId.startsWith('max-local:')) {
    return { provider: 'max-local', id: voiceId.slice('max-local:'.length) || undefined };
  }
  if (voiceId.startsWith('elevenlabs:')) {
    return { provider: 'elevenlabs', id: voiceId.slice('elevenlabs:'.length) || undefined };
  }
  // Existing localStorage values are raw ElevenLabs IDs.
  return { provider: 'elevenlabs', id: voiceId };
}

export async function listLocalVoices(): Promise<TtsCatalogResult> {
  const config = localConfig();
  if (!config) return { id: 'max-local', configured: false, available: false, voices: [] };
  if ('error' in config) {
    return { id: 'max-local', configured: true, available: false, voices: [], error: config.error };
  }

  try {
    const headers = localHeaders(config.token);
    const [healthResponse, voicesResponse] = await Promise.all([
      fetchWithTimeout(`${config.baseUrl}/health`, { headers }, metadataTimeoutMs()),
      fetchWithTimeout(`${config.baseUrl}/voices`, { headers }, metadataTimeoutMs()),
    ]);
    if (!healthResponse.ok || !voicesResponse.ok) {
      return {
        id: 'max-local',
        configured: true,
        available: false,
        voices: [],
        error: `http_${!healthResponse.ok ? healthResponse.status : voicesResponse.status}`,
      };
    }

    const [health, catalog] = await Promise.all([safeJson(healthResponse), safeJson(voicesResponse)]);
    const rawVoices = Array.isArray(catalog.voices) ? catalog.voices : [];
    const voices = rawVoices.map(normalizeLocalVoice).filter((voice): voice is TtsVoice => Boolean(voice));
    return {
      id: 'max-local',
      configured: true,
      available: true,
      model: typeof health.model === 'string' ? health.model : undefined,
      device: typeof health.device === 'string' ? health.device : undefined,
      voices,
    };
  } catch (error) {
    return {
      id: 'max-local',
      configured: true,
      available: false,
      voices: [],
      error: error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'unreachable',
    };
  }
}

export async function listElevenLabsVoices(): Promise<TtsCatalogResult> {
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) return { id: 'elevenlabs', configured: false, available: false, voices: [] };

  try {
    const response = await fetchWithTimeout(
      `${ELEVENLABS_API}/voices`,
      { headers: { 'xi-api-key': apiKey } },
      metadataTimeoutMs(),
    );
    if (!response.ok) {
      return {
        id: 'elevenlabs',
        configured: true,
        available: false,
        voices: [],
        error: `http_${response.status}`,
      };
    }
    const data = await safeJson(response);
    const rawVoices = Array.isArray(data.voices) ? data.voices : [];
    const voices = rawVoices
      .map((value): TtsVoice | null => {
        if (!value || typeof value !== 'object') return null;
        const voice = value as Record<string, unknown>;
        const rawId = String(voice.voice_id ?? '').trim();
        if (!rawId) return null;
        const labels =
          voice.labels && typeof voice.labels === 'object'
            ? Object.fromEntries(
                Object.entries(voice.labels as Record<string, unknown>).map(([key, item]) => [key, String(item)]),
              )
            : {};
        return {
          voice_id: `elevenlabs:${rawId}`,
          name: String(voice.name ?? rawId),
          labels: { ...labels, provider: 'ElevenLabs' },
          provider: 'elevenlabs',
        };
      })
      .filter((voice): voice is TtsVoice => Boolean(voice));
    return { id: 'elevenlabs', configured: true, available: true, voices };
  } catch (error) {
    return {
      id: 'elevenlabs',
      configured: true,
      available: false,
      voices: [],
      error: error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'unreachable',
    };
  }
}

export async function synthesizeLocal(input: TtsSynthesisInput): Promise<TtsAttemptResult> {
  const language = baseLanguageTag(input.language);
  if (!LOCAL_TTS_LANGUAGES.has(language)) {
    return { ok: false, provider: 'max-local', error: 'unsupported_language' };
  }
  const config = localConfig();
  if (!config) return { ok: false, provider: 'max-local', error: 'not_configured' };
  if ('error' in config) return { ok: false, provider: 'max-local', error: config.error };

  const voiceId = input.voiceId || input.persona;
  try {
    const response = await fetchWithTimeout(
      `${config.baseUrl}/synthesize`,
      {
        method: 'POST',
        headers: {
          ...localHeaders(config.token),
          'Content-Type': 'application/json',
          Accept: 'audio/*',
        },
        body: JSON.stringify({
          text: input.text,
          persona: input.persona,
          voice_id: voiceId,
          language,
          emotion: input.emotion,
          stability: input.stability,
          similarity: input.similarity,
          style: input.style,
          speed: input.speed,
          stream: input.stream === true,
        }),
      },
      localTimeoutMs(),
      input.signal,
    );
    const contentType = response.headers.get('content-type') || '';
    if (!response.ok || !AUDIO_CONTENT_TYPE.test(contentType)) {
      await response.body?.cancel().catch(() => {});
      return {
        ok: false,
        provider: 'max-local',
        error: response.ok ? 'non_audio_response' : `http_${response.status}`,
        status: response.status,
      };
    }
    let stream: TtsPcmStream | undefined;
    if (response.headers.get('x-max17-stream') === '1') {
      const format = response.headers.get('x-max17-audio-format');
      const sampleRate = Number(response.headers.get('x-max17-sample-rate'));
      const channels = Number(response.headers.get('x-max17-channels'));
      if (
        format !== 'pcm_s16le' ||
        !/^audio\/pcm(?:;|$)/i.test(contentType) ||
        !Number.isInteger(sampleRate) ||
        sampleRate < 8_000 ||
        sampleRate > 96_000 ||
        channels !== 1
      ) {
        await response.body?.cancel().catch(() => {});
        return {
          ok: false,
          provider: 'max-local',
          error: 'invalid_pcm_stream',
          status: response.status,
        };
      }
      stream = { format, sampleRate, channels: 1 };
    }
    return {
      ok: true,
      provider: 'max-local',
      voiceId,
      contentType,
      body: response.body,
      stream,
    };
  } catch (error) {
    return {
      ok: false,
      provider: 'max-local',
      error: error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'unreachable',
    };
  }
}

function resolveElevenLabsVoice(persona: TtsPersona, voiceId?: string): string {
  if (voiceId) return voiceId;
  if (persona === 'friday') return process.env.ELEVENLABS_VOICE_FRIDAY?.trim() || DEFAULT_FRIDAY;
  return process.env.ELEVENLABS_VOICE_JARVIS?.trim() || DEFAULT_JARVIS;
}

export async function synthesizeElevenLabs(input: TtsSynthesisInput): Promise<TtsAttemptResult> {
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) return { ok: false, provider: 'elevenlabs', error: 'not_configured' };

  const voiceId = resolveElevenLabsVoice(input.persona, input.voiceId);
  const call = () =>
    fetchWithTimeout(
      `${ELEVENLABS_API}/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        body: JSON.stringify({
          text: input.text,
          model_id: 'eleven_multilingual_v2',
          voice_settings: {
            stability: input.stability,
            similarity_boost: input.similarity,
            style: input.style,
            use_speaker_boost: true,
            speed: input.speed,
          },
        }),
      },
      elevenLabsTimeoutMs(),
      input.signal,
    );

  try {
    let response = await call();
    if (response.status === 429) {
      await response.body?.cancel().catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 700));
      response = await call();
    }
    const contentType = response.headers.get('content-type') || '';
    if (!response.ok || !AUDIO_CONTENT_TYPE.test(contentType)) {
      await response.body?.cancel().catch(() => {});
      return {
        ok: false,
        provider: 'elevenlabs',
        error: response.ok ? 'non_audio_response' : `http_${response.status}`,
        status: response.status,
      };
    }
    return {
      ok: true,
      provider: 'elevenlabs',
      voiceId,
      contentType,
      body: response.body,
    };
  } catch (error) {
    return {
      ok: false,
      provider: 'elevenlabs',
      error: error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'unreachable',
    };
  }
}
