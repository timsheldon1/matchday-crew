// The Crew: orchestrates the agents around a shared match state.
//
//   Analyst (code)  ->  Explainer (Foundry agent)  ->  Storyteller (Foundry agent)
//                                    \-> Recapper (Foundry agent) at half time and full time
//
// Responsibilities
// - Priority queue: the most important moments are handled first; low-value ones are dropped
//   when the crew falls behind live play (a broadcast cannot show stale commentary).
// - Handoffs: the Explainer's insight is passed to the Storyteller; every agent sees the shared
//   state (recent insights and lines already on screen) so it does not repeat itself.
// - Guardrails: JSON schema output, a grounding check on every number, one retry with feedback.
// - Recovery: on timeout, error or ungrounded output, the crew uses template text so the screen
//   never goes blank, and records exactly what happened for monitoring.
import { EXPLAINER, STORYTELLER, RECAP, LANGUAGE_NAMES } from './definitions.js';
import { ungroundedNumbers } from './grounding.js';
import { fallbackExplanation, fallbackLine, fallbackRecap } from './fallback.js';

const DEFAULTS = {
  languages: ['en'],
  persona: 'casual', // or 'analyst'
  minImportance: 0.4,
  maxConcurrent: 3,
  maxBacklog: 6,
  timeouts: { explainer: 9000, storyteller: 11000, recap: 30000 },
};

const ALWAYS_HANDLE = new Set(['goal', 'half_time', 'full_time', 'red_card', 'penalty_awarded']);

function compactMoment(m) {
  return {
    type: m.type,
    clock: m.clock,
    team: m.teamName,
    players: m.players.map((p) => p.name),
    score: m.score,
    facts: m.facts,
    analystHeadline: m.headline,
  };
}

function compactContext(snapshot) {
  if (!snapshot) return null;
  const t = (s) => ({
    name: s.name, shots: s.shots, onTarget: s.onTarget, xg: s.xg, possessionPct: s.possessionPct,
    passAccuracy: s.passAccuracy, bigChances: s.bigChances, corners: s.corners,
  });
  return {
    clock: snapshot.clock,
    score: snapshot.score,
    momentum: snapshot.momentum,
    rhythm: snapshot.rhythm,
    home: t(snapshot.teams.home),
    away: t(snapshot.teams.away),
  };
}

// Models sometimes prefix a line with the persona or language ("Analyst: ...", "SW: ...").
// Strip it so it is never shown on screen or read out by the voice.
const LABELS = [
  'analyst', 'analysis', 'casual', 'fan', 'commentator', 'commentary', 'storyteller', 'explainer',
  'insight', 'key insight', 'insights', 'takeaway', 'key takeaway', 'tactical', 'tactical angle', 'note', 'summary', 'why it matters', 'line',
  'mchambuzi', 'uchambuzi', 'shabiki', 'mtangazaji', 'ufahamu', 'maarifa', 'muhtasari',
  'アナリスト', 'ファン', '実況', '解説', '分析', '洞察', 'ポイント', '要点',
  'english', 'swahili', 'kiswahili', 'japanese', 'en', 'sw', 'ja',
];
const LABEL = new RegExp(`^\\s*[\\[(*]*(${LABELS.join('|')})[\\])*]*\\s*[:：\\-–—]\\s*`, 'i');
export function cleanLine(text) {
  let t = String(text ?? '').trim();
  for (let i = 0; i < 2 && LABEL.test(t); i++) t = t.replace(LABEL, '').trim();
  return t;
}

