export default function ScoreBar({ state, t, follow }) {
  const { meta, score, clock, status, stats } = state;
  if (!meta) return <div className="scorebar placeholder">Matchday Crew</div>;
  const team = (side) => meta.teams[side];
  const mom = stats?.momentum?.index ?? 0;
  const rhythm = stats?.rhythm ?? 'normal';
  const badge = status === 'done' ? t.fullTime : t.live;

  return (
    <div className="scorebar">
      <div className={`sb-team home ${follow === 'home' ? 'followed' : ''}`}>
        <span className="sb-swatch" style={{ background: team('home').colors.primary }} />
        <span className="sb-name">{team('home').name}</span>
      </div>
      <div className="sb-score">
        <span>{score.home}</span><span className="sb-dash">–</span><span>{score.away}</span>
      </div>
      <div className={`sb-team away ${follow === 'away' ? 'followed' : ''}`}>
        <span className="sb-name">{team('away').name}</span>
        <span className="sb-swatch" style={{ background: team('away').colors.primary }} />
      </div>
      <div className="sb-meta">
        <span className={`sb-badge ${status === 'done' ? 'done' : 'live'}`}>{badge}</span>
        <span className="sb-clock">{clock}</span>
      </div>
      <div className="sb-momentum" title={`${t.momentum}: ${mom}`}>
        <span className="sb-label">{t.momentum}</span>
        <div className="mom-track">
          <div className="mom-mid" />
          <div
            className="mom-fill"
            style={{
              // home is shown on the left, so home dominance grows to the left of centre
              left: mom >= 0 ? `${50 - mom * 50}%` : '50%',
              width: `${Math.abs(mom) * 50}%`,
              background: mom >= 0 ? team('home').colors.primary : team('away').colors.primary,
            }}
          />
        </div>
        <span className={`rhythm ${rhythm}`}>{t[rhythm] ?? rhythm}</span>
      </div>
    </div>
  );
}
