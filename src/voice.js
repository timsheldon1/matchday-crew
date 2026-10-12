// Voice commentary with Azure AI Speech (neural text to speech).
//
// Voices: English (British broadcast style), Swahili (Kenya) and Japanese.
// Auth, in order of preference:
//   1. Microsoft Entra ID (same `az login` / managed identity as the agents). Needs SPEECH_REGION and
//      SPEECH_RESOURCE_ID, and the "Cognitive Services Speech User" role on the Foundry resource.
//   2. SPEECH_KEY from .env (the Foundry resource key). Never commit it.
// If neither works, the overlay falls back to the browser's built-in voice where one exists.

export const VOICES = {
  en: { locale: 'en-GB', name: 'en-GB-RyanNeural' },
  sw: { locale: 'sw-KE', name: 'sw-KE-RafikiNeural' },
  ja: { locale: 'ja-JP', name: 'ja-JP-KeitaNeural' },
};

const escapeXml = (s) => s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

export function ssml(text, lang) {
  const v = VOICES[lang] ?? VOICES.en;
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${v.locale}">` +
    `<voice name="${v.name}"><prosody rate="+6%">${escapeXml(text)}</prosody></voice></speak>`;
}

export async function createVoice({
  region = process.env.SPEECH_REGION,
  resourceId = process.env.SPEECH_RESOURCE_ID,
  key = process.env.SPEECH_KEY,
  credential,
  fetchImpl = fetch,
} = {}) {
  if (!region) return { enabled: false, reason: 'SPEECH_REGION not set', synthesize: async () => { throw new Error('voice disabled'); } };

  let mode = key ? 'key' : 'entra';
  let cred = credential;
  let token = null;
  const cache = new Map();

  async function authHeader() {
    if (mode === 'key') return { 'Ocp-Apim-Subscription-Key': key };
    if (!resourceId) throw new Error('SPEECH_RESOURCE_ID is needed for Entra ID auth (or set SPEECH_KEY)');
    if (!cred) {
      const { DefaultAzureCredential } = await import('@azure/identity');
      cred = new DefaultAzureCredential();
    }
    if (!token || token.expiresOnTimestamp - Date.now() < 120000) {
      token = await cred.getToken('https://cognitiveservices.azure.com/.default');
    }
    return { Authorization: `Bearer aad#${resourceId}#${token.token}` };
  }

  async function synthesize(text, lang = 'en') {
    const clean = String(text).slice(0, 600);
    const cacheKey = `${lang}|${clean}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey);
    const res = await fetchImpl(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: 'POST',
      headers: {
        ...(await authHeader()),
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
        'User-Agent': 'matchday-crew',
      },
      body: ssml(clean, lang),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      const hint = res.status === 401 || res.status === 403
        ? (mode === 'entra'
          ? ' Give your account the "Cognitive Services Speech User" role on the Foundry resource, or set SPEECH_KEY in .env.'
          : ' Check SPEECH_KEY and SPEECH_REGION.')
        : '';
      throw new Error(`Speech ${res.status} ${detail.slice(0, 160)}${hint}`);
    }
    const audio = Buffer.from(await res.arrayBuffer());
    if (cache.size > 300) cache.delete(cache.keys().next().value);
    cache.set(cacheKey, audio);
    return audio;
  }

  // Fetch the sign-in token ahead of time so the first spoken line is not delayed.
  async function warmup() {
    const t0 = Date.now();
    await authHeader();
    return Date.now() - t0;
  }

  return { enabled: true, get mode() { return mode; }, region, synthesize, warmup };
}
