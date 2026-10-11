// Team shape model: estimates where all 22 players are, from the ball position,
// who has the ball, each player's formation slot and the match clock.
//
// The generator only tracks the ball and the player on it, so this is a simulation of
// realistic team movement, not real tracking data:
// - the whole block slides up and down the pitch with the ball
// - the team in possession pushes up and spreads wide; the defending team drops and narrows
// - both teams shift sideways toward the ball
// - the player on the ball is exactly at the ball; the nearest opponent steps in to press
// - a small, smooth drift keeps players from looking frozen
// Coordinates follow SCHEMA.md: absolute, 105 x 68 metres.

// Same 4-3-3 slots as src/teams.js, in each team's attacking frame (x = 105 is the goal they attack).
export const SLOTS = {
  GK: { x: 5, y: 34 },
  RB: { x: 30, y: 8 },
  RCB: { x: 24, y: 25 },
  LCB: { x: 24, y: 43 },
  LB: { x: 30, y: 60 },
  CDM: { x: 42, y: 34 },
  RCM: { x: 54, y: 22 },
  LCM: { x: 54, y: 46 },
  RW: { x: 78, y: 10 },
  ST: { x: 86, y: 34 },
  LW: { x: 78, y: 58 },
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const attacksRight = (side, period) => (side === 'home') === (period === 1);
const toFrame = (side, period, p) => (attacksRight(side, period) ? p : { x: 105 - p.x, y: 68 - p.y });
const fromFrame = toFrame; // the flip is its own inverse

function phase(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return (h % 1000) / 1000 * Math.PI * 2;
}

// lineup: { home: [player], away: [player] } with player.position = slot name
export function teamShape({ lineup, ball, possession, period, elapsed = 0, carrierId = null }) {
  const out = [];
  for (const side of ['home', 'away']) {
    const inPossession = possession === side;
    const b = toFrame(side, period, ball);
    // Block shift: how far the team has moved up (+) or down (-) the pitch.
    const shift = (b.x - 52.5) * (inPossession ? 0.55 : 0.5) + (inPossession ? 7 : -6);
    const depth = inPossession ? 1.0 : 0.8; // defending teams get compact
    const width = inPossession ? 1.12 : 0.78; // and narrow
    const slide = inPossession ? 0.3 : 0.45; // sideways pull toward the ball

    for (const p of lineup[side] ?? []) {
      const slot = SLOTS[p.position] ?? SLOTS.CDM;
      const ph = phase(p.id);
      let x;
      let y;
      if (p.position === 'GK') {
        x = clamp(3 + (b.x / 105) * 14, 2, 18);
        y = 34 + (b.y - 34) * 0.18;
      } else {
        x = 55 + (slot.x - 55) * depth + shift + Math.sin(elapsed / 6 + ph) * 1.2;
        y = 34 + (slot.y - 34) * width + (b.y - 34) * slide + Math.cos(elapsed / 7 + ph) * 1.2;
        // Defenders never sit deeper than their own six-yard line; forwards stop around the
        // penalty spot instead of standing on the goalkeeper (only the ball carrier goes further).
        x = clamp(x, 6, 93);
        y = clamp(y, 2, 66);
      }
      out.push({ ...p, side, frame: { x, y } });
    }
  }

  // The player on the ball is at the ball.
  const carrier = out.find((p) => p.id === carrierId);
  if (carrier) carrier.frame = toFrame(carrier.side, period, ball);

  // The nearest defender steps in to press, standing goal side of the ball.
  if (possession) {
    const def = possession === 'home' ? 'away' : 'home';
    const b = toFrame(def, period, ball);
    const defenders = out.filter((p) => p.side === def && p.position !== 'GK');
    let best = null;
    let bestD = Infinity;
    for (const p of defenders) {
      const d = Math.hypot(p.frame.x - b.x, p.frame.y - b.y);
      if (d < bestD) { bestD = d; best = p; }
    }
    if (best && bestD < 25) best.frame = { x: clamp(b.x - 2.5, 2, 103), y: clamp(b.y + (34 - b.y) * 0.05, 2, 66) };
  }

  return out.map((p) => {
    const abs = fromFrame(p.side, period, p.frame);
    return { id: p.id, name: p.name, number: p.number, position: p.position, side: p.side, x: abs.x, y: abs.y };
  });
}
