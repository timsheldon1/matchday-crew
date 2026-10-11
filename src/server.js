#!/usr/bin/env node
// Tiny dependency-free HTTP server the React overlay and the agents can consume.
//
//   GET /health
//   GET /clubs
//   GET /matches/:seed?home=NNS&away=KLS            full match JSON (meta + events)
//   GET /matches/:seed/stream?speed=30&from=0       live replay as Server-Sent Events
//        events: meta, match_event, moment (from the Analyst), stats (snapshot every 15 events), done
//   GET /matches/:seed/analysis                     all key moments + final stats
//   Stream options: &crew=1&langs=en,sw,ja&persona=casual  adds AI `commentary` events from the agent crew
//   (uses Microsoft Foundry when FOUNDRY_PROJECT_ENDPOINT is set in .env, otherwise template fallbacks)
//
// Run: node src/server.js [--port 4000]
import { createServer } from 'node:http';
import { generateMatch } from './generator.js';
import { replay } from './stream.js';
import { CLUBS } from './teams.js';
import { createAnalyst, analyseMatch } from './analyst.js';
import { createCrew } from './agents/crew.js';
import { createFoundryLLM, loadEnv } from './agents/foundry.js';

// Connect to Foundry once at start-up. If it is not configured the crew runs on templates.
let llm = null;
const env = loadEnv();
if (env.endpoint) {
  try { llm = await createFoundryLLM(env); console.log(`Crew connected to Foundry (${env.deployment})`); }
  catch (err) { console.warn(`Crew running offline: ${err.message}`); }
} else {
  console.log('Crew running offline (no FOUNDRY_PROJECT_ENDPOINT in .env)');
}

const portArg = process.argv.indexOf('--port');
const PORT = Number(portArg > -1 ? process.argv[portArg + 1] : process.env.PORT ?? 4000);
const cache = new Map();

function getMatch(seed, home, away) {
  const key = `${seed}:${home}:${away}`;
  if (!cache.has(key)) cache.set(key, generateMatch({ seed, home, away }));
  return cache.get(key);
}

function send(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const parts = url.pathname.split('/').filter(Boolean);

  try {
    if (url.pathname === '/health') return send(res, 200, { ok: true });
    if (url.pathname === '/clubs') return send(res, 200, Object.values(CLUBS));

    if (parts[0] === 'matches' && parts[1]) {
      const home = url.searchParams.get('home') ?? 'NNS';
      const away = url.searchParams.get('away') ?? 'KLS';
      const match = getMatch(parts[1], home, away);

      if (!parts[2]) return send(res, 200, match);
      if (parts[2] === 'analysis') return send(res, 200, analyseMatch(match));

      if (parts[2] === 'stream') {
        const speed = Number(url.searchParams.get('speed') ?? 30);
        const from = Number(url.searchParams.get('from') ?? req.headers['last-event-id'] ?? 0);
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'Access-Control-Allow-Origin': '*',
        });
        res.write(`event: meta\ndata: ${JSON.stringify(match.meta)}\n\n`);
        const ac = new AbortController();
        req.on('close', () => ac.abort());
        // The Analyst replays silently up to the resume point so its state is correct.
        const analyst = createAnalyst(match.meta);
        for (const ev of match.events) { if (ev.seq > from) break; analyst.ingest(ev); }
        const crew = url.searchParams.get('crew') === '1'
          ? createCrew({
            meta: match.meta,
            llm,
            languages: (url.searchParams.get('langs') ?? 'en').split(','),
            persona: url.searchParams.get('persona') ?? 'casual',
            onOutput: (o) => { if (!ac.signal.aborted) res.write(`event: commentary\ndata: ${JSON.stringify(o)}\n\n`); },
          })
          : null;
        for await (const ev of replay(match.events, { speed, fromSeq: from, signal: ac.signal })) {
          // id lets a client reconnect and resume where it left off (Last-Event-ID)
          res.write(`id: ${ev.seq}\nevent: match_event\ndata: ${JSON.stringify(ev)}\n\n`);
          for (const m of analyst.ingest(ev)) {
            res.write(`event: moment\ndata: ${JSON.stringify(m)}\n\n`);
            crew?.submit(m, analyst.snapshot());
          }
          if (ev.seq % 15 === 0) {
            const { timeline, ...live } = analyst.snapshot();
            res.write(`event: stats\ndata: ${JSON.stringify(live)}\n\n`);
          }
        }
        if (crew && !ac.signal.aborted) {
          await crew.drain();
          res.write(`event: crew_report\ndata: ${JSON.stringify(crew.stats())}\n\n`);
        }
        if (!ac.signal.aborted) res.end('event: done\ndata: {}\n\n');
        return;
      }
    }
    send(res, 404, { error: 'Not found' });
  } catch (err) {
    send(res, 400, { error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`Match server on http://localhost:${PORT}`);
  console.log(`Try: curl -N "http://localhost:${PORT}/matches/42/stream?speed=60"`);
});
