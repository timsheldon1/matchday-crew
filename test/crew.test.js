import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMatch } from '../src/generator.js';
import { createAnalyst } from '../src/analyst.js';
import { createCrew } from '../src/agents/crew.js';
import { ungroundedNumbers } from '../src/agents/grounding.js';
import { EXPLAINER, STORYTELLER, RECAP } from '../src/agents/definitions.js';

// A fake model so the orchestration can be tested without Azure.
function fakeLLM({ fail = new Set(), invent = false, delayMs = 1 } = {}) {
  const calls = [];
  return {
    mode: 'fake',
    calls,
    async run(agent, payload) {
      calls.push({ agent: agent.name, payload });
      await new Promise((r) => setTimeout(r, delayMs));
      if (fail.has(agent.name)) throw new Error('boom');
      if (agent === EXPLAINER) {
        const xg = payload.moment.facts?.xg;
        return {
          why: invent && !payload.feedback ? 'This was his 37th goal of the season.' : `${payload.moment.team} change the game.`,
          tacticalAngle: xg != null ? `Chance worth ${xg} xG.` : 'Momentum shifts.',
          keyNumbers: xg != null ? [`${xg} xG`] : [],
          confidence: 'high',
        };
      }
      if (agent === STORYTELLER) {
        return { lines: payload.languages.map((l) => ({ lang: l.code, text: `[${l.code}] ${payload.insight}` })) };
      }
      if (agent === RECAP) {
        return { recaps: payload.languages.map((l) => ({ lang: l.code, headline: `${l.code} recap`, recap: 'A good game.', playerOfTheMatch: payload.topPlayers[0].name })) };
      }
      throw new Error('unknown agent');
    },
  };
}

async function runMatch(llm, opts = {}) {
  const match = generateMatch({ seed: 42 });
  const analyst = createAnalyst(match.meta);
  const outputs = [];
  const crew = createCrew({ meta: match.meta, llm, languages: ['en', 'sw', 'ja'], onOutput: (o) => outputs.push(o), ...opts });
  for (const ev of match.events) for (const m of analyst.ingest(ev)) crew.submit(m, analyst.snapshot());
  await crew.drain();
  return { outputs, crew, match };
}

test('grounding check catches invented numbers and accepts real ones', () => {
  const evidence = { facts: { xg: 0.34, speedKmh: 112.6 }, clock: '67:15' };
  assert.deepEqual(ungroundedNumbers(['A 34% chance at 113 km/h in minute 67'], evidence), []);
  assert.deepEqual(ungroundedNumbers(['His 37th goal'], evidence), [37]);
  assert.deepEqual(ungroundedNumbers(['シュートは１１３キロ'], evidence), []); // full-width digits
});

test('every goal and the full-time recap get commentary in all languages', async () => {
  const { outputs, match } = await runMatch(fakeLLM(), { maxBacklog: 1000 });
  const goals = match.events.filter((e) => e.type === 'goal').length;
  assert.equal(outputs.filter((o) => o.type === 'goal').length, goals);
  for (const o of outputs) for (const l of ['en', 'sw', 'ja']) assert.ok(o.lines[l], `${o.type} missing ${l}`);
  const ft = outputs.find((o) => o.type === 'full_time');
  assert.ok(ft.recaps.en.recap && ft.recaps.ja.headline === 'ja recap');
});

test('Storyteller receives the Explainer insight (handoff) and recent lines (shared state)', async () => {
  const llm = fakeLLM();
  const { outputs } = await runMatch(llm, { maxConcurrent: 1, maxBacklog: 1000 });
  const stories = llm.calls.filter((c) => c.agent === STORYTELLER.name);
  assert.ok(stories.every((c) => typeof c.payload.insight === 'string' && c.payload.insight.length));
  assert.ok(stories.at(-1).payload.alreadyOnScreen.length > 0);
  assert.ok(outputs.every((o) => o.agents.every((a) => a.status === 'ok')));
});

test('a failing agent falls back to templates without stopping the crew', async () => {
  const { outputs, crew } = await runMatch(fakeLLM({ fail: new Set([STORYTELLER.name]) }), { maxBacklog: 1000 });
  assert.ok(outputs.length > 10);
  const goal = outputs.find((o) => o.type === 'goal');
  assert.match(goal.lines.sw, /GOLI/);
  assert.match(goal.lines.ja, /ゴール/);
  assert.ok(crew.stats().fallback > 0);
});

test('ungrounded numbers trigger a retry with feedback', async () => {
  const llm = fakeLLM({ invent: true });
  const { crew } = await runMatch(llm, { maxBacklog: 1000 });
  assert.ok(llm.calls.some((c) => c.payload.feedback?.includes('37')));
  assert.ok(crew.stats().retried > 0);
});

test('offline mode (no Azure) still produces commentary for every handled moment', async () => {
  const { outputs } = await runMatch(null, { maxBacklog: 1000 });
  assert.ok(outputs.length > 10);
  assert.ok(outputs.every((o) => o.agents.every((a) => a.status === 'fallback')));
});

test('when the crew falls behind, low-importance moments are dropped but goals never are', async () => {
  const { outputs, crew, match } = await runMatch(fakeLLM({ delayMs: 5 }), { maxConcurrent: 1, maxBacklog: 2 });
  const goals = match.events.filter((e) => e.type === 'goal').length;
  assert.equal(outputs.filter((o) => o.type === 'goal').length, goals);
  assert.ok(crew.stats().dropped > 0);
});
