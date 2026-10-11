// The match story: each Analyst moment appears instantly, then the AI crew fills in the
// commentary line (and, in Analyst view, the explanation and key numbers).
const LABEL = {
  goal: 'GOAL', big_chance: 'CHANCE', momentum_swing: 'MOMENTUM', rhythm_shift: 'RHYTHM',
  pressing_spell: 'PRESS', xg_vs_score: 'xG STORY', penalty_awarded: 'PENALTY', red_card: 'RED',
  half_time: 'HT', full_time: 'FT', rocket_shot: 'STRIKE', quality_pass: 'PASS',
};

function Card({ item, lang, view, meta, t, follow, focusId }) {
  const m = item.moment;
  const c = item.commentary;
  const side = m.team;
  const color = side ? meta.teams[side].colors.primary : '#9aa4b2';
  const fallback = c?.agents?.some((a) => a.status === 'fallback');
  const latency = c?.agents?.reduce((s, a) => s + (a.latencyMs ?? 0), 0);
  const involvesFocus = focusId && (m.players ?? []).some((p) => p.id === focusId);

  return (
    <article className={`card type-${m.type} ${follow && side === follow ? 'followed' : ''} ${involvesFocus ? 'focus' : ''}`} style={{ borderLeftColor: color }}>
      <header>
        <span className="card-type" style={{ background: color }}>{LABEL[m.type] ?? m.type}</span>
        <span className="card-clock">{m.clock}</span>
        {follow && side === follow && <span className="card-chip">{t.yourTeam}</span>}
        {c && (
          <span className={`card-ai ${fallback ? 'fb' : ''}`} title={c.agents.map((a) => `${a.agent}: ${a.status} ${a.latencyMs ?? 0}ms`).join('\n')}>
            {fallback ? t.fallback : `AI ${(latency / 1000).toFixed(1)}s`}
          </span>
        )}
      </header>
      {c ? <p className="card-line">{c.lines[lang] ?? c.lines.en}</p> : (
        <p className="card-line pending">{m.headline}<span className="thinking">{t.thinking}</span></p>
      )}
      {c && view === 'analyst' && !c.recaps && (
        <div className="card-why">
          <div className="why-label">{t.why}</div>
          <p>{c.explanation.why}</p>
          {c.explanation.tacticalAngle && <p className="angle">{c.explanation.tacticalAngle}</p>}
          <div className="chips">
            {(c.explanation.keyNumbers ?? []).map((k) => <span key={k} className="chip">{k}</span>)}
            {c.explanation.confidence && <span className={`chip conf-${c.explanation.confidence}`}>{c.explanation.confidence}</span>}
          </div>
        </div>
      )}
    </article>
  );
}

export default function Feed({ state, lang, view, t, follow, focusId }) {
  const { feed, meta } = state;
  if (!meta) return <div className="feed"><div className="panel-title">{t.feed}</div></div>;
  const items = focusId
    ? feed.filter((f) => f.moment.type === 'goal' || f.moment.type.endsWith('_time') || (f.moment.players ?? []).some((p) => p.id === focusId))
    : feed;
  return (
    <div className="feed">
      <div className="panel-title">{t.feed}</div>
      <div className="feed-list">
        {items.map((item) => (
          <Card key={item.moment.id} item={item} lang={lang} view={view} meta={meta} t={t} follow={follow} focusId={focusId} />
        ))}
      </div>
    </div>
  );
}
