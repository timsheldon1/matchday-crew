// Synthetic match generator.
// Simulates a full 90-minute match as a stream of timed, football-realistic events.
// Internally each action is modelled in the attacking frame of the team on the ball
// (x = 0 own goal, x = 105 opponent goal). Every emitted event is converted to
// absolute pitch coordinates (see SCHEMA.md).
import { createRng } from './rng.js';
import { buildSquad, FORMATION_433 } from './teams.js';

export const PITCH = { length: 105, width: 68 };
const GOAL = { x: 105, y: 34, halfWidth: 3.66 };
const HALF_SECONDS = 45 * 60;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const flip = (p) => ({ x: PITCH.length - p.x, y: PITCH.width - p.y });
const clampPitch = (p) => ({ x: clamp(p.x, 0.5, 104.5), y: clamp(p.y, 0.5, 67.5) });
const other = (side) => (side === 'home' ? 'away' : 'home');

// Angle (radians) the goal mouth subtends from a point. Wider angle = better chance.
function goalAngle(p) {
  const a = Math.atan2(GOAL.y - GOAL.halfWidth - p.y, GOAL.x - p.x);
  const b = Math.atan2(GOAL.y + GOAL.halfWidth - p.y, GOAL.x - p.x);
  return Math.abs(b - a);
}

// Simple expected-goals model from distance and angle.
export function expectedGoals(p, { head = false, pressured = false } = {}) {
  const d = dist(p, GOAL);
  const logit = -0.12 * d - 1.2 + 1.5 * goalAngle(p);
  let xg = 1 / (1 + Math.exp(-logit));
  if (head) xg *= 0.6;
  if (pressured) xg *= 0.7;
  return clamp(xg, 0.01, 0.95);
}

