#!/usr/bin/env node
// Run the AI crew from the terminal.
//
//   node src/crew-cli.js check                         one test call to Foundry (connection + auth)
//   node src/crew-cli.js deploy                        register the agents in your Foundry project
//   node src/crew-cli.js live --seed 42 --speed 40 --langs en,sw,ja --persona casual
//   node src/crew-cli.js live --seed 42 --offline      same, without Azure (template fallbacks only)
import { generateMatch } from './generator.js';
import { createAnalyst, analyseMatch } from './analyst.js';
import { replay } from './stream.js';
import { createCrew } from './agents/crew.js';
import { createFoundryLLM, loadEnv } from './agents/foundry.js';
import { EXPLAINER } from './agents/definitions.js';

const args = process.argv.slice(2);
const cmd = args[0];
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return def;
  const v = args[i + 1];
  return v && !v.startsWith('--') ? v : true;
};

const c = { dim: '\x1b[2m', bold: '\x1b[1m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m', red: '\x1b[31m', reset: '\x1b[0m' };

async function getLLM() {
  if (opt('offline', false)) return null;
  return createFoundryLLM(loadEnv());
}

function printOutput(o) {
  const tag = o.agents.some((a) => a.status === 'fallback') ? `${c.yellow}[fallback]${c.reset}` : `${c.green}[ai]${c.reset}`;
  console.log(`\n${c.bold}${o.clock}${c.reset}  ${c.cyan}${o.type}${c.reset}  ${tag}  ${c.dim}lag ${(o.lagMs / 1000).toFixed(1)}s${c.reset}`);
  if (o.recaps) {
    for (const [lang, r] of Object.entries(o.recaps)) {
      console.log(`  ${c.bold}${lang.toUpperCase()}${c.reset} ${r.headline}`);
      console.log(`     ${r.recap}`);
      console.log(`     ${c.dim}Player of the match: ${r.playerOfTheMatch}${c.reset}`);
    }
  } else {
    for (const [lang, text] of Object.entries(o.lines)) console.log(`  ${c.bold}${lang.toUpperCase()}${c.reset} ${text}`);
    console.log(`  ${c.dim}why: ${o.explanation.why}${c.reset}`);
  }
  for (const t of o.agents) {
    if (t.status !== 'ok') console.log(`  ${c.dim}${t.agent}: ${t.status}${t.reason ? ` (${t.reason})` : ''}${c.reset}`);
  }
}

async function main() {
  switch (cmd) {
    case 'check': {
      const env = loadEnv();
      console.log(`Endpoint:   ${env.endpoint ?? '(not set)'}`);
      console.log(`Deployment: ${env.deployment}`);
      const llm = await createFoundryLLM(env);
      const match = generateMatch({ seed: 42 });
      const { moments, snapshot } = analyseMatch(match);
      const goal = moments.find((m) => m.type === 'goal') ?? moments[0];
      const t0 = Date.now();
      const out = await llm.run(EXPLAINER, { moment: { type: goal.type, clock: goal.clock, team: goal.teamName, facts: goal.facts, analystHeadline: goal.headline }, context: { score: snapshot.score } }, { timeoutMs: 30000 });
      console.log(`\n${c.green}Connected.${c.reset} Mode: ${llm.mode}, ${Date.now() - t0} ms\n`);
      console.log(JSON.stringify(out, null, 2));
      if (llm.mode === 'direct') console.log(`\n${c.yellow}Tip:${c.reset} run "node src/crew-cli.js deploy" to register the agents in Foundry.`);
      break;
    }
    case 'deploy': {
      const llm = await createFoundryLLM(loadEnv());
      const deployed = await llm.deployAgents();
      for (const a of deployed) console.log(`${c.green}Deployed${c.reset} ${a.name} (version ${a.version})`);
      console.log('\nOpen your project in ai.azure.com > Build > Agents to see them.');
      break;
    }
    case 'live': {
      const seed = opt('seed', 42);
      const speed = Number(opt('speed', 40));
      const languages = String(opt('langs', 'en,sw,ja')).split(',');
      const persona = opt('persona', 'casual');
      const llm = await getLLM();
      const match = generateMatch({ seed, home: opt('home', 'NNS'), away: opt('away', 'KLS') });
      const analyst = createAnalyst(match.meta);
      const crew = createCrew({ meta: match.meta, llm, languages, persona, onOutput: printOutput });
      console.log(`${c.bold}${match.meta.teams.home.name} vs ${match.meta.teams.away.name}${c.reset}  seed ${seed}, ${speed}x speed, ${languages.join('/')}, ${persona}, ${llm ? `Foundry (${llm.deployment})` : 'offline'}`);
      const pending = [];
      for await (const ev of replay(match.events, { speed })) {
        for (const m of analyst.ingest(ev)) {
          const p = crew.submit(m, analyst.snapshot());
          if (p) pending.push(p);
        }
      }
      await crew.drain();
      await Promise.allSettled(pending);
      const s = crew.stats();
      console.log(`\n${c.bold}Crew report${c.reset}: ${s.handled} moments narrated, ${s.dropped} dropped to stay live, ` +
        `${s.ok} agent calls ok (${s.retried} after retry), ${s.fallback} fell back to templates, ` +
        `median latency ${s.medianLatencyMs ?? '-'} ms, p90 ${s.p90LatencyMs ?? '-'} ms, mode ${s.mode}.`);
      break;
    }
    default:
      console.log('Commands: check | deploy | live   (see the top of src/crew-cli.js)');
  }
}

main().catch((err) => {
  console.error(`${c.red}Error:${c.reset} ${err.message}`);
  process.exitCode = 1;
});
