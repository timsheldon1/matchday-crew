// Analyst: turns raw match events into live statistics and key moments.
//
// Plain deterministic code, no LLM. It is fast enough for live play, its numbers are
// always right, and every moment carries the evidence (facts + event ids) that the
// Explainer and Storyteller agents need. Each moment also has a template headline,
// used as a fallback if an AI agent fails or times out.
//
// Usage:
//   const analyst = createAnalyst(match.meta);
//   for (const ev of events) for (const moment of analyst.ingest(ev)) { ... }
//   analyst.snapshot()  -> live stats, momentum, rhythm, top players

const BOX = (p) => p.x > 88.5 && Math.abs(p.y - 34) < 20.16;

export const DEFAULTS = {
  windowSec: 300, // momentum + rhythm look-back (5 game minutes)
  pressWindowSec: 180, // pressing spell look-back
  momentumEnter: 0.35, // momentum index needed to call a spell of dominance
  momentumExit: 0.12,
  smoothing: 0.1, // EWMA weight for each new reading
  swingCooldownSec: 300,
  chaosAbove: 3.6, // possession changes per minute
  controlBelow: 1.8,
  rhythmCooldownSec: 420,
  pressSpellPressures: 12, // ~top 10% of 3-minute windows in calibration
  pressSpellHighWins: 2,
  pressSpellCooldownSec: 600,
  sprintKmh: 33,
  rocketShotKmh: 110,
  bigChanceXg: 0.3,
  qualityPassDifficulty: 0.8,
  qualityPassProgressive: 30,
  warmupSec: 180, // no momentum or rhythm calls in the first 3 minutes of each half
};

const blankTeam = () => ({
  goals: 0, xg: 0, shots: 0, onTarget: 0, bigChances: 0,
  passes: 0, passesComplete: 0, finalThirdEntries: 0, boxEntries: 0,
  carries: 0, sprints: 0, pressures: 0, tackles: 0, tacklesWon: 0, interceptions: 0, highRecoveries: 0,
  fouls: 0, yellow: 0, red: 0, corners: 0, saves: 0, possessionSec: 0,
});

const blankPlayer = (p, side) => ({
  id: p.id, name: p.name, number: p.number, position: p.position, team: side,
  passes: 0, passesComplete: 0, keyPasses: 0, progressivePasses: 0, shots: 0, xg: 0, goals: 0, assists: 0,
  carries: 0, carryDistance: 0, sprints: 0, topSpeedKmh: 0, tackles: 0, tacklesWon: 0, interceptions: 0,
  pressures: 0, saves: 0, fouls: 0, cards: [],
});

const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

