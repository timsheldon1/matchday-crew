// Live pitch view: all 22 players (team shape model), the ball, player tags, focus ring,
// speed alerts, and a broadcast-style lower third for the latest big AI commentary line.
import { useMemo } from 'react';
import { teamShape } from '../teamShape.js';

export default function Pitch({ state, lang, focusId, lowerThird, t, showNames }) {
  const { ball, ballTeam, carrier, meta, tags } = state;
  const color = (side) => meta?.teams[side]?.colors.primary ?? '#888';
  const accent = (side) => meta?.teams[side]?.colors.secondary ?? '#fff';
  const isFocus = focusId && carrier?.id === focusId;
  const labelLeft = ball.x > 80;
  const players = useMemo(
    () => (meta ? teamShape({ lineup: state.lineup, ball, possession: ballTeam, period: state.period, elapsed: state.elapsed, carrierId: carrier?.id }) : []),
    [meta, state.lineup, ball, ballTeam, state.period, state.elapsed, carrier?.id],
  );

  return (
    <div className="pitch-wrap">
      <svg className="pitch" viewBox="-3 -3 111 74" role="img" aria-label="Live pitch view">
        <rect x="-3" y="-3" width="111" height="74" className="pitch-grass" />
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <rect key={i} x={i * 15} y="0" width="7.5" height="68" className="pitch-stripe" />
        ))}
        <g className="pitch-lines">
          <rect x="0" y="0" width="105" height="68" />
          <line x1="52.5" y1="0" x2="52.5" y2="68" />
          <circle cx="52.5" cy="34" r="9.15" />
          <rect x="0" y="13.84" width="16.5" height="40.32" />
          <rect x="88.5" y="13.84" width="16.5" height="40.32" />
          <rect x="0" y="24.84" width="5.5" height="18.32" />
          <rect x="99.5" y="24.84" width="5.5" height="18.32" />
          <rect x="-2" y="30.34" width="2" height="7.32" />
          <rect x="105" y="30.34" width="2" height="7.32" />
        </g>
        <g className="players">
          {players.map((p) => {
            const onBall = p.id === carrier?.id;
            const focus = p.id === focusId;
            return (
              <g key={p.id} className={`player ${onBall ? 'on-ball' : ''}`} style={{ transform: `translate(${p.x}px, ${p.y}px)` }}>
                <title>{`${p.number} ${p.name} (${p.position})`}</title>
                {focus && <circle r="3.4" className="focus-ring" />}
                <circle r={onBall ? 2.1 : 1.75} fill={color(p.side)} stroke={onBall ? '#fff' : accent(p.side)} strokeWidth={onBall ? 0.55 : 0.35} />
                <text className="player-num" y="0.62" textAnchor="middle" fill={accent(p.side)}>{p.number}</text>
                {(showNames || focus) && !onBall && (
                  <text className="player-name" y="3.9" textAnchor="middle">{p.name.split(' ').at(-1)}</text>
                )}
              </g>
            );
          })}
        </g>
        <g className="ball" style={{ transform: `translate(${ball.x}px, ${ball.y}px)` }}>
          {isFocus && <circle r="4.4" className="focus-ring" />}
          <circle r="0.95" fill="#fff" stroke="#111" strokeWidth="0.25" className="ball-glow" transform="translate(1.6,1.6)" />
          {carrier && (
            <text x={labelLeft ? -3.4 : 3.4} y="-2.8" className="carrier-label" textAnchor={labelLeft ? 'end' : 'start'}>
              {carrier.number} {carrier.name}
            </text>
          )}
        </g>
      </svg>

      <div className="pitch-tags">
        {tags.map((tag) => (
          <div key={tag.id} className="pitch-tag" style={{ borderColor: color(tag.team) }}>{tag.text}</div>
        ))}
      </div>

      {lowerThird && (
        <div className="lower-third" key={lowerThird.momentId} style={{ borderColor: color(lowerThird.team ?? 'home') }}>
          <div className="lt-kicker">
            <span className="lt-clock">{lowerThird.clock}</span>
            <span>{lowerThird.teamName ?? ''}</span>
          </div>
          <div className="lt-line">{lowerThird.lines[lang] ?? lowerThird.lines.en}</div>
        </div>
      )}

      {state.status === 'idle' && <div className="pitch-empty">{t.waiting}</div>}
    </div>
  );
}
