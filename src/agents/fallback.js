// Template text used when an AI agent fails, times out or writes something ungrounded.
// The overlay never goes blank: it shows these until the agents recover.
// Swahili and Japanese templates are short on purpose; please review them as a native speaker.

const fill = (tpl, v) => tpl.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? '');

const TEMPLATES = {
  sw: {
    goal: 'GOLI! {scorer} anafunga kwa {team}. {home} {h}-{a} {away}',
    big_chance_saved: 'Okoa kubwa! {keeper} anazuia shuti la {player}.',
    big_chance: 'Nafasi kubwa! {player} anakosa kufunga.',
    momentum_swing: '{team} wanaanza kutawala mchezo.',
    pressing_spell: '{team} wanabana juu na kurudisha mpira haraka.',
    rhythm_chaos: 'Mchezo umekuwa wa vurugu, mpira unabadilisha miliki kila mara.',
    rhythm_control: '{team} wanatuliza mchezo na kumiliki mpira.',
    penalty_awarded: 'Penalti kwa {team}!',
    red_card: 'Kadi nyekundu! {player} anatolewa nje.',
    yellow_card: 'Kadi ya njano kwa {player}.',
    xg_vs_score: '{team} wanatengeneza nafasi nyingi lakini matokeo hayaonyeshi hivyo.',
    rocket_shot: 'Shuti kali sana kutoka kwa {player}!',
    half_time: 'Mapumziko: {home} {h}-{a} {away}',
    full_time: 'Mechi imekwisha: {home} {h}-{a} {away}',
  },
  ja: {
    goal: 'ゴール！{scorer}が決めた。{home} {h}-{a} {away}',
    big_chance_saved: 'ビッグセーブ！{keeper}が{player}のシュートを阻止。',
    big_chance: '決定機！{player}、決めきれない。',
    momentum_swing: '{team}が試合の主導権を握り始めた。',
    pressing_spell: '{team}が高い位置からプレスをかけ、ボールを奪い返している。',
    rhythm_chaos: '試合は混戦模様、ボールが目まぐるしく行き来している。',
    rhythm_control: '{team}が落ち着いてボールを保持している。',
    penalty_awarded: '{team}にPK！',
    red_card: 'レッドカード！{player}が退場。',
    yellow_card: '{player}にイエローカード。',
    xg_vs_score: '{team}は多くのチャンスを作っているが、スコアには表れていない。',
    rocket_shot: '{player}の強烈なシュート！',
    half_time: 'ハーフタイム：{home} {h}-{a} {away}',
    full_time: '試合終了：{home} {h}-{a} {away}',
  },
};

function templateKey(m) {
  if (m.type === 'big_chance') return m.facts?.outcome === 'saved' ? 'big_chance_saved' : 'big_chance';
  if (m.type === 'rhythm_shift') return m.facts?.rhythm === 'chaos' ? 'rhythm_chaos' : 'rhythm_control';
  return m.type;
}

export function fallbackLine(moment, lang, meta) {
  if (lang === 'en' || !TEMPLATES[lang]) return moment.headline;
  const tpl = TEMPLATES[lang][templateKey(moment)];
  if (!tpl) return moment.headline;
  return fill(tpl, {
    team: moment.teamName ?? '',
    player: moment.players?.[0]?.name ?? '',
    scorer: moment.players?.[0]?.name ?? '',
    keeper: moment.facts?.keeper ?? '',
    home: meta.teams.home.name,
    away: meta.teams.away.name,
    h: moment.score.home,
    a: moment.score.away,
  });
}

export function fallbackExplanation(moment) {
  const f = moment.facts ?? {};
  const bits = [];
  if (f.xg != null) bits.push(`${f.xg} xG`);
  if (f.momentumIndex != null) bits.push(`momentum index ${f.momentumIndex}`);
  if (f.possessionChangesPerMinute != null) bits.push(`${f.possessionChangesPerMinute} possession changes per minute`);
  if (f.pressuresLast3Min != null) bits.push(`${f.pressuresLast3Min} pressures in 3 minutes`);
  if (f.speedKmh != null) bits.push(`${f.speedKmh} km/h`);
  return {
    why: moment.headline,
    tacticalAngle: bits.length ? bits.join(', ') : 'See live stats.',
    keyNumbers: bits.slice(0, 3),
    confidence: 'low',
  };
}

export function fallbackRecap(snapshot, lang, meta, isFull) {
  const { home, away } = snapshot.teams;
  const s = snapshot.score;
  const potm = snapshot.topPlayers?.[0]?.name ?? '';
  const en = {
    headline: `${isFull ? 'Full time' : 'Half time'}: ${meta.teams.home.name} ${s.home}-${s.away} ${meta.teams.away.name}`,
    recap: `${home.name} had ${home.possessionPct}% of the ball and ${home.shots} shots (${home.xg} xG). ` +
      `${away.name} had ${away.shots} shots (${away.xg} xG). Top performer: ${potm}.`,
  };
  const head = fallbackLine({ type: isFull ? 'full_time' : 'half_time', score: s, headline: en.headline }, lang, meta);
  return { lang, headline: head, recap: en.recap, playerOfTheMatch: potm }; // stats recap stays in English
}
