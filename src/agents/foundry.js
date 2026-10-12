// Connection to Microsoft Foundry.
//
// Two ways to call a model, tried in this order:
//   1. "agent" mode: call the registered Foundry prompt agent by name (agent_reference).
//   2. "direct" mode: call the model deployment with the same instructions and JSON schema.
// If both fail, the crew falls back to the Analyst's template text (see crew.js).
//
// Auth is Microsoft Entra ID through DefaultAzureCredential: `az login` locally,
// managed identity when deployed to Azure. No API keys in code or config.
import { existsSync } from 'node:fs';
import { ALL_AGENTS } from './definitions.js';

export function loadEnv(path = '.env') {
  if (existsSync(path) && typeof process.loadEnvFile === 'function') process.loadEnvFile(path);
  return {
    endpoint: process.env.FOUNDRY_PROJECT_ENDPOINT,
    deployment: process.env.FOUNDRY_MODEL_DEPLOYMENT ?? 'matchday-mini',
    mode: process.env.MATCHDAY_AGENT_MODE ?? 'agent', // 'agent' or 'direct'
  };
}

function explainAuthError(err) {
  const status = err?.status ?? err?.statusCode;
  if (status === 401 || status === 403) {
    return `${err.message}\n\nYour account needs the "Azure AI User" role on the Foundry project. ` +
      'See README section "Azure setup" for the one-line az command that grants it.';
  }
  if (/CredentialUnavailable|az login|AzureCliCredential/i.test(err?.message ?? '')) {
    return `${err.message}\n\nRun "az login --tenant <your tenant id>" first.`;
  }
  return err?.message ?? String(err);
}

