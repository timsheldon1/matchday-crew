# Matchday Crew

Explainable, personalised match intelligence from a team of AI agents.
Built for the Microsoft + Premier League *Inside the Game* Developer Hackathon (2026).

> Status: generator, Analyst and the AI crew (Explainer, Storyteller, Recapper on Microsoft Foundry) are working. The React overlay and Personalizer come next.

## Pipeline

```
Data (synthetic events) -> Analyst (stats, key moments) -> Explainer (why it matters)
      -> Storyteller (commentary + recaps, EN / SW / JA) -> Personalizer (fan, analyst, player focus)
      -> React overlay
```

## Synthetic match generator

The generator and Analyst have zero dependencies. Needs Node 22 or newer (required by the Foundry SDK).

```bash
npm test                                          # 36 tests: generator, Analyst and crew orchestration
node src/cli.js generate --seed 42                # writes data/match-NNS-KLS-42.json and prints a box score
node src/cli.js stats --seed 7 --home RVU --away HLA
node src/cli.js stream --seed 42 --speed 30       # live NDJSON on stdout, 90 minutes in ~3 minutes
node src/cli.js calibrate --n 300                 # realism check across many matches
node src/cli.js analyse --seed 42                 # key moments the Analyst finds, plus top-rated players
node src/cli.js accuracy --n 100                  # Analyst momentum vs the generator's hidden truth
node src/server.js                                # HTTP + Server-Sent Events on port 4000
```

Server endpoints:

- `GET /matches/:seed` returns the full match (meta and events)
- `GET /matches/:seed/stream?speed=30` streams live as SSE: `match_event`, `moment` (from the Analyst) and `stats` (live snapshot). Supports `Last-Event-ID` to resume
- `GET /matches/:seed/analysis` returns every key moment plus the final stats
- `GET /clubs`, `GET /health`

### What it simulates

- Four fictional clubs with their own style (pressing, directness, quality) and generated squads
- Passes with distance, progression, difficulty and pressure; carries with sprint speeds; pressing, tackles, interceptions
- Shots with an expected-goals (xG) model, shot speed, saves, blocks, corners, free kicks, penalties
- Fouls, yellow and red cards, three substitutions per team, stoppage time
- Hidden momentum swings that change how teams play, for the Analyst to detect

Every match is fully repeatable from its seed, which keeps demos and tests stable.

### Realism check (300 matches, per team per match)

| Metric | Generator | Real top-flight (approx.) |
|---|---|---|
| Goals | 1.6 | 1.4 |
| Shots | 12.1 | 12 to 13 |
| On target | 4.8 | 4 to 5 |
| Pass accuracy | 79% | 80 to 85% |
| Corners | 5.1 | 5 |
| Fouls | 12.3 | 10 to 11 |
| Yellow cards | 1.6 | 1.8 |

Event format: see [SCHEMA.md](SCHEMA.md).

## Analyst

`src/analyst.js` reads events one at a time, as they happen, and keeps live team and player stats. It also flags key moments. It is plain code with no AI calls, so it is instant and its numbers are always right. The AI agents build on its output instead of guessing at stats.

Each moment includes the type, importance (0 to 1), the players involved, the evidence (`facts` and `eventIds`) and a template `headline`. The headline is the fallback the overlay shows if an AI agent is slow or fails.

| Moment | What triggers it |
|---|---|
| `goal` | Every goal, with context: opener, equaliser, go-ahead, against the run of play, brace |
| `big_chance` | Missed or saved shot worth 0.30 xG or more |
| `momentum_swing` | One team's threat over the last 5 minutes clearly outweighs the other's |
| `rhythm_shift` | Control vs chaos: possession changing hands much less or much more than normal |
| `pressing_spell` | Unusually heavy pressing that is winning the ball back high up the pitch |
| `xg_vs_score` | A team is creating far more but not winning |
| `penalty_awarded`, `red_card`, `yellow_card`, `substitution` | As named |
| `speed_alert`, `rocket_shot`, `quality_pass` | Overlay triggers: sprint 33 km/h or more, shot 110 km/h or more, hard progressive pass |
| `half_time`, `full_time` | Full stats snapshot for recaps |

### How we know the momentum read works

The generator simulates a hidden momentum value that the Analyst never sees. Over 100 matches:

- The Analyst's momentum index correlates with the hidden truth at **r = 0.48**
- **72%** of its momentum swing calls point at the team that really was on top

Run `node src/cli.js accuracy --n 100` to reproduce.

## AI crew (Microsoft Foundry)

Three prompt agents run on a `gpt-5-mini` deployment in Microsoft Foundry, registered and versioned in the project so they show up in the Foundry portal:

| Agent | Input | Output |
|---|---|---|
| `matchday-explainer` | One key moment from the Analyst plus live context | Why it matters, a tactical angle, the key numbers, a confidence level |
| `matchday-storyteller` | The moment, the Explainer's insight, persona, languages, lines already on screen | One broadcast line per language (English, Swahili, Japanese) |
| `matchday-recapper` | Half-time or full-time stats, top players, the key moments and their explanations | A short recap and player of the match in each language |

`src/agents/crew.js` orchestrates them around a shared match state:

- **Handoffs:** Analyst (code) to Explainer to Storyteller, with the Recapper at half time and full time
- **Shared state:** every agent sees recent insights and the lines already on screen, so commentary does not repeat
- **Live priorities:** a priority queue handles goals and big moments first and drops low-value moments when the crew falls behind live play (goals and recaps are never dropped)
- **Guardrails:** strict JSON schema output, plus a grounding check that rejects any number not present in the Analyst's evidence. A rejected answer gets one retry with feedback
- **Recovery:** on a timeout, an error or an ungrounded answer, the crew shows template text in all three languages so the screen never goes blank, and records what happened in a crew report (calls ok, retries, fallbacks, latency)
- **Two call paths:** registered Foundry agents first; if they are not deployed, direct model calls with the same instructions

```bash
npm run crew:offline       # full match with template fallbacks, no Azure needed
npm run crew:check         # one test call to Foundry
npm run crew:deploy        # register the three agents in your Foundry project
npm run crew:live          # full match with live AI commentary in English, Swahili and Japanese
```

The server can stream the commentary too: `GET /matches/42/stream?speed=30&crew=1&langs=en,sw,ja&persona=analyst` adds `commentary` events and a final `crew_report`.

### Azure setup

1. Create a Foundry project at ai.azure.com and deploy `gpt-5-mini` (we named the deployment `matchday-mini`).
2. Copy `.env.example` to `.env` and set `FOUNDRY_PROJECT_ENDPOINT` and `FOUNDRY_MODEL_DEPLOYMENT`.
3. Sign in with the Azure CLI. Auth is Microsoft Entra ID, so there are no API keys in the code:
   ```bash
   az login --tenant <your-tenant-id> --use-device-code
   ```
4. If `crew:check` returns 401 or 403, give yourself the **Azure AI User** role on the Foundry resource:
   ```bash
   az role assignment create --role "Azure AI User" --assignee-object-id <your-user-object-id> --assignee-principal-type User --scope <foundry-resource-id>
   ```
   Your object id: `az ad signed-in-user show --query id -o tsv`. The resource id is on the resource's Overview page under JSON view.

## Data and IP

All clubs, players and matches are fictional and generated. No real match footage, league data or club marks are used.
