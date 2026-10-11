import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMatch } from '../src/generator.js';

const seeds = [1, 2, 3, 42, 'demo'];

test('same seed gives an identical match', () => {
  assert.deepEqual(generateMatch({ seed: 42 }), generateMatch({ seed: 42 }));
});

test('different seeds give different matches', () => {
  const a = generateMatch({ seed: 1 }).events.length;
  const b = generateMatch({ seed: 2 }).events.length;
  assert.notEqual(a, b);
});

for (const seed of seeds) {
  test(`seed ${seed}: events are ordered and well formed`, () => {
    const { events } = generateMatch({ seed });
    assert.equal(events[0].type, 'match_start');
    assert.equal(events.at(-1).type, 'match_end');
    for (let i = 1; i < events.length; i++) {
      assert.equal(events[i].seq, events[i - 1].seq + 1);
      assert.ok(events[i].elapsed >= events[i - 1].elapsed, `time went backwards at seq ${events[i].seq}`);
    }
    for (const e of events) {
      for (const p of [e.location, e.data.endLocation].filter(Boolean)) {
        assert.ok(p.x >= 0 && p.x <= 105 && p.y >= 0 && p.y <= 68, `out of bounds at seq ${e.seq}`);
      }
    }
  });

  test(`seed ${seed}: goal events match the final score`, () => {
    const { events } = generateMatch({ seed });
    const goals = { home: 0, away: 0 };
    for (const e of events) if (e.type === 'goal') goals[e.team]++;
    assert.deepEqual(goals, events.at(-1).data.finalScore);
    const goalShots = events.filter((e) => e.type === 'shot' && e.data.outcome === 'goal').length;
    assert.equal(goalShots, goals.home + goals.away);
  });

  test(`seed ${seed}: substitutions bring on bench players only`, () => {
    const match = generateMatch({ seed });
    for (const e of match.events.filter((x) => x.type === 'substitution')) {
      const squad = match.meta.teams[e.team].players;
      assert.equal(squad.find((p) => p.id === e.data.playerIn.id).starter, false);
    }
  });
}

test('home shoots toward x = 105 in period 1 and toward x = 0 in period 2', () => {
  const { events } = generateMatch({ seed: 7 });
  const avgX = (period) => {
    const shots = events.filter((e) => e.type === 'shot' && e.team === 'home' && e.period === period);
    return shots.reduce((s, e) => s + e.location.x, 0) / shots.length;
  };
  assert.ok(avgX(1) > 70);
  assert.ok(avgX(2) < 35);
});