export async function createFoundryLLM({ endpoint, deployment, mode = 'agent', credential } = loadEnv()) {
  if (!endpoint) throw new Error('FOUNDRY_PROJECT_ENDPOINT is not set. Copy .env.example to .env and fill it in.');
  // Imported lazily so the generator, Analyst and tests work without the Azure packages.
  const { AIProjectClient } = await import('@azure/ai-projects');
  const { DefaultAzureCredential } = await import('@azure/identity');
  const project = new AIProjectClient(endpoint, credential ?? new DefaultAzureCredential());
  const openai = project.getOpenAIClient();
  // Agent mode is tracked per agent, so one agent having trouble does not switch off the others.
  // After 3 failures in a row an agent uses direct calls until the server restarts or agents are redeployed.
  const MAX_AGENT_FAILURES = 3;
  let agentModeWanted = mode === 'agent';
  const agentFailures = new Map();
  const agentVersions = new Map(); // name -> Promise<version string>
  const usesAgent = (agent) => agentModeWanted && (agentFailures.get(agent.name) ?? 0) < MAX_AGENT_FAILURES;

  const textFormat = (agent) => ({
    format: { type: 'json_schema', name: agent.name.replace(/-/g, '_'), schema: agent.schema, strict: true },
  });

  // The agent reference needs an explicit version: without one Foundry answered
  // "Agent matchday-explainer with version  not found". We look up the latest version once and cache it.
  function agentVersion(agent) {
    if (!agentVersions.has(agent.name)) {
      const p = project.agents.get(agent.name).then((a) => {
        const v = a?.versions?.latest?.version;
        if (!v) throw Object.assign(new Error(`agent ${agent.name} has no published version`), { status: 404 });
        return String(v);
      });
      p.catch(() => agentVersions.delete(agent.name)); // look it up again next time
      agentVersions.set(agent.name, p);
    }
    return agentVersions.get(agent.name);
  }

  // Foundry renamed the request field: older services read "agent", current ones reject it with
  // "The 'agent' property is deprecated. Use 'agent_reference' instead." We send the new name and
  // switch back once only if a service asks for the old one.
  let refField = 'agent_reference';
  async function callAgent(agent, input, signal) {
    const version = await agentVersion(agent);
    const ref = { type: 'agent_reference', name: agent.name, version };
    try {
      const res = await openai.responses.create({ input }, { body: { [refField]: ref }, signal });
      return res.output_text;
    } catch (err) {
      const msg = err?.error?.message ?? err?.message ?? '';
      const other = refField === 'agent_reference' ? 'agent' : 'agent_reference';
      if ((err?.status === 400) && new RegExp(`Use '${other}'|unrecognized.*${refField}|unknown.*${refField}`, 'i').test(msg)) {
        refField = other;
        const res = await openai.responses.create({ input }, { body: { [refField]: ref }, signal });
        return res.output_text;
      }
      throw err;
    }
  }

  function describeError(err) {
    const status = err?.status ?? err?.statusCode ?? '';
    const code = err?.code ?? err?.error?.code ?? '';
    const msg = (err?.error?.message ?? err?.message ?? String(err)).split('\n')[0].slice(0, 300);
    return [status, code, msg].filter(Boolean).join(' ');
  }

  async function callDirect(agent, input, signal) {
    const res = await openai.responses.create(
      {
        model: deployment,
        instructions: agent.instructions,
        input,
        text: textFormat(agent),
        reasoning: { effort: 'minimal' },
      },
      { signal },
    );
    return res.output_text;
  }

  return {
    name: 'foundry',

    // One tiny request at start-up so the first real moment does not pay for sign-in,
    // token fetch and connection setup (that took about 10 s on the first call).
    async warmup() {
      const t0 = Date.now();
      await openai.responses.create({ model: deployment, input: 'ok', max_output_tokens: 16, reasoning: { effort: 'minimal' } });
      return Date.now() - t0;
    },
    deployment,
    get mode() { return agentModeWanted && [...agentFailures.values()].every((n) => n < MAX_AGENT_FAILURES) ? 'agent' : 'direct'; },
    modeFor(agent) { return usesAgent(agent) ? 'agent' : 'direct'; },

    // Returns parsed JSON from the agent. Throws on failure; the crew decides what to do.
    async run(agent, payload, { timeoutMs = 12000, onMode } = {}) {
      const input = typeof payload === 'string' ? payload : JSON.stringify(payload);
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), timeoutMs);
      try {
        let text;
        if (usesAgent(agent)) {
          try {
            text = await callAgent(agent, input, ac.signal);
            agentFailures.set(agent.name, 0);
            onMode?.('agent');
          } catch (err) {
            const status = err?.status ?? err?.statusCode;
            // Timeouts, auth errors, rate limits and outages are handled by the crew, not by switching path.
            if (ac.signal.aborted || (status !== 404 && status !== 400)) throw err;
            const n = (agentFailures.get(agent.name) ?? 0) + 1;
            agentFailures.set(agent.name, n);
            const off = n >= MAX_AGENT_FAILURES ? ' Agent mode is now off for this agent.' : '';
            console.warn(`[foundry] ${agent.name} agent call failed (${describeError(err)}), failure ${n}. Using a direct model call.${off}`);
            text = await callDirect(agent, input, ac.signal);
            onMode?.('direct');
          }
        } else {
          text = await callDirect(agent, input, ac.signal);
          onMode?.('direct');
        }
        return JSON.parse(text);
      } catch (err) {
        if (ac.signal.aborted) throw new Error(`timeout after ${timeoutMs} ms`);
        throw new Error(explainAuthError(err));
      } finally {
        clearTimeout(timer);
      }
    },

    // Registers (or adds a new version of) each prompt agent in the Foundry project.
    async deployAgents() {
      const out = [];
      for (const agent of ALL_AGENTS) {
        const v = await project.agents.createVersion(
          agent.name,
          {
            kind: 'prompt',
            model: deployment,
            instructions: agent.instructions,
            reasoning: { effort: 'minimal' },
            text: textFormat(agent),
          },
          { description: agent.description, metadata: { project: 'matchday-crew' } },
        );
        out.push({ name: v.name ?? agent.name, version: v.version });
      }
      agentModeWanted = true;
      agentFailures.clear();
      agentVersions.clear();
      for (const a of out) agentVersions.set(a.name, Promise.resolve(String(a.version)));
      return out;
    },
  };
}
