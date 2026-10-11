import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMatch } from '../src/generator.js';
import { analyseMatch, createAnalyst } from '../src/analyst.js';
import { summarize } from '../src/stats.js';

const seeds = [1, 42, 'demo'];

for (const seed of seeds) {
  test(`seed ${seed}: one goal moment per goal, with correct score`, () => {
    const match = generateMatch({ seed });
    const { moments, snapshot } = analyseMatch(match);
    const goals = match.events.filter((e) => e.type === 'goal');
    const goalMoments = moments.filter((m) => m.type === 'goal');
    assert.equal(goalMoments.length, goals.length);
    goalMoments.forEach((m, i) => assert.deepEqual(m.score, goals[i].data.scoreAfter));
    assert.deepEqual(snapshot.score, match.events.at(-1).data.finalScore);
  });

  test(`seed ${seed}: Analyst stats agree with the box score`, () => {
    const match = generateMatch({ seed });
    const { snapshot } = analyseMatch(match);
    const box = summarize(match).stats;
    for (const side of ['home', 'away']) {
      for (const k of ['shots', 'passes', 'corners', 'fouls', 'goals']) {
        assert.equal(snapshot.teams[side][k], box[side][k], `${side}.${k}`);
      }
      assert.ok(Math.abs(snapshot.teams[side].xg - box[side].xg) < 0.02);
    }
    assert.equal(snapshot.teams.home.possessionPct + snapshot.teams.away.possessionPct, 100);
  });

  test(`seed ${seed}: every moment is well formed and in time order`, () => {
    const { moments } = analyseMatch(generateMatch({ seed }));
    assert.ok(moments.length > 10);
    let last = -1;
    for (const m of moments) {
      assert.ok(m.headline && m.type && m.id && m.eventIds.length);
      assert.ok(m.importance >= 0 && m.importance <= 1);
      assert.ok(m.elapsed >= last);
      last = m.elapsed;
    }
    assert.equal(moments.at(-1).type, 'full_time');
  });
}

test('live ingest gives the same moments as a full-match analysis', () => {
  const match = generateMatch({ seed: 9 });
  const analyst = createAnalyst(match.meta);
  const live = match.events.flatMap((e) => analyst.ingest(e));
  assert.deepEqual(live, analyseMatch(match).moments);
});

test('momentum read tracks the hidden true momentum', () => {
  let swings = 0;
  let correct = 0;
  for (let i = 0; i < 15; i++) {
    const match = generateMatch({ seed: `t${i}`, debug: true });
    const analyst = createAnalyst(match.meta);
    for (const ev of match.events) {
      for (const m of analyst.ingest(ev)) {
        if (m.type !== 'momentum_swing') continue;
        swings++;
        if ((m.team === 'home') === (ev._truth.momentum > 0)) correct++;
      }
    }
  }
  assert.ok(swings > 30);
  assert.ok(correct / swings > 0.6, `only ${correct}/${swings} swing calls matched the truth`);
});