export function createCrew({ meta, llm, onOutput = () => {}, ...options }) {
  const cfg = { ...DEFAULTS, ...options, timeouts: { ...DEFAULTS.timeouts, ...options.timeouts } };
  const shared = { insights: [], lines: [], outputs: [] }; // shared state every agent can see
  const queue = [];
  let running = 0;
  const idleWaiters = [];
  const stats = { submitted: 0, handled: 0, dropped: 0, calls: 0, ok: 0, retried: 0, fallback: 0, latencyMs: [] };

  async function callWithGuard(agent, payload, evidence, timeoutMs, textsOf, validate = () => null) {
    const trace = { agent: agent.name, mode: llm?.mode ?? 'offline', status: 'ok', latencyMs: 0, reason: null };
    if (!llm) return { result: null, trace: { ...trace, status: 'fallback', reason: 'offline' } };
    let attemptPayload = payload;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const t0 = Date.now();
      stats.calls++;
      try {
        const result = await llm.run(agent, attemptPayload, { timeoutMs });
        trace.latencyMs += Date.now() - t0;
        const problem = validate(result) ?? (() => {
          const bad = ungroundedNumbers(textsOf(result), evidence);
          return bad.length ? `ungrounded numbers: ${bad.join(', ')}` : null;
        })();
        if (!problem) {
          if (attempt === 2) trace.status = 'retried';
          return { result, trace };
        }
        trace.reason = problem;
        attemptPayload = { ...payload, feedback: `Your previous answer was rejected (${problem}). Use only numbers from the input.` };
      } catch (err) {
        trace.latencyMs += Date.now() - t0;
        trace.reason = err.message.split('\n')[0];
        if (/timeout/.test(trace.reason)) break; // no time left for a retry in live play
      }
    }
    return { result: null, trace: { ...trace, status: 'fallback' } };
  }

  async function handleMoment(moment, snapshot) {
    const context = compactContext(snapshot);
    const cm = compactMoment(moment);
    const evidence = { moment: cm, context };

    // 1. Explainer
    const exp = await callWithGuard(
      EXPLAINER,
      { moment: cm, context, recentInsights: shared.insights.slice(-3) },
      evidence,
      cfg.timeouts.explainer,
      (r) => [r.why, r.tacticalAngle, ...(r.keyNumbers ?? [])],
    );
    const explanation = exp.result ?? fallbackExplanation(moment);

    // 2. Storyteller (handoff: receives the Explainer's insight)
    const langs = cfg.languages;
    const story = await callWithGuard(
      STORYTELLER,
      {
        moment: cm,
        whyItMatters: explanation.why, // not called 'insight': the model kept echoing that word as a label
        keyNumbers: explanation.keyNumbers,
        persona: cfg.persona,
        languages: langs.map((code) => ({ code, name: LANGUAGE_NAMES[code] ?? code })),
        alreadyOnScreen: shared.lines.slice(-4),
      },
      { ...evidence, keyNumbers: exp.result ? explanation.keyNumbers : [] },
      cfg.timeouts.storyteller,
      (r) => (r.lines ?? []).map((l) => l.text),
      (r) => {
        const got = new Set((r.lines ?? []).filter((l) => l.text?.trim()).map((l) => l.lang));
        const missing = langs.filter((l) => !got.has(l));
        return missing.length ? `missing languages: ${missing.join(', ')}` : null;
      },
    );
    const lines = {};
    for (const lang of langs) {
      const text = cleanLine(story.result?.lines.find((l) => l.lang === lang)?.text);
      lines[lang] = text || fallbackLine(moment, lang, meta);
    }
    return { explanation, lines, traces: [exp.trace, story.trace] };
  }

  async function handleRecap(moment, snapshot) {
    const isFull = moment.type === 'full_time';
    const s = snapshot;
    const payload = {
      stage: isFull ? 'full_time' : 'half_time',
      clubs: { home: meta.teams.home.name, away: meta.teams.away.name },
      score: s.score,
      stats: compactContext(s),
      topPlayers: s.topPlayers.map((p) => ({ name: p.name, team: s.teams[p.team].name, rating: p.rating, goals: p.goals, assists: p.assists, xg: p.xg })),
      keyMoments: shared.outputs
        .filter((o) => o.importance >= 0.5)
        .slice(-15)
        .map((o) => ({ clock: o.clock, type: o.type, what: o.headline, why: o.explanation.why })),
      languages: cfg.languages.map((code) => ({ code, name: LANGUAGE_NAMES[code] ?? code })),
    };
    const rec = await callWithGuard(
      RECAP, payload, payload, cfg.timeouts.recap,
      (r) => (r.recaps ?? []).flatMap((x) => [x.headline, x.recap]),
      (r) => {
        const got = new Set((r.recaps ?? []).map((x) => x.lang));
        const missing = cfg.languages.filter((l) => !got.has(l));
        return missing.length ? `missing languages: ${missing.join(', ')}` : null;
      },
    );
    const recaps = {};
    for (const lang of cfg.languages) {
      recaps[lang] = rec.result?.recaps.find((x) => x.lang === lang) ?? fallbackRecap(s, lang, meta, isFull);
    }
    const lines = Object.fromEntries(Object.entries(recaps).map(([l, r]) => [l, r.headline]));
    return { explanation: fallbackExplanation(moment), lines, recaps, traces: [rec.trace] };
  }

  async function runJob(job) {
    running++;
    const started = Date.now();
    try {
      const { moment, snapshot } = job;
      const isRecap = moment.type === 'half_time' || moment.type === 'full_time';
      const r = isRecap ? await handleRecap(moment, snapshot) : await handleMoment(moment, snapshot);
      for (const t of r.traces) {
        if (t.status === 'fallback') stats.fallback++;
        else { stats.ok++; if (t.status === 'retried') stats.retried++; stats.latencyMs.push(t.latencyMs); }
      }
      const out = {
        momentId: moment.id,
        type: moment.type,
        clock: moment.clock,
        elapsed: moment.elapsed,
        importance: moment.importance,
        team: moment.team,
        teamName: moment.teamName,
        players: moment.players,
        score: moment.score,
        headline: moment.headline,
        explanation: r.explanation,
        lines: r.lines,
        recaps: r.recaps ?? null,
        persona: cfg.persona,
        agents: r.traces,
        lagMs: Date.now() - job.queuedAt,
        processingMs: Date.now() - started,
      };
      if (!isRecap) {
        shared.insights.push(`${moment.clock} ${r.explanation.why}`);
        shared.lines.push(r.lines.en ?? Object.values(r.lines)[0]);
      }
      shared.outputs.push(out);
      stats.handled++;
      onOutput(out);
      job.resolve(out);
    } catch (err) {
      job.reject(err);
    } finally {
      running--;
      pump();
    }
  }

  function pump() {
    while (running < cfg.maxConcurrent && queue.length) {
      queue.sort((a, b) => b.moment.importance - a.moment.importance || a.moment.elapsed - b.moment.elapsed);
      runJob(queue.shift());
    }
    if (!running && !queue.length) while (idleWaiters.length) idleWaiters.shift()();
  }

  return {
    submit(moment, snapshot) {
      if (moment.importance < cfg.minImportance && !ALWAYS_HANDLE.has(moment.type)) return null;
      stats.submitted++;
      return new Promise((resolve, reject) => {
        queue.push({ moment, snapshot, queuedAt: Date.now(), resolve, reject });
        // Too far behind live play: drop the least important waiting moment (never goals or recaps).
        while (queue.length > cfg.maxBacklog) {
          const droppable = queue
            .filter((j) => !ALWAYS_HANDLE.has(j.moment.type))
            .sort((a, b) => a.moment.importance - b.moment.importance)[0];
          if (!droppable) break;
          queue.splice(queue.indexOf(droppable), 1);
          stats.dropped++;
          droppable.resolve(null);
        }
        pump();
      });
    },
    drain() {
      return new Promise((r) => { if (!running && !queue.length) r(); else idleWaiters.push(r); });
    },
    stats() {
      const l = [...stats.latencyMs].sort((a, b) => a - b);
      return {
        ...stats,
        latencyMs: undefined,
        medianLatencyMs: l.length ? l[Math.floor(l.length / 2)] : null,
        p90LatencyMs: l.length ? l[Math.floor(l.length * 0.9)] : null,
        mode: llm?.mode ?? 'offline',
      };
    },
    shared,
  };
}
