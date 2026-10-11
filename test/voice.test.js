import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVoice, ssml } from '../src/voice.js';

function fakeFetch(calls, status = 200) {
  return async (url, init) => {
    calls.push({ url, init });
    return {
      ok: status === 200,
      status,
      text: async () => 'denied',
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    };
  };
}

test('SSML picks the right voice and escapes text', () => {
  const x = ssml('Goal & <glory>', 'sw');
  assert.match(x, /sw-KE-RafikiNeural/);
  assert.match(x, /Goal &amp; &lt;glory&gt;/);
  assert.match(ssml('ゴール', 'ja'), /ja-JP-KeitaNeural/);
});

test('voice is disabled without a region', async () => {
  const v = await createVoice({ region: '' });
  assert.equal(v.enabled, false);
});

test('Entra ID auth sends the aad# bearer token to the regional endpoint, and caches audio', async () => {
  const calls = [];
  const credential = { getToken: async () => ({ token: 'tok', expiresOnTimestamp: Date.now() + 3600e3 }) };
  const v = await createVoice({ region: 'eastus2', resourceId: '/subscriptions/x/rg/y', credential, fetchImpl: fakeFetch(calls) });
  const a = await v.synthesize('Goal!', 'en');
  await v.synthesize('Goal!', 'en');
  assert.equal(calls.length, 1); // second call served from cache
  assert.equal(calls[0].url, 'https://eastus2.tts.speech.microsoft.com/cognitiveservices/v1');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer aad#/subscriptions/x/rg/y#tok');
  assert.equal(a.length, 3);
});

test('key auth uses the subscription key header', async () => {
  const calls = [];
  const v = await createVoice({ region: 'eastus2', key: 'k123', fetchImpl: fakeFetch(calls) });
  await v.synthesize('Goli!', 'sw');
  assert.equal(calls[0].init.headers['Ocp-Apim-Subscription-Key'], 'k123');
  assert.equal(v.mode, 'key');
});

test('a 401 explains how to fix access', async () => {
  const credential = { getToken: async () => ({ token: 'tok', expiresOnTimestamp: Date.now() + 3600e3 }) };
  const v = await createVoice({ region: 'eastus2', resourceId: '/r', credential, fetchImpl: fakeFetch([], 401) });
  await assert.rejects(v.synthesize('x', 'en'), /Speech User/);
});