export function generateMatch({ seed = 1, home = 'NNS', away = 'KLS', debug = false } = {}) {
  if (home === away) throw new Error('Home and away clubs must be different');
  const rng = createRng(`match:${seed}:${home}:${away}`);
  const matchId = `${home}-${away}-${seed}`;
  const squads = { home: buildSquad(home), away: buildSquad(away) };

  const lineup = {};
  const bench = {};
  for (const side of ['home', 'away']) {
    lineup[side] = squads[side].players
      .filter((p) => p.starter)
      .map((p) => ({ player: p, base: FORMATION_433[p.formationIndex] }));
    bench[side] = squads[side].players.filter((p) => !p.starter);
  }

  // Substitution windows (match minute), three per team in the second half.
  const subPlan = {
    home: [rng.int(56, 66), rng.int(67, 76), rng.int(77, 86)],
    away: [rng.int(56, 66), rng.int(67, 76), rng.int(77, 86)],
  };

  const state = {
    period: 1,
    elapsed: 0,
    periodStart: 0,
    score: { home: 0, away: 0 },
    momentum: 0, // hidden: > 0 favours home, < 0 favours away. The Analyst should infer it.
    possessionId: 0,
    possessionTeam: null,
    ball: { x: 52.5, y: 34 },
    carrier: null,
    lastPasser: null,
    setPiece: null,
    yellows: new Map(),
  };
  const events = [];
  let seq = 0;

  const attacksRight = (side) => (side === 'home') === (state.period === 1);
  const toAbs = (side, p) => {
    const q = attacksRight(side) ? p : flip(p);
    return { x: r1(q.x), y: r1(q.y) };
  };
  const brief = (p) => (p ? { id: p.id, name: p.name, number: p.number, position: p.position } : null);
  const sm = (side) => (side === 'home' ? state.momentum : -state.momentum);
  const nudge = (side, amount) => {
    state.momentum = clamp(state.momentum + (side === 'home' ? amount : -amount), -1, 1);
  };
  const tick = (s) => { state.elapsed += Math.max(0, s); };
  const periodElapsed = () => state.elapsed - state.periodStart;

  function clock() {
    const pe = periodElapsed();
    const offset = state.period === 1 ? 0 : HALF_SECONDS;
    const regular = Math.min(pe, HALF_SECONDS);
    const total = offset + regular;
    const minute = Math.floor(total / 60);
    const second = Math.floor(total % 60);
    const pad = (n) => String(n).padStart(2, '0');
    if (pe <= HALF_SECONDS) {
      return { minute, second, stoppage: 0, display: `${pad(minute)}:${pad(second)}` };
    }
    const extra = pe - HALF_SECONDS;
    const em = Math.floor(extra / 60);
    const es = Math.floor(extra % 60);
    return {
      minute: offset / 60 + 45,
      second: 0,
      stoppage: Math.round(extra),
      display: `${offset / 60 + 45}:00 +${em}:${pad(es)}`,
    };
  }

  function emit(type, side, player, loc, data = {}) {
    seq += 1;
    const ev = {
      id: `${matchId}-${String(seq).padStart(5, '0')}`,
      seq,
      matchId,
      type,
      period: state.period,
      elapsed: r1(state.elapsed),
      clock: clock(),
      team: side ?? null,
      player: brief(player),
      location: loc && side ? toAbs(side, loc) : null,
      possession: { id: state.possessionId, team: state.possessionTeam },
      score: { ...state.score },
      data,
    };
    // Ground truth for testing the Analyst. Never shown to agents or the UI.
    if (debug) ev._truth = { momentum: r2(state.momentum) };
    events.push(ev);
    return ev;
  }

  const inLineup = (side, p) => p && lineup[side].some((e) => e.player.id === p.id);
  const goalkeeper = (side) => lineup[side].find((e) => e.player.role === 'GK')?.player;

  // Pick the player most likely to be near a spot, based on formation positions.
  function pickNear(side, loc, { excludeId = null, allowGK = false } = {}) {
    const cands = lineup[side].filter(
      (e) => e.player.id !== excludeId && (allowGK || e.player.role !== 'GK'),
    );
    return rng.weighted(cands, (e) => {
      const dx = e.base.x - loc.x;
      const dy = e.base.y - loc.y;
      return Math.exp(-(dx * dx) / (2 * 22 * 22) - (dy * dy) / (2 * 18 * 18)) + 0.01;
    }).player;
  }

  function startPossession(side, loc, reason, deadTime = 0, carrier = null) {
    const prev = state.possessionTeam;
    tick(deadTime);
    maybeSubstitute();
    state.possessionId += 1;
    state.possessionTeam = side;
    state.ball = clampPitch(loc);
    state.carrier = carrier && inLineup(side, carrier) ? carrier : null;
    state.lastPasser = null;
    state.setPiece = null;
    if (prev && prev !== side) {
      emit('possession_change', side, state.carrier, state.ball, { from: prev, to: side, reason });
    }
  }

  function kickoff(side) {
    const striker = lineup[side].find((e) => e.base.x > 80)?.player ?? pickNear(side, { x: 52, y: 34 });
    startPossession(side, { x: 52.5, y: 34 }, 'kickoff', 0, striker);
    state.carrier = striker;
    emit('kickoff', side, striker, state.ball, {});
  }

  function maybeSubstitute() {
    if (state.period !== 2) return;
    const minute = 45 + periodElapsed() / 60;
    for (const side of ['home', 'away']) {
      while (subPlan[side].length && subPlan[side][0] <= minute && bench[side].length) {
        subPlan[side].shift();
        const incoming = bench[side].shift();
        const sameRole = lineup[side].filter((e) => e.player.role === incoming.role);
        const pool = sameRole.length ? sameRole : lineup[side].filter((e) => e.player.role !== 'GK');
        const slot = rng.pick(pool);
        const playerOut = slot.player;
        slot.player = { ...incoming, position: slot.base.slot };
        if (state.carrier?.id === playerOut.id) state.carrier = null;
        emit('substitution', side, slot.player, null, {
          playerOut: brief(playerOut),
          playerIn: brief(slot.player),
        });
      }
    }
  }

  // ---------- actions ----------

  function applyPressure(side, carrier) {
    const opp = other(side);
    const style = squads[opp].style;
    const b = state.ball;
    const p = clamp(
      0.15 + 0.25 * style.pressing + (b.x < 35 ? 0.15 * style.pressing : 0) + (b.x > 75 ? 0.12 : 0) + (b.x > 88 ? 0.25 : 0) - 0.12 * sm(side),
      0.05, 0.85,
    );
    if (!rng.chance(p)) return false;
    const oppLoc = flip(b);
    const presser = pickNear(opp, oppLoc, { allowGK: oppLoc.x < 12 });
    emit('pressure', opp, presser, oppLoc, {
      targetPlayer: brief(carrier),
      speedKmh: r1(presser.attributes.topSpeedKmh * rng.range(0.55, 0.92)),
    });
    tick(rng.range(0.4, 1.4));
    const inBox = b.x > 88.5 && Math.abs(b.y - 34) < 20.16;
    if (!inBox && rng.chance(0.035)) {
      foul(side, carrier, opp, presser, b);
      return 'foul';
    }
    return true;
  }

  function pass(side, carrier, pressured) {
    const style = squads[side].style;
    const b = state.ball;
    const m = sm(side);
    let kind = 'ground';
    let target;
    if (state.setPiece === 'corner') {
      kind = 'cross';
      target = { x: rng.range(92, 101), y: rng.range(26, 42) };
    } else if (carrier.role === 'GK') {
      kind = rng.chance(0.35 + 0.3 * style.directness) ? 'long' : 'ground';
      target = kind === 'long'
        ? { x: b.x + rng.range(35, 60), y: rng.range(10, 58) }
        : { x: b.x + rng.range(8, 22), y: b.y + rng.normal(0, 16) };
    } else if (b.x < 40 && rng.chance(0.06 + 0.16 * style.directness)) {
      kind = 'long';
      target = { x: b.x + rng.range(25, 50), y: b.y + rng.normal(0, 15) };
    } else if (b.x > 72 && Math.abs(b.y - 34) > 18 && rng.chance(0.35)) {
      kind = 'cross';
      target = { x: rng.range(90, 101), y: rng.range(24, 44) };
    } else if (b.x > 55 && rng.chance(0.09)) {
      kind = 'through';
      target = { x: b.x + rng.range(12, 25), y: b.y + rng.normal(0, 8) };
    } else {
      const forward = b.x > 78 ? -3 + 3 * m : 3 + 6 * m + 4 * style.directness;
      target = { x: b.x + rng.normal(forward, 11), y: b.y + rng.normal(0, 13) };
    }
    target = clampPitch(target);

    const recipient = pickNear(side, target, { excludeId: carrier.id });
    const distance = dist(b, target);
    const progressive = target.x - b.x;
    const difficulty = clamp(
      0.08 + (Math.min(distance, 60) / 60) * 0.45 + (progressive > 15 ? 0.12 : 0) + (pressured ? 0.18 : 0)
        + (target.x > 80 ? 0.1 : 0) + (target.x > 88 ? 0.25 : 0) + (kind === 'through' ? 0.12 : 0) + (kind === 'cross' ? 0.15 : 0),
      0.02, 0.98,
    );
    const pSuccess = clamp(0.98 - difficulty * 0.5 + (carrier.attributes.passing - 70) / 250 + 0.05 * m, 0.25, 0.99);
    const success = rng.chance(pSuccess);
    const outcome = success ? 'complete' : rng.chance(0.72) ? 'intercepted' : 'out';
    const flightTime = 0.6 + distance / (kind === 'long' || kind === 'cross' ? 20 : 14);
    const fromCorner = state.setPiece === 'corner';

    emit('pass', side, carrier, b, {
      recipient: success ? brief(recipient) : null,
      intendedRecipient: brief(recipient),
      endLocation: toAbs(side, target),
      distance: r1(distance),
      progressive: r1(progressive),
      kind,
      setPiece: fromCorner ? 'corner' : null,
      difficulty: r2(difficulty),
      underPressure: pressured,
      outcome,
    });

    if (success) {
      tick(flightTime + rng.range(0.8, 3.0));
      state.ball = target;
      state.lastPasser = carrier;
      state.carrier = recipient;
      state.setPiece = fromCorner ? 'corner_cross' : null;
      if (progressive > 15 && target.x > 70) nudge(side, 0.01);
      return;
    }

    const opp = other(side);
    if (outcome === 'intercepted' && kind === 'cross' && rng.chance(0.3)) {
      tick(flightTime);
      return corner(side); // cleared behind for a corner
    }
    if (outcome === 'intercepted') {
      tick(flightTime * 0.7);
      const oppLoc = flip(target);
      const interceptor = pickNear(opp, oppLoc, { allowGK: oppLoc.x < 16 });
      emit('interception', opp, interceptor, oppLoc, { fromPlayer: brief(carrier) });
      nudge(opp, 0.01);
      startPossession(opp, oppLoc, 'interception', 0, interceptor);
      return;
    }

    tick(flightTime);
    if (target.x > 102) {
      startPossession(opp, { x: 6, y: 34 }, 'goal_kick', rng.range(12, 25), goalkeeper(opp));
    } else {
      const throwSpot = flip({ x: target.x, y: target.y < 34 ? 0.5 : 67.5 });
      startPossession(opp, throwSpot, 'throw_in', rng.range(6, 14));
    }
  }

  function carry(side, carrier, pressured) {
    const b = state.ball;
    const m = sm(side);
    const end = clampPitch({ x: b.x + Math.max(1, rng.normal(7 + 5 * m, 5)), y: b.y + rng.normal(0, 6) });
    const distance = dist(b, end);
    const sprint = distance > 14 || rng.chance(0.15);
    const topSpeed = sprint ? carrier.attributes.topSpeedKmh * rng.range(0.86, 0.99) : rng.range(12, 22);
    const duration = distance / ((topSpeed / 3.6) * 0.75);
    const tackleP = clamp(0.1 + (pressured ? 0.18 : 0) + (end.x > 75 ? 0.08 : 0) + (end.x > 88 ? 0.15 : 0), 0, 0.6);

    if (!rng.chance(tackleP)) {
      emit('carry', side, carrier, b, {
        endLocation: toAbs(side, end), distance: r1(distance), topSpeedKmh: r1(topSpeed),
        durationSec: r1(duration), sprint, interrupted: false,
      });
      tick(duration);
      state.ball = end;
      return;
    }

    // Challenged halfway through the run.
    const mid = { x: (b.x + end.x) / 2, y: (b.y + end.y) / 2 };
    const half = dist(b, mid);
    emit('carry', side, carrier, b, {
      endLocation: toAbs(side, mid), distance: r1(half), topSpeedKmh: r1(topSpeed),
      durationSec: r1(duration / 2), sprint, interrupted: true,
    });
    tick(duration / 2);

    const opp = other(side);
    const oppLoc = flip(mid);
    const defender = pickNear(opp, oppLoc, { allowGK: oppLoc.x < 10 });
    const roll = rng.next();
    const winP = clamp(0.55 + (defender.attributes.defending - 70) / 200, 0.3, 0.8);

    const inBox = mid.x > 88.5 && Math.abs(mid.y - 34) < 20.16;
    if (roll < (inBox ? 0.03 : 0.3)) {
      emit('tackle', opp, defender, oppLoc, { targetPlayer: brief(carrier), outcome: 'foul' });
      foul(side, carrier, opp, defender, mid);
    } else if (rng.chance(winP)) {
      emit('tackle', opp, defender, oppLoc, { targetPlayer: brief(carrier), outcome: 'won' });
      nudge(opp, 0.015);
      startPossession(opp, oppLoc, 'tackle', rng.range(0.5, 1.5), defender);
    } else {
      emit('tackle', opp, defender, oppLoc, { targetPlayer: brief(carrier), outcome: 'lost' });
      nudge(side, 0.01);
      state.ball = mid;
      tick(rng.range(0.5, 1.2));
    }
  }

  function foul(side, victim, opp, offender, spot) {
    const inBox = spot.x > 88.5 && Math.abs(spot.y - 34) < 20.16;
    let card = null;
    if (offender.role !== 'GK') {
      const booked = (state.yellows.get(offender.id) ?? 0) > 0; // booked players are more careful
      if (rng.chance(0.003)) card = 'red';
      else if (rng.chance((inBox ? 0.3 : 0.14) * (booked ? 0.4 : 1))) {
        const y = (state.yellows.get(offender.id) ?? 0) + 1;
        state.yellows.set(offender.id, y);
        card = y >= 2 ? 'second_yellow' : 'yellow';
      }
    }
    emit('foul', opp, offender, flip(spot), { victim: brief(victim), penalty: inBox, card });
    if (card) {
      emit('card', opp, offender, flip(spot), { color: card === 'yellow' ? 'yellow' : 'red', reason: card });
      if (card !== 'yellow') lineup[opp] = lineup[opp].filter((e) => e.player.id !== offender.id);
    }

    if (inBox) {
      const taker = lineup[side].map((e) => e.player).sort((a, b) => b.attributes.finishing - a.attributes.finishing)[0];
      tick(rng.range(60, 95));
      state.ball = { x: 94, y: 34 };
      state.carrier = taker;
      state.setPiece = 'penalty';
      state.lastPasser = null;
      shoot(side, taker, false);
      return;
    }
    const direct = spot.x > 78 && Math.abs(spot.y - 34) < 22 && rng.chance(0.45);
    tick(direct ? rng.range(30, 50) : rng.range(8, 20));
    state.ball = spot;
    state.carrier = victim;
    state.lastPasser = null;
    if (direct) {
      state.setPiece = 'free_kick';
      shoot(side, victim, false);
    }
  }

  function corner(side) {
    const loc = { x: 104.5, y: rng.chance(0.5) ? 0.5 : 67.5 };
    const taker = pickNear(side, loc);
    emit('corner', side, taker, loc, {});
    tick(rng.range(20, 35));
    state.ball = loc;
    state.carrier = taker;
    state.lastPasser = null;
    state.setPiece = 'corner';
  }

  function shoot(side, shooter, pressured) {
    const opp = other(side);
    const loc = state.ball;
    const situation = state.setPiece === 'penalty' ? 'penalty'
      : state.setPiece === 'free_kick' ? 'free_kick'
        : state.setPiece === 'corner_cross' ? 'corner' : 'open_play';
    const head = situation === 'corner' ? rng.chance(0.7) : situation === 'open_play' && dist(loc, GOAL) < 12 && rng.chance(0.15);
    let xg = expectedGoals(loc, { head, pressured });
    if (situation === 'penalty') xg = 0.76;
    if (situation === 'free_kick') xg = 0.06;
    const gk = goalkeeper(opp);
    const pGoal = clamp(xg * (0.75 + (shooter.attributes.finishing / 100) * 0.5) * (1.15 - ((gk?.attributes.keeping ?? 70) / 100) * 0.3), 0.005, 0.97);
    const speedKmh = clamp(rng.normal(78 + shooter.attributes.finishing * 0.25 - (head ? 35 : 0), 10), 30, 130);
    const assist = (situation === 'open_play' || situation === 'corner') && state.lastPasser ? state.lastPasser : null;

    let outcome;
    if (rng.chance(pGoal)) outcome = 'goal';
    else {
      const r = rng.next();
      const blockP = situation === 'penalty' ? 0 : situation === 'free_kick' ? 0.35 : 0.25;
      outcome = r < blockP ? 'blocked' : r < blockP + (1 - blockP) * 0.42 ? 'saved' : 'off_target';
    }

    const shot = emit('shot', side, shooter, loc, {
      xg: r3(xg),
      distanceToGoal: r1(dist(loc, GOAL)),
      speedKmh: r1(speedKmh),
      bodyPart: head ? 'head' : 'foot',
      situation,
      underPressure: pressured,
      keyPassPlayer: brief(assist),
      outcome,
    });
    state.setPiece = null;
    tick(1);

    if (outcome === 'goal') {
      state.score[side] += 1;
      emit('goal', side, shooter, loc, {
        shotId: shot.id, scorer: brief(shooter), assist: brief(assist), xg: r3(xg), situation,
        scoreAfter: { ...state.score },
      });
      nudge(side, 0.12);
      tick(rng.range(45, 80));
      kickoff(opp);
      return;
    }
    if (outcome === 'saved') {
      emit('save', opp, gk, { x: 2, y: 34 }, { shotId: shot.id, shooter: brief(shooter), speedKmh: r1(speedKmh) });
      nudge(side, 0.05);
      if (rng.chance(0.3)) return corner(side);
      return startPossession(opp, { x: 6, y: 34 }, 'save', rng.range(4, 10), gk);
    }
    if (outcome === 'blocked') {
      const oppLoc = flip(loc);
      const blocker = pickNear(opp, oppLoc);
      emit('block', opp, blocker, oppLoc, { shotId: shot.id, shooter: brief(shooter) });
      nudge(side, 0.03);
      if (rng.chance(0.4)) return corner(side);
      if (rng.chance(0.55)) return startPossession(opp, oppLoc, 'block', 0.5, blocker);
      state.carrier = pickNear(side, loc);
      state.lastPasser = null;
      return;
    }
    nudge(side, 0.02);
    startPossession(opp, { x: 6, y: 34 }, 'goal_kick', rng.range(12, 25), gk);
  }

  function step() {
    const side = state.possessionTeam;
    // Momentum drifts over time so there are natural spells of pressure for the Analyst to find.
    state.momentum = clamp(state.momentum * 0.99 + rng.normal(0, 0.04), -1, 1);

    if (!inLineup(side, state.carrier)) {
      state.carrier = pickNear(side, state.ball, { allowGK: state.ball.x < 15 });
    }
    const carrier = state.carrier;

    if (state.setPiece === 'corner') return pass(side, carrier, false);
    if (state.setPiece === 'corner_cross' && rng.chance(0.4)) return shoot(side, carrier, rng.chance(0.6));
    if (state.setPiece === 'corner_cross') state.setPiece = null;

    const press = applyPressure(side, carrier);
    if (press === 'foul') return;
    const pressured = press === true;
    const d = dist(state.ball, GOAL);
    let shotP = 0;
    if (state.ball.x > 70) shotP = d < 12 ? 0.2 : d < 18 ? 0.14 : d < 25 ? 0.09 : d < 32 ? 0.035 : 0;
    if (pressured) shotP *= 0.8;
    if (carrier.role === 'GK') shotP = 0;
    if (rng.chance(shotP)) return shoot(side, carrier, pressured);

    let carryP = carrier.role === 'GK' ? 0.03 : carrier.role === 'FWD' ? 0.26 : carrier.role === 'MID' ? 0.18 : 0.14;
    if (pressured) carryP *= 0.7;
    if (rng.chance(carryP)) return carry(side, carrier, pressured);
    return pass(side, carrier, pressured);
  }

  // ---------- match flow ----------

  emit('match_start', null, null, null, {
    home: { id: squads.home.id, name: squads.home.name },
    away: { id: squads.away.id, name: squads.away.name },
  });

  const firstKick = rng.chance(0.5) ? 'home' : 'away';
  for (const period of [1, 2]) {
    state.period = period;
    state.periodStart = state.elapsed;
    state.possessionTeam = null;
    if (period === 2) state.momentum *= 0.5; // half-time team talk resets things a bit
    const stoppageMin = period === 1 ? rng.int(1, 4) : rng.int(3, 7);
    const periodLength = HALF_SECONDS + stoppageMin * 60 + rng.int(0, 45);
    emit('period_start', null, null, null, { period, announcedStoppageMinutes: stoppageMin });
    kickoff(period === 1 ? firstKick : other(firstKick));
    while (periodElapsed() < periodLength) step();
    emit('period_end', null, null, null, { period, score: { ...state.score } });
  }
  emit('match_end', null, null, null, { finalScore: { ...state.score } });

  return {
    meta: {
      matchId,
      seed,
      generator: 'matchday-crew synthetic v0.1',
      pitch: { ...PITCH, units: 'metres' },
      coordinates:
        'Absolute. x = 0..105 along the pitch, y = 0..68 across. Home attacks toward x = 105 in period 1 and toward x = 0 in period 2.',
      teams: {
        home: { ...squads.home },
        away: { ...squads.away },
      },
    },
    events,
  };
}