export function createAnalyst(meta, options = {}) {
  const cfg = { ...DEFAULTS, ...options };
  const teamNames = { home: meta.teams.home.name, away: meta.teams.away.name };
  const other = (s) => (s === 'home' ? 'away' : 'home');
  const attacksRight = (side, period) => (side === 'home') === (period === 1);
  const toFrame = (side, period, p) => (attacksRight(side, period) ? p : { x: 105 - p.x, y: 68 - p.y });

  const teams = { home: blankTeam(), away: blankTeam() };
  const players = new Map();
  const recent = []; // rolling window entries: { t, side, kind, w }
  const moments = [];
  const timeline = [];

  let momentum = 0;
  let momentumState = 'balanced';
  let lastSwingAt = -Infinity;
  let rhythm = 'normal';
  let lastRhythmAt = -Infinity;
  const lastPressSpell = { home: -Infinity, away: -Infinity };
  const lastSprintAlert = new Map();
  const xgNarrativeDone = new Set();
  let poss = { team: null, since: 0 };
  let lastEv = null;
  let mSeq = 0;
  let score = { home: 0, away: 0 };
  let periodStart = 0;

  const gk = (side) => meta.teams[side].players.find((p) => p.role === 'GK');

  function player(p, side) {
    if (!p) return null;
    if (!players.has(p.id)) players.set(p.id, blankPlayer(p, side));
    return players.get(p.id);
  }

  function push(t, side, kind, w) {
    recent.push({ t, side, kind, w });
  }

  function windowStats(now, side, sec = cfg.windowSec) {
    const out = { threat: 0, shots: 0, xg: 0, finalThirdEntries: 0, boxEntries: 0, corners: 0, highRecoveries: 0, pressures: 0, possessionSec: 0 };
    for (const r of recent) {
      if (r.t < now - sec || r.side !== side) continue;
      out.threat += r.w;
      if (r.kind === 'shot') { out.shots++; out.xg += r.xg; }
      if (r.kind === 'ft_entry') out.finalThirdEntries++;
      if (r.kind === 'box_entry') { out.finalThirdEntries++; out.boxEntries++; }
      if (r.kind === 'corner') out.corners++;
      if (r.kind === 'win_high') out.highRecoveries++;
      if (r.kind === 'pressure') out.pressures++;
      if (r.kind === 'poss') out.possessionSec += r.sec;
    }
    out.xg = round(out.xg);
    out.threat = round(out.threat, 1);
    out.possessionSec = Math.round(out.possessionSec);
    return out;
  }

  function addMoment(ev, type, importance, { team = ev.team, players: ps = [], facts = {}, headline, eventIds = [ev.id] } = {}) {
    mSeq += 1;
    const m = {
      id: `${meta.matchId}-M${String(mSeq).padStart(3, '0')}`,
      type,
      importance: round(importance),
      matchId: meta.matchId,
      period: ev.period,
      elapsed: ev.elapsed,
      clock: ev.clock.display,
      team,
      teamName: team ? teamNames[team] : null,
      players: ps.filter(Boolean).map((p) => ({ id: p.id, name: p.name, number: p.number, position: p.position })),
      score: { ...score },
      momentum: round(momentum),
      rhythm,
      facts,
      headline,
      eventIds,
    };
    moments.push(m);
    return m;
  }

  function goalContext(side) {
    const us = score[side];
    const them = score[other(side)];
    if (us + them === 1) return 'opener';
    if (us === them) return 'equaliser';
    if (us === them + 1) return 'go_ahead';
    if (us > them + 1) return 'extends_lead';
    return 'pulls_one_back';
  }

  function ingest(ev) {
    const out = [];
    const before = moments.length;
    const now = ev.elapsed;
    const side = ev.team;

    // possession time
    if (lastEv && poss.team && ev.period === lastEv.period) {
      const dt = now - lastEv.elapsed;
      teams[poss.team].possessionSec += dt;
      recent.push({ t: now, side: poss.team, kind: 'poss', w: dt * 0.02, sec: dt });
    }
    if (ev.possession?.team && ev.possession.team !== poss.team) poss = { team: ev.possession.team, since: now };

    const p = side ? player(ev.player, side) : null;
    const t = side ? teams[side] : null;
    const d = ev.data;
    const loc = ev.location && side ? toFrame(side, ev.period, ev.location) : null;

    switch (ev.type) {
      case 'pass': {
        t.passes++; p.passes++;
        if (d.outcome !== 'complete') break;
        t.passesComplete++; p.passesComplete++;
        if (d.progressive > 10) p.progressivePasses++;
        const end = toFrame(side, ev.period, d.endLocation);
        if (BOX(end)) { t.boxEntries++; t.finalThirdEntries++; push(now, side, 'box_entry', 2); }
        else if (end.x > 70 && loc.x <= 70) { t.finalThirdEntries++; push(now, side, 'ft_entry', 1); }
        if (ev.player.position !== 'GK' && d.difficulty >= cfg.qualityPassDifficulty && (d.progressive >= cfg.qualityPassProgressive || (d.kind === 'through' && BOX(end)))) {
          addMoment(ev, 'quality_pass', 0.35, {
            players: [ev.player, d.recipient],
            facts: { distance: d.distance, progressive: d.progressive, difficulty: d.difficulty, kind: d.kind, underPressure: d.underPressure, intoBox: BOX(end) },
            headline: `${ev.player.name} finds ${d.recipient.name} with a ${d.distance}m ${d.kind} pass`,
          });
        }
        break;
      }
      case 'carry': {
        t.carries++; p.carries++;
        p.carryDistance += d.distance;
        p.topSpeedKmh = Math.max(p.topSpeedKmh, d.topSpeedKmh);
        const end = toFrame(side, ev.period, d.endLocation);
        if (d.sprint) { t.sprints++; p.sprints++; push(now, side, 'sprint', 0.5); }
        if (end.x > 70 && loc.x <= 70) { t.finalThirdEntries++; push(now, side, 'ft_entry', 0.5); }
        if (d.topSpeedKmh >= cfg.sprintKmh && now - (lastSprintAlert.get(p.id) ?? -Infinity) > 120) {
          lastSprintAlert.set(p.id, now);
          addMoment(ev, 'speed_alert', 0.2, {
            players: [ev.player],
            facts: { topSpeedKmh: d.topSpeedKmh, distance: d.distance, playerTopSpeedSoFar: p.topSpeedKmh },
            headline: `${ev.player.name} hits ${d.topSpeedKmh} km/h`,
          });
        }
        break;
      }
      case 'pressure':
        t.pressures++; p.pressures++;
        push(now, side, 'pressure', 0.15);
        break;
      case 'tackle':
        t.tackles++; p.tackles++;
        if (d.outcome === 'won') {
          t.tacklesWon++; p.tacklesWon++;
          if (loc.x > 52.5) { t.highRecoveries++; push(now, side, 'win_high', 1.5); }
        }
        break;
      case 'interception':
        t.interceptions++; p.interceptions++;
        if (loc.x > 52.5) { t.highRecoveries++; push(now, side, 'win_high', 1.5); }
        break;
      case 'possession_change':
        push(now, side, 'turnover', 0);
        break;
      case 'corner':
        t.corners++;
        push(now, side, 'corner', 1.5);
        break;
      case 'shot': {
        t.shots++; p.shots++;
        t.xg += d.xg; p.xg += d.xg;
        if (d.outcome === 'goal' || d.outcome === 'saved') t.onTarget++;
        if (d.keyPassPlayer) {
          const kp = players.get(d.keyPassPlayer.id) ?? player(d.keyPassPlayer, side);
          kp.keyPasses++;
        }
        recent.push({ t: now, side, kind: 'shot', w: 2 + 10 * d.xg, xg: d.xg });
        if (d.xg >= cfg.bigChanceXg && d.situation !== 'penalty') t.bigChances++;
        if (d.outcome !== 'goal' && d.xg >= cfg.bigChanceXg) {
          const keeper = d.outcome === 'saved' ? gk(other(side)) : null;
          addMoment(ev, 'big_chance', d.situation === 'penalty' ? 0.85 : 0.7, {
            players: [ev.player, d.keyPassPlayer, keeper],
            facts: { xg: d.xg, outcome: d.outcome, situation: d.situation, distanceToGoal: d.distanceToGoal, speedKmh: d.speedKmh, bodyPart: d.bodyPart, keeper: keeper?.name ?? null },
            headline: d.outcome === 'saved'
              ? `Big save! ${keeper?.name ?? 'The keeper'} denies ${ev.player.name}`
              : `${ev.player.name} misses a big chance (${Math.round(d.xg * 100)}% xG)`,
          });
        } else if (d.outcome !== 'goal' && d.speedKmh >= cfg.rocketShotKmh) {
          addMoment(ev, 'rocket_shot', 0.4, {
            players: [ev.player],
            facts: { speedKmh: d.speedKmh, distanceToGoal: d.distanceToGoal, outcome: d.outcome, xg: d.xg },
            headline: `${ev.player.name} unleashes a ${d.speedKmh} km/h strike`,
          });
        }
        break;
      }
      case 'goal': {
        const scorer = players.get(d.scorer.id) ?? player(d.scorer, side);
        scorer.goals++;
        if (d.assist) (players.get(d.assist.id) ?? player(d.assist, side)).assists++;
        t.goals++;
        score = { ...d.scoreAfter };
        const signed = side === 'home' ? momentum : -momentum;
        const shotEv = lastEv?.type === 'shot' ? lastEv : null;
        addMoment(ev, 'goal', 1, {
          players: [d.scorer, d.assist],
          facts: {
            context: goalContext(side),
            againstRunOfPlay: signed < -0.25,
            scorerGoalsThisMatch: scorer.goals,
            xg: d.xg,
            situation: d.situation,
            speedKmh: shotEv?.data.speedKmh ?? null,
            distanceToGoal: shotEv?.data.distanceToGoal ?? null,
            bodyPart: shotEv?.data.bodyPart ?? null,
            teamXgSoFar: round(t.xg),
            opponentXgSoFar: round(teams[other(side)].xg),
          },
          headline: `GOAL! ${d.scorer.name} scores for ${teamNames[side]}. ${teamNames.home} ${score.home}-${score.away} ${teamNames.away}`,
          eventIds: [shotEv?.id, ev.id].filter(Boolean),
        });
        break;
      }
      case 'save':
        t.saves++; p.saves++;
        break;
      case 'foul':
        t.fouls++; p.fouls++;
        if (d.penalty) {
          addMoment(ev, 'penalty_awarded', 0.8, {
            team: other(side),
            players: [d.victim, ev.player],
            facts: { fouledBy: ev.player.name, victim: d.victim.name },
            headline: `Penalty to ${teamNames[other(side)]}! ${d.victim.name} is brought down`,
          });
        }
        break;
      case 'card':
        p.cards.push(d.color);
        if (d.color === 'yellow') t.yellow++; else t.red++;
        addMoment(ev, d.color === 'red' ? 'red_card' : 'yellow_card', d.color === 'red' ? 0.85 : 0.3, {
          players: [ev.player],
          facts: { reason: d.reason },
          headline: d.color === 'red'
            ? `Red card! ${ev.player.name} is sent off. ${teamNames[side]} down to ten`
            : `Yellow card for ${ev.player.name}`,
        });
        break;
      case 'substitution':
        addMoment(ev, 'substitution', 0.15, {
          players: [d.playerIn, d.playerOut],
          facts: { playerIn: d.playerIn.name, playerOut: d.playerOut.name },
          headline: `${teamNames[side]} change: ${d.playerIn.name} on, ${d.playerOut.name} off`,
        });
        break;
      case 'period_end':
      case 'match_end': {
        const isFull = ev.type === 'match_end';
        if (ev.type === 'period_end' && d.period === 2) break; // match_end covers it
        addMoment(ev, isFull ? 'full_time' : 'half_time', 0.9, {
          team: null,
          facts: { ...snapshot(), timeline: undefined },
          headline: `${isFull ? 'Full time' : 'Half time'}: ${teamNames.home} ${score.home}-${score.away} ${teamNames.away}`,
        });
        break;
      }
      default:
        break;
    }

    // ----- rolling analysis -----
    while (recent.length && recent[0].t < now - cfg.windowSec) recent.shift();

    if (ev.type !== 'match_start' && ev.type !== 'period_start') {
      const h = windowStats(now, 'home').threat;
      const a = windowStats(now, 'away').threat;
      const raw = (h - a) / (h + a + 5);
      momentum = (1 - cfg.smoothing) * momentum + cfg.smoothing * raw;

      if (now - periodStart >= cfg.warmupSec) {
        detectMomentum(ev);
        detectRhythm(ev);
      }
      detectPressing(ev);
      detectXgVsScore(ev);

      const minute = Math.floor(now / 60);
      if (!timeline.length || timeline[timeline.length - 1].minute < minute) {
        timeline.push({ minute, clock: ev.clock.display, momentum: round(momentum), rhythm });
      }
    }
    if (ev.type === 'period_start') { momentum *= 0.5; recent.length = 0; periodStart = now; }

    lastEv = ev;
    for (let i = before; i < moments.length; i++) out.push(moments[i]);
    return out;
  }

  function detectMomentum(ev) {
    const now = ev.elapsed;
    let next = momentumState;
    if (momentumState === 'balanced') {
      if (momentum > cfg.momentumEnter) next = 'home';
      else if (momentum < -cfg.momentumEnter) next = 'away';
    } else if (Math.abs(momentum) < cfg.momentumExit) next = 'balanced';
    else if (momentumState === 'home' && momentum < -cfg.momentumEnter) next = 'away';
    else if (momentumState === 'away' && momentum > cfg.momentumEnter) next = 'home';

    if (next === momentumState) return;
    const prev = momentumState;
    momentumState = next;
    if (next === 'balanced' || now - lastSwingAt < cfg.swingCooldownSec) return;
    lastSwingAt = now;
    const ws = windowStats(now, next);
    const wo = windowStats(now, other(next));
    const share = Math.round((ws.possessionSec / Math.max(1, ws.possessionSec + wo.possessionSec)) * 100);
    addMoment(ev, 'momentum_swing', 0.6, {
      team: next,
      facts: {
        from: prev,
        to: next,
        windowMinutes: cfg.windowSec / 60,
        momentumIndex: round(momentum),
        possessionPctInWindow: share,
        team: { shots: ws.shots, xg: ws.xg, finalThirdEntries: ws.finalThirdEntries, boxEntries: ws.boxEntries, corners: ws.corners, highRecoveries: ws.highRecoveries },
        opponent: { shots: wo.shots, xg: wo.xg, finalThirdEntries: wo.finalThirdEntries, boxEntries: wo.boxEntries, corners: wo.corners, highRecoveries: wo.highRecoveries },
      },
      headline: `${teamNames[next]} are taking control of the game`,
    });
  }

  function detectRhythm(ev) {
    const now = ev.elapsed;
    const minutes = Math.min(cfg.windowSec, now - periodStart) / 60;
    const changes = recent.filter((r) => r.kind === 'turnover' && r.t >= now - cfg.windowSec).length;
    const rate = changes / minutes;
    let next = rhythm;
    if (rhythm !== 'chaos' && rate > cfg.chaosAbove) next = 'chaos';
    else if (rhythm !== 'control' && rate < cfg.controlBelow) next = 'control';
    else if (rhythm === 'chaos' && rate < cfg.chaosAbove - 0.6) next = 'normal';
    else if (rhythm === 'control' && rate > cfg.controlBelow + 0.5) next = 'normal';
    if (next === rhythm) return;
    rhythm = next;
    if (next === 'normal' || now - lastRhythmAt < cfg.rhythmCooldownSec) return;
    lastRhythmAt = now;
    const h = windowStats(now, 'home');
    const a = windowStats(now, 'away');
    const controller = h.possessionSec >= a.possessionSec ? 'home' : 'away';
    addMoment(ev, 'rhythm_shift', 0.45, {
      team: next === 'control' ? controller : null,
      facts: {
        rhythm: next,
        possessionChangesPerMinute: round(rate, 1),
        baseline: 2.6,
        possessionSec: { home: h.possessionSec, away: a.possessionSec },
      },
      headline: next === 'chaos'
        ? 'The game has turned scrappy: possession is changing hands constantly'
        : `${teamNames[controller]} are slowing it down and keeping the ball`,
    });
  }

  function detectPressing(ev) {
    const now = ev.elapsed;
    for (const side of ['home', 'away']) {
      if (now - lastPressSpell[side] < cfg.pressSpellCooldownSec) continue;
      const w = windowStats(now, side, cfg.pressWindowSec);
      if (w.pressures >= cfg.pressSpellPressures && w.highRecoveries >= cfg.pressSpellHighWins) {
        lastPressSpell[side] = now;
        addMoment(ev, 'pressing_spell', 0.5, {
          team: side,
          facts: { pressuresLast3Min: w.pressures, typicalPressuresPer3Min: 7, highRecoveriesLast3Min: w.highRecoveries },
          headline: `${teamNames[side]} are pressing high and winning the ball back`,
        });
      }
    }
  }

  function detectXgVsScore(ev) {
    if (ev.clock.minute < 30 || !ev.team) return;
    for (const side of ['home', 'away']) {
      const key = `${ev.period}:${side}`;
      if (xgNarrativeDone.has(key)) continue;
      const diff = teams[side].xg - teams[other(side)].xg;
      if (diff >= 1.0 && score[side] <= score[other(side)]) {
        xgNarrativeDone.add(key);
        addMoment(ev, 'xg_vs_score', 0.55, {
          team: side,
          facts: { teamXg: round(teams[side].xg), opponentXg: round(teams[other(side)].xg), score: { ...score }, teamShots: teams[side].shots, opponentShots: teams[other(side)].shots },
          headline: `${teamNames[side]} are creating more (${round(teams[side].xg, 1)} xG vs ${round(teams[other(side)].xg, 1)}) but the scoreline doesn't show it`,
        });
      }
    }
  }

  function playerRating(s) {
    const acc = s.passes ? s.passesComplete / s.passes : 0.75;
    const r = 6 + s.goals * 1.0 + s.assists * 0.6 + s.xg * 0.6 + s.keyPasses * 0.2 + (acc - 0.78) * 2
      + s.progressivePasses * 0.03 + s.tacklesWon * 0.12 + s.interceptions * 0.06 + s.saves * 0.25
      - s.cards.filter((c) => c === 'red').length * 2 - s.cards.filter((c) => c === 'yellow').length * 0.3;
    return round(Math.max(3, Math.min(10, r)), 1);
  }

  function snapshot() {
    const total = teams.home.possessionSec + teams.away.possessionSec || 1;
    const teamOut = {};
    for (const s of ['home', 'away']) {
      const x = teams[s];
      teamOut[s] = {
        name: teamNames[s],
        ...x,
        xg: round(x.xg),
        possessionSec: Math.round(x.possessionSec),
        possessionPct: Math.round((x.possessionSec / total) * 100),
        passAccuracy: x.passes ? Math.round((x.passesComplete / x.passes) * 100) : 0,
      };
    }
    const ps = [...players.values()].map((s) => ({
      ...s,
      xg: round(s.xg),
      carryDistance: Math.round(s.carryDistance),
      passAccuracy: s.passes ? Math.round((s.passesComplete / s.passes) * 100) : null,
      rating: playerRating(s),
    }));
    ps.sort((a, b) => b.rating - a.rating);
    return {
      clock: lastEv?.clock.display ?? '00:00',
      score: { ...score },
      momentum: { index: round(momentum), state: momentumState },
      rhythm,
      teams: teamOut,
      topPlayers: ps.slice(0, 5).map(({ id, name, team, position, rating, goals, assists, xg, keyPasses, passAccuracy, topSpeedKmh }) => ({ id, name, team, position, rating, goals, assists, xg, keyPasses, passAccuracy, topSpeedKmh })),
      fastestPlayer: [...ps].sort((a, b) => b.topSpeedKmh - a.topSpeedKmh)[0]?.name ?? null,
      timeline,
    };
  }

  return {
    ingest,
    snapshot,
    players: () => [...players.values()],
    moments: () => [...moments],
  };
}

// Convenience: run a full match through the Analyst.
export function analyseMatch(match, options) {
  const analyst = createAnalyst(match.meta, options);
  for (const ev of match.events) analyst.ingest(ev);
  return { moments: analyst.moments(), snapshot: analyst.snapshot() };
}
