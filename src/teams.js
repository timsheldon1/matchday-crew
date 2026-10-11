// Fictional clubs and squads. No real clubs, players or league marks,
// so the demo video stays clear of third-party trademarks (Official Rules 4.4).
import { createRng } from './rng.js';

export const CLUBS = {
  NNS: {
    id: 'NNS', name: 'Nairobi Northstars', shortName: 'Northstars',
    colors: { primary: '#0B3D91', secondary: '#F2C230' },
    style: { pressing: 0.7, directness: 0.35, quality: 0.62 },
  },
  KLS: {
    id: 'KLS', name: 'Kisumu Lakeside', shortName: 'Lakeside',
    colors: { primary: '#0E7C66', secondary: '#FFFFFF' },
    style: { pressing: 0.45, directness: 0.6, quality: 0.58 },
  },
  RVU: {
    id: 'RVU', name: 'Riverside United', shortName: 'Riverside',
    colors: { primary: '#B3202A', secondary: '#1A1A1A' },
    style: { pressing: 0.55, directness: 0.45, quality: 0.66 },
  },
  HLA: {
    id: 'HLA', name: 'Highland Athletic', shortName: 'Highland',
    colors: { primary: '#5B2A86', secondary: '#E8E8E8' },
    style: { pressing: 0.35, directness: 0.7, quality: 0.55 },
  },
};

// 4-3-3. Base positions are in the team's attacking frame:
// x = 0 own goal line, x = 105 opponent goal line, y = 0..68 across the pitch.
export const FORMATION_433 = [
  { slot: 'GK', role: 'GK', x: 5, y: 34 },
  { slot: 'RB', role: 'DEF', x: 30, y: 8 },
  { slot: 'RCB', role: 'DEF', x: 24, y: 25 },
  { slot: 'LCB', role: 'DEF', x: 24, y: 43 },
  { slot: 'LB', role: 'DEF', x: 30, y: 60 },
  { slot: 'CDM', role: 'MID', x: 42, y: 34 },
  { slot: 'RCM', role: 'MID', x: 54, y: 22 },
  { slot: 'LCM', role: 'MID', x: 54, y: 46 },
  { slot: 'RW', role: 'FWD', x: 78, y: 10 },
  { slot: 'ST', role: 'FWD', x: 86, y: 34 },
  { slot: 'LW', role: 'FWD', x: 78, y: 58 },
];

const BENCH = [
  { slot: 'SUB', role: 'DEF' },
  { slot: 'SUB', role: 'MID' },
  { slot: 'SUB', role: 'MID' },
  { slot: 'SUB', role: 'FWD' },
  { slot: 'SUB', role: 'FWD' },
];

const FIRST = ['Amani', 'Kofi', 'Lucas', 'Hiro', 'Mateo', 'Baraka', 'Elias', 'Tomas', 'Juma', 'Noah',
  'Yusuf', 'Rafael', 'Kenji', 'Otieno', 'Samir', 'Diego', 'Liam', 'Ade', 'Musa', 'Felix',
  'Arjun', 'Kwame', 'Leo', 'Bruno', 'Wanjala', 'Oscar', 'Ren', 'Malik', 'Ivan', 'Theo'];
const LAST = ['Odhiambo', 'Mensah', 'Silva', 'Tanaka', 'Rojas', 'Kamau', 'Lindqvist', 'Novak', 'Mwangi',
  'Okafor', 'Haddad', 'Moreau', 'Sato', 'Achieng', 'Ferreira', 'Kipchoge', 'Brennan', 'Diallo',
  'Wekesa', 'Petrov', 'Nakamura', 'Owusu', 'Castillo', 'Barasa', 'Keller', 'Yamada', 'Ochieng', 'Duarte'];

const CLASSIC_NUMBERS = { GK: 1, RB: 2, LB: 3, LCB: 4, RCB: 5, CDM: 6, RW: 7, RCM: 8, ST: 9, LCM: 10, LW: 11 };

const ROLE_ATTR = {
  GK: { passing: 55, finishing: 10, defending: 40, keeping: 75 },
  DEF: { passing: 66, finishing: 35, defending: 74, keeping: 5 },
  MID: { passing: 77, finishing: 55, defending: 60, keeping: 5 },
  FWD: { passing: 68, finishing: 74, defending: 35, keeping: 5 },
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Squads are generated from the club id, so a club's players never change between matches.
export function buildSquad(clubId) {
  const club = CLUBS[clubId];
  if (!club) throw new Error(`Unknown club "${clubId}". Options: ${Object.keys(CLUBS).join(', ')}`);
  const rng = createRng(`squad:${clubId}`);
  const usedNames = new Set();
  const usedNumbers = new Set();
  const q = (club.style.quality - 0.6) * 40; // shifts attributes up or down by club quality

  const makePlayer = (spec, i) => {
    let name;
    do { name = `${rng.pick(FIRST)} ${rng.pick(LAST)}`; } while (usedNames.has(name));
    usedNames.add(name);
    let number = CLASSIC_NUMBERS[spec.slot] ?? rng.int(12, 30);
    while (usedNumbers.has(number)) number = rng.int(12, 40);
    usedNumbers.add(number);
    const base = ROLE_ATTR[spec.role];
    const attr = (v) => Math.round(clamp(rng.normal(v + q, 6), 20, 95));
    return {
      id: `${clubId}-${String(number).padStart(2, '0')}`,
      name,
      number,
      position: spec.slot,
      role: spec.role,
      starter: spec.slot !== 'SUB',
      attributes: {
        passing: attr(base.passing),
        finishing: attr(base.finishing),
        defending: attr(base.defending),
        keeping: attr(base.keeping),
        topSpeedKmh: Math.round(clamp(rng.normal(spec.role === 'GK' ? 27 : spec.role === 'FWD' ? 34 : 32, 1.5), 25, 37) * 10) / 10,
      },
      // index into FORMATION_433 for starters; subs inherit the slot of who they replace
      formationIndex: spec.slot === 'SUB' ? null : i,
    };
  };

  const starters = FORMATION_433.map((s, i) => makePlayer(s, i));
  const bench = BENCH.map((s) => makePlayer(s, null));
  return { ...club, formation: '4-3-3', players: [...starters, ...bench] };
}
