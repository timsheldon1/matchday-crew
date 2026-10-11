// Stats, AI crew status and the recap modal.

export function StatsPanel({ state, t }) {
  const { stats, meta } = state;
  if (!meta || !stats) return null;
  const h = stats.teams.home;
  const a = stats.teams.away;
  const rows = [
    [t.possession, h.possessionPct, a.possessionPct, '%'],
    [t.shots, h.shots, a.shots],
    [t.onTarget, h.onTarget, a.onTarget],
    [t.xg, h.xg, a.xg],
    [t.bigChances, h.bigChances, a.bigChances],
    [t.passAcc, h.passAccuracy, a.passAccuracy, '%'],
    [t.corners, h.corners, a.corners],
  ];
  return (
    <div className="stats">
      <div className="panel-title">{meta.teams.home.shortName} · {meta.teams.away.shortName}</div>
      {rows.map(([label, hv, av, unit = '']) => {
        const total = Number(hv) + Number(av) || 1;
        return (
          <div key={label} className="stat-row">
            <span className="sv">{hv}{unit}</span>
            <div className="stat-mid">
              <span className="stat-label">{label}</span>
              <div className="stat-bar">
                <div style={{ width: `${(Number(hv) / total) * 100}%`, background: meta.teams.home.colors.primary }} />
                <div style={{ width: `${(Number(av) / total) * 100}%`, background: meta.teams.away.colors.primary }} />
              </div>
            </div>
            <span className="sv">{av}{unit}</span>
          </div>
        );
      })}
      <div className="panel-title sub">{t.topPlayers}</div>
      <ol className="top-players">
        {stats.topPlayers.slice(0, 3).map((p) => (
          <li key={p.id}>
            <span className="tp-rating">{p.rating}</span>
            <span className="tp-name">{p.name}</span>
            <span className="tp-team" style={{ color: meta.teams[p.team].colors.primary }}>{meta.teams[p.team].shortName}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function CrewPanel({ state, t }) {
  const done = state.feed.filter((f) => f.commentary);
  if (!state.meta) return null;
  const traces = done.flatMap((f) => f.commentary.agents);
  const ok = traces.filter((a) => a.status !== 'fallback');
  const fb = traces.length - ok.length;
  const lat = ok.map((a) => a.latencyMs).sort((x, y) => x - y);
  const median = lat.length ? lat[Math.floor(lat.length / 2)] : null;
  const last = done[0]?.commentary;
  const mode = state.crewReport?.mode ?? last?.agents?.[0]?.mode ?? '…';
  const steps = last
    ? [{ agent: 'analyst', status: 'ok', latencyMs: 0 }, ...last.agents]
    : [];

  return (
    <div className="crew">
      <div className="panel-title">{t.crew}</div>
      <div className="crew-pipeline">
        {steps.map((s, i) => (
          <div key={i} className={`crew-step ${s.status}`} title={s.reason ?? ''}>
            <div className="cs-name">{s.agent.replace('matchday-', '')}</div>
            <div className="cs-meta">{s.agent === 'analyst' ? 'code · instant' : `${s.status} · ${((s.latencyMs ?? 0) / 1000).toFixed(1)}s`}</div>
          </div>
        ))}
        {!steps.length && <div className="cs-empty">Analyst → Explainer → Storyteller</div>}
      </div>
      <div className="crew-stats">
        <span><b>{ok.length}</b> AI calls</span>
        <span><b>{fb}</b> fallbacks</span>
        <span><b>{median != null ? `${(median / 1000).toFixed(1)}s` : '–'}</b> median</span>
        <span>mode <b>{mode}</b></span>
      </div>
    </div>
  );
}

export function RecapModal({ recap, lang, t, onClose }) {
  if (!recap?.recaps) return null;
  const r = recap.recaps[lang] ?? recap.recaps.en;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="modal-kicker">{recap.type === 'full_time' ? t.fullTime : t.halfTime} · {t.recap}</div>
        <h2>{r.headline}</h2>
        <p>{r.recap}</p>
        <div className="modal-potm">{t.potm}: <b>{r.playerOfTheMatch}</b></div>
        <button type="button" onClick={onClose}>{t.close}</button>
      </div>
    </div>
  );
}
