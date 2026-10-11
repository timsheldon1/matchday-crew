#!/usr/bin/env node
// Usage:
//   node src/cli.js generate  --seed 42 [--home NNS --away KLS] [--out data/match-42.json]
//   node src/cli.js stats     --seed 42
//   node src/cli.js stream    --seed 42 [--speed 30]      (NDJSON to stdout)
//   node src/cli.js calibrate [--n 200]                    (averages across many matches)
//   node src/cli.js analyse   --seed 42 [--min 0.4] [--json]   (key moments found by the Analyst)
//   node src/cli.js accuracy  [--n 60]                     (Analyst momentum vs hidden ground truth)
//   node src/cli.js clubs
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { generateMatch } from './generator.js';
import { summarize, printSummary } from './stats.js';
import { replay } from './stream.js';
import { CLUBS } from './teams.js';
import { analyseMatch, createAnalyst } from './analyst.js';

function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  const opts = {};
  for (let i = 0; i < rest.length; i++) {
    if (rest[i].startsWith('--')) {
      const key = rest[i].slice(2);
      const val = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : true;
      opts[key] = val;
    }
  }
  return { cmd, opts };
}

const { cmd, opts } = parseArgs(process.argv.slice(2));
const seed = opts.seed ?? 1;
const matchOpts = { seed, home: opts.home ?? 'NNS', away: opts.away ?? 'KLS' };

switch (cmd) {
  case 'generate': {
    const match = generateMatch(matchOpts);
    const out = opts.out ?? `data/match-${match.meta.matchId}.json`;
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(match, null, opts.compact ? 0 : 2));
    console.log(`Wrote ${match.events.length} events to ${out}`);
    console.log(printSummary(summarize(match)));
    break;
  }
  case 'stats': {
    console.log(printSummary(summarize(generateMatch(matchOpts))));
    break;
  }
  case 'stream': {
    const match = generateMatch(matchOpts);
    for await (const ev of replay(match.events, { speed: Number(opts.speed ?? 30) })) {
      process.stdout.write(`${JSON.stringify(ev)}\n`);
    }
    break;
  }
  case 'calibrate': {
    const n = Number(opts.n ?? 200);
    const keys = ['goals', 'xg', 'shots', 'onTarget', 'passes', 'passAccuracy', 'corners', 'fouls', 'yellow', 'tackles', 'sprints'];
    const acc = Object.fromEntries(keys.map((k) => [k, 0]));
    let events = 0;
    const clubIds = Object.keys(CLUBS);
    for (let i = 0; i < n; i++) {
      const home = clubIds[i % clubIds.length];
      const away = clubIds[(i + 1 + Math.floor(i / clubIds.length)) % clubIds.length];
      const s = summarize(generateMatch({ seed: `cal-${i}`, home, away: away === home ? clubIds[(clubIds.indexOf(home) + 1) % clubIds.length] : away }));
      events += s.eventCount;
      for (const k of keys) acc[k] += (s.stats.home[k] + s.stats.away[k]) / 2;
    }
    console.log(`Averages per team per match over ${n} matches (events per match: ${Math.round(events / n)})`);
    for (const k of keys) console.log(`  ${k.padEnd(14)} ${(acc[k] / n).toFixed(2)}`);
    console.log('\nReal-world reference (top-flight, per team): goals ~1.4, shots ~12-13, on target ~4-5, passes ~450, accuracy ~80-85%, corners ~5, fouls ~10-11, yellows ~1.8');
    break;
  }
  case 'analyse':
  case 'analyze': {
    const match = generateMatch(matchOpts);
    const { moments, snapshot } = analyseMatch(match);
    const min = Number(opts.min ?? 0.4);
    const shown = moments.filter((m) => m.importance >= min);
    if (opts.json) {
      console.log(JSON.stringify({ moments: shown, snapshot }, null, 2));
      break;
    }
    for (const m of shown) console.log(`${m.clock.padEnd(13)} ${m.type.padEnd(16)} ${m.headline}`);
    const s = snapshot;
    console.log(`\nMomentum now: ${s.momentum.state} (${s.momentum.index}), rhythm: ${s.rhythm}`);
    console.log('Top players:');
    for (const p of s.topPlayers) console.log(`  ${String(p.rating).padEnd(4)} ${p.name} (${s.teams[p.team].name}, ${p.position})`);
    break;
  }
  case 'accuracy': {
    // How well does the Analyst's momentum read match the generator's hidden momentum?
    const n = Number(opts.n ?? 60);
    const xs = []; const ys = [];
    let swings = 0; let correct = 0;
    for (let i = 0; i < n; i++) {
      const match = generateMatch({ seed: `acc-${i}`, debug: true });
      const analyst = createAnalyst(match.meta);
      for (const ev of match.events) {
        for (const m of analyst.ingest(ev)) {
          if (m.type !== 'momentum_swing') continue;
          swings++;
          if ((m.team === 'home') === (ev._truth.momentum > 0)) correct++;
        }
        if (ev.seq % 10 === 0) { xs.push(analyst.snapshot().momentum.index); ys.push(ev._truth.momentum); }
      }
    }
    const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
    const mx = mean(xs); const my = mean(ys);
    let sxy = 0; let sxx = 0; let syy = 0;
    for (let i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
    console.log(`Matches: ${n}`);
    console.log(`Correlation between Analyst momentum and hidden true momentum: r = ${(sxy / Math.sqrt(sxx * syy)).toFixed(2)}`);
    console.log(`Momentum swing calls pointing at the truly dominant team: ${((correct / swings) * 100).toFixed(1)}% of ${swings}`);
    break;
  }
  case 'clubs': {
    for (const c of Object.values(CLUBS)) console.log(`${c.id}  ${c.name}`);
    break;
  }
  default:
    console.log('Commands: generate | stats | stream | analyse | accuracy | calibrate | clubs   (see comments at top of src/cli.js)');
}
