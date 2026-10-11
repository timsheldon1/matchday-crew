import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMatch } from '../src/generator.js';
import { teamShape } from '../web/src/teamShape.js';

const match = generateMatch({ seed: 42 });
const lineup = {
  home: match.meta.teams.home.players.filter((p) => p.starter),
  away: match.meta.teams.away.players.filter((p) => p.starter),
};

test('every event frame gives 22 players inside the pitch, carrier on the ball', () => {
  // first half only: this test uses the starting lineups (no substitutions yet)
  for (const ev of match.events.filter((e) => e.type === 'carry' && e.period === 1).slice(0, 300)) {
    const ball = ev.location;
    const players = teamShape({ lineup, ball, possession: ev.team, period: ev.period, elapsed: ev.elapsed, carrierId: ev.player.id });
    assert.equal(players.length, 22);
    for (const p of players) assert.ok(p.x >= 0 && p.x <= 105 && p.y >= 0 && p.y <= 68, `${p.name} off the pitch`);
    const c = players.find((p) => p.id === ev.player.id);
    assert.ok(Math.abs(c.x - ball.x) < 0.01 && Math.abs(c.y - ball.y) < 0.01);
  }
});

test('goalkeepers stay near their own goal and swap ends at half time', () => {
  const ball = { x: 52.5, y: 34 };
  const p1 = teamShape({ lineup, ball, possession: 'home', period: 1 });
  const p2 = teamShape({ lineup, ball, possession: 'home', period: 2 });
  const gk = (ps) => ps.find((p) => p.side === 'home' && p.position === 'GK');
  assert.ok(gk(p1).x < 20); // home defends x = 0 in period 1
  assert.ok(gk(p2).x > 85); // and x = 105 in period 2
});

test('the team in possession pushes up the pitch, the defending team drops', () => {
  const ball = { x: 70, y: 34 };
  const avgX = (ps, side) => ps.filter((p) => p.side === side && p.position !== 'GK').reduce((s, p) => s + p.x, 0) / 10;
  const attack = teamShape({ lineup, ball, possession: 'home', period: 1 });
  const defend = teamShape({ lineup, ball, possession: 'away', period: 1 });
  assert.ok(avgX(attack, 'home') > avgX(defend, 'home') + 5);
});
