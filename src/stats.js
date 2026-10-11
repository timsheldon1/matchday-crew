// Box-score summary of a generated match. Used to sanity-check realism,
// and a useful reference when building the Analyst agent.

export function summarize(match) {
  const blank = () => ({
    goals: 0, xg: 0, shots: 0, onTarget: 0, passes: 0, passesComplete: 0,
    progressivePasses: 0, crosses: 0, carries: 0, sprints: 0, tackles: 0, tacklesWon: 0,
    interceptions: 0, pressures: 0, fouls: 0, yellow: 0, red: 0, corners: 0, saves: 0,
  });
  const t = { home: blank(), away: blank() };

  for (const e of match.events) {
    const s = t[e.team];
    if (!s) continue;
    switch (e.type) {
      case 'pass':
        s.passes++;
        if (e.data.outcome === 'complete') s.passesComplete++;
        if (e.data.progressive > 10 && e.data.outcome === 'complete') s.progressivePasses++;
        if (e.data.kind === 'cross') s.crosses++;
        break;
      case 'shot':
        s.shots++;
        s.xg += e.data.xg;
        if (e.data.outcome === 'goal' || e.data.outcome === 'saved') s.onTarget++;
        break;
      case 'goal': s.goals++; break;
      case 'carry': s.carries++; if (e.data.sprint) s.sprints++; break;
      case 'tackle': s.tackles++; if (e.data.outcome === 'won') s.tacklesWon++; break;
      case 'interception': s.interceptions++; break;
      case 'pressure': s.pressures++; break;
      case 'foul': s.fouls++; break;
      case 'card': if (e.data.color === 'yellow') s.yellow++; else s.red++; break;
      case 'corner': s.corners++; break;
      case 'save': s.saves++; break;
      default: break;
    }
  }

  const total = t.home.passes + t.away.passes || 1;
  for (const side of ['home', 'away']) {
    const s = t[side];
    s.xg = Math.round(s.xg * 100) / 100;
    s.passAccuracy = s.passes ? Math.round((s.passesComplete / s.passes) * 100) : 0;
    s.possessionPct = Math.round((s.passes / total) * 100);
  }
  const end = match.events[match.events.length - 1];
  return {
    matchId: match.meta.matchId,
    home: match.meta.teams.home.name,
    away: match.meta.teams.away.name,
    finalScore: end.data.finalScore,
    durationMin: Math.round(end.elapsed / 60),
    eventCount: match.events.length,
    stats: t,
  };
}

export function printSummary(sum) {
  const rows = [
    ['Goals', 'goals'], ['xG', 'xg'], ['Shots', 'shots'], ['On target', 'onTarget'],
    ['Possession % (pass share)', 'possessionPct'], ['Passes', 'passes'], ['Pass accuracy %', 'passAccuracy'],
    ['Progressive passes', 'progressivePasses'], ['Crosses', 'crosses'], ['Carries', 'carries'],
    ['Sprints', 'sprints'], ['Pressures', 'pressures'], ['Tackles (won)', null], ['Interceptions', 'interceptions'],
    ['Fouls', 'fouls'], ['Yellow / red', null], ['Corners', 'corners'], ['Saves', 'saves'],
  ];
  const h = sum.stats.home;
  const a = sum.stats.away;
  const lines = [];
  lines.push(`${sum.home} ${sum.finalScore.home} - ${sum.finalScore.away} ${sum.away}`);
  lines.push(`${sum.eventCount} events, ${sum.durationMin} min of play\n`);
  for (const [label, key] of rows) {
    let hv; let av;
    if (label.startsWith('Tackles')) { hv = `${h.tackles} (${h.tacklesWon})`; av = `${a.tackles} (${a.tacklesWon})`; }
    else if (label.startsWith('Yellow')) { hv = `${h.yellow} / ${h.red}`; av = `${a.yellow} / ${a.red}`; }
    else { hv = h[key]; av = a[key]; }
    lines.push(`${String(hv).padStart(8)}  ${label.padEnd(26)}  ${av}`);
  }
  return lines.join('\n');
}
