// Momentum over the match: above the line favours home, below favours away.
export default function MomentumChart({ state, t }) {
  const { momentum, meta, feed } = state;
  if (!meta) return null;
  const W = 600;
  const H = 70;
  const maxT = Math.max(95 * 60, momentum.at(-1)?.elapsed ?? 0);
  const x = (e) => (e / maxT) * W;
  const y = (v) => H / 2 - v * (H / 2 - 4);
  const pts = momentum.map((p) => `${x(p.elapsed).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const area = momentum.length ? `0,${H / 2} ${pts} ${x(momentum.at(-1).elapsed).toFixed(1)},${H / 2}` : '';
  const goals = feed.filter((f) => f.moment.type === 'goal');

  return (
    <div className="momentum-chart">
      <div className="panel-title">{t.momentum}</div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Momentum timeline">
        <defs>
          <clipPath id="above"><rect x="0" y="0" width={W} height={H / 2} /></clipPath>
          <clipPath id="below"><rect x="0" y={H / 2} width={W} height={H / 2} /></clipPath>
        </defs>
        <line x1="0" y1={H / 2} x2={W} y2={H / 2} className="mc-axis" />
        <line x1={x(45 * 60)} y1="0" x2={x(45 * 60)} y2={H} className="mc-half" />
        {area && (
          <>
            <polygon points={area} clipPath="url(#above)" fill={meta.teams.home.colors.primary} opacity="0.75" />
            <polygon points={area} clipPath="url(#below)" fill={meta.teams.away.colors.primary} opacity="0.75" />
          </>
        )}
        {goals.map((g) => (
          <g key={g.moment.id} transform={`translate(${x(g.moment.elapsed)},${g.moment.team === 'home' ? 6 : H - 6})`}>
            <circle r="4.5" fill="#fff" stroke={meta.teams[g.moment.team].colors.primary} strokeWidth="2" />
          </g>
        ))}
      </svg>
      <div className="mc-legend">
        <span><i style={{ background: meta.teams.home.colors.primary }} />{meta.teams.home.shortName}</span>
        <span><i style={{ background: meta.teams.away.colors.primary }} />{meta.teams.away.shortName}</span>
        <span><i className="goal-dot" />Goal</span>
      </div>
    </div>
  );
}
