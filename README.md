# Matchday Crew

Explainable, personalised match intelligence from a team of AI agents.
Built for the Microsoft + Premier League *Inside the Game* Developer Hackathon (2026).

> Status: the **synthetic match generator** and the **Analyst** are done. The AI agents (Explainer, Storyteller, Personalizer) and the overlay UI come next.

## Pipeline

```
Data (synthetic events) -> Analyst (stats, key moments) -> Explainer (why it matters)
      -> Storyteller (commentary + recaps, EN / SW / JA) -> Personalizer (fan, analyst, player focus)
      -> React overlay
```

## Synthetic match generator

Zero dependencies. Needs Node 20 or newer.

```bash
npm test                                          # 29 tests across the generator and the Analyst
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

## Data and IP

All clubs, players and matches are fictional and generated. No real match footage, league data or club marks are used.
