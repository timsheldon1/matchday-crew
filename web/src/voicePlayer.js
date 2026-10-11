// Speaks the big commentary lines, one at a time.
// Uses the server's Azure AI Speech voice (/tts); falls back to the browser's own voice
// if the server voice is not configured or a request fails.

const LOCALES = { en: 'en-GB', sw: 'sw-KE', ja: 'ja-JP' };
const MAX_QUEUE = 2; // never fall far behind the live match

export function createVoicePlayer(onStatus = () => {}) {
  let queue = [];
  let playing = false;
  let audio = null;
  let serverVoice = null; // null = unknown, true/false after the first check

  async function hasServerVoice() {
    if (serverVoice === null) {
      try {
        const r = await fetch('/voice');
        serverVoice = r.ok && (await r.json()).enabled === true;
      } catch {
        serverVoice = false;
      }
      onStatus(serverVoice ? 'azure' : 'browser');
    }
    return serverVoice;
  }

  async function playServer({ text, lang }) {
    const r = await fetch(`/tts?lang=${lang}&text=${encodeURIComponent(text)}`);
    if (!r.ok) throw new Error(`tts ${r.status}`);
    const url = URL.createObjectURL(await r.blob());
    try {
      audio = new Audio(url);
      await audio.play();
      await new Promise((resolve) => { audio.onended = resolve; audio.onerror = resolve; audio.onpause = resolve; });
    } finally {
      URL.revokeObjectURL(url);
      audio = null;
    }
  }

  function playBrowser({ text, lang }) {
    return new Promise((resolve) => {
      const synth = window.speechSynthesis;
      if (!synth) return resolve();
      const locale = LOCALES[lang] ?? 'en-GB';
      const voice = synth.getVoices().find((v) => v.lang?.toLowerCase().startsWith(locale.slice(0, 2)));
      if (!voice && lang !== 'en') return resolve(); // no voice for this language: stay silent
      const u = new SpeechSynthesisUtterance(text);
      u.lang = locale;
      if (voice) u.voice = voice;
      u.rate = 1.05;
      u.onend = resolve;
      u.onerror = resolve;
      synth.speak(u);
    });
  }

  async function pump() {
    if (playing || !queue.length) return;
    playing = true;
    const item = queue.shift();
    try {
      if (await hasServerVoice()) await playServer(item);
      else await playBrowser(item);
    } catch {
      try { await playBrowser(item); } catch { /* stay silent */ }
    }
    playing = false;
    pump();
  }

  return {
    speak(text, lang, priority = 0.5) {
      if (!text) return;
      queue.push({ text, lang, priority });
      // Most important first; drop the rest so the voice stays live.
      queue.sort((a, b) => b.priority - a.priority);
      if (queue.length > MAX_QUEUE) queue.length = MAX_QUEUE;
      pump();
    },
    stop() {
      queue = [];
      audio?.pause();
      window.speechSynthesis?.cancel();
    },
  };
}
