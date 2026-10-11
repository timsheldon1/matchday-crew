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
  let agentModeWorks = mode === 'agent';

  const textFormat = (agent) => ({
    format: { type: 'json_schema', name: agent.name.replace(/-/g, '_'), schema: agent.schema, strict: true },
  });

  async function callAgent(agent, input, signal) {
    const res = await openai.responses.create(
      { input },
      { body: { agent: { name: agent.name, type: 'agent_reference' } }, signal },
    );
    return res.output_text;
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
    deployment,
    get mode() { return agentModeWorks ? 'agent' : 'direct'; },

    // Returns parsed JSON from the agent. Throws on failure; the crew decides what to do.
    async run(agent, payload, { timeoutMs = 12000 } = {}) {
      const input = typeof payload === 'string' ? payload : JSON.stringify(payload);
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), timeoutMs);
      try {
        let text;
        if (agentModeWorks) {
          try {
            text = await callAgent(agent, input, ac.signal);
          } catch (err) {
            const status = err?.status ?? err?.statusCode;
            // Only a missing or rejected agent switches mode. Rate limits and outages are handled by the crew.
            if (ac.signal.aborted || (status !== 404 && status !== 400)) throw err;
            agentModeWorks = false;
            console.warn(`[foundry] agent mode failed (${err.status ?? ''} ${err.message}). Using direct model calls.`);
            text = await callDirect(agent, input, ac.signal);
          }
        } else {
          text = await callDirect(agent, input, ac.signal);
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
      agentModeWorks = true;
      return out;
    },
  };
}
