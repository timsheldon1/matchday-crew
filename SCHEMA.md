# Match event schema (v0.1)

A match is `{ meta, events }`. Events are ordered by `seq` and never go back in time.

## Coordinates

- Pitch is 105 m long (x) and 68 m wide (y).
- Coordinates are **absolute**: `x = 0..105`, `y = 0..68`.
- Home attacks toward `x = 105` in period 1 and toward `x = 0` in period 2. Away is the opposite.

## Common fields (every event)

| Field | Type | Notes |
|---|---|---|
| `id` | string | `{matchId}-{seq}` |
| `seq` | int | 1, 2, 3 … no gaps |
| `matchId` | string | `HOME-AWAY-seed` |
| `type` | string | see list below |
| `period` | 1 or 2 | |
| `elapsed` | number | seconds since kickoff, half-time excluded. Drives replay timing |
| `clock` | object | `{ minute, second, stoppage, display }`. `display` is `"23:41"` or `"45:00 +2:13"` in stoppage time |
| `team` | `"home"`, `"away"` or null | team that performed the action |
| `player` | object or null | `{ id, name, number, position }` |
| `location` | `{x,y}` or null | where the action happened |
| `possession` | object | `{ id, team }`. A new id starts every time a team gains the ball |
| `score` | object | `{ home, away }` after this event |
| `data` | object | type-specific, below |

## Event types and `data`

| Type | `data` |
|---|---|
| `match_start` | `home`, `away` (club id and name) |
| `period_start` | `period`, `announcedStoppageMinutes` |
| `kickoff` | none |
| `pass` | `recipient` (null if failed), `intendedRecipient`, `endLocation`, `distance` (m), `progressive` (m toward goal, can be negative), `kind` (ground, long, cross, through), `setPiece` (corner or null), `difficulty` (0 to 1), `underPressure`, `outcome` (complete, intercepted, out) |
| `carry` | `endLocation`, `distance`, `topSpeedKmh`, `durationSec`, `sprint` (true when the run is fast or long), `interrupted` (true if a tackle came in) |
| `pressure` | `targetPlayer`, `speedKmh` of the presser |
| `tackle` | `targetPlayer`, `outcome` (won, lost, foul) |
| `interception` | `fromPlayer` |
| `possession_change` | `from`, `to`, `reason` (interception, tackle, throw_in, goal_kick, save, block, kickoff) |
| `foul` | `victim`, `penalty` (bool), `card` (yellow, second_yellow, red or null) |
| `card` | `color` (yellow or red), `reason` |
| `corner` | none |
| `shot` | `xg`, `distanceToGoal`, `speedKmh`, `bodyPart` (foot, head), `situation` (open_play, corner, free_kick, penalty), `underPressure`, `keyPassPlayer`, `outcome` (goal, saved, blocked, off_target) |
| `goal` | `shotId`, `scorer`, `assist`, `xg`, `situation`, `scoreAfter` |
| `save` | `shotId`, `shooter`, `speedKmh` |
| `block` | `shotId`, `shooter` |
| `substitution` | `playerOut`, `playerIn` (`player` is the player coming on) |
| `period_end` | `period`, `score` |
| `match_end` | `finalScore` |

## Things the generator models but does not label

Momentum is simulated as a hidden value that drifts over the match, shifts after goals, big chances and turnovers, and changes how teams pass, press and attack. It is **not** in the events. Detecting those spells from the raw events is the Analyst agent's job.
