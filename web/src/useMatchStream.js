// Connects to the server's live stream and keeps the whole match state for the UI.
import { useCallback, useEffect, useReducer, useRef } from 'react';

const ALWAYS_SHOW = new Set(['goal', 'half_time', 'full_time', 'red_card', 'penalty_awarded']);
const FEED_MIN_IMPORTANCE = 0.4; // same threshold the crew uses

const initial = {
  status: 'idle',
  meta: null,
  ball: { x: 52.5, y: 34 },
  ballTeam: null,
  carrier: null,
  clock: '00:00',
  period: 1,
  elapsed: 0,
  lineup: { home: [], away: [] }, // players currently on the pitch
  score: { home: 0, away: 0 },
  stats: null,
  momentum: [],
  feed: [], // analyst moments, filled in by crew commentary when it arrives
  tags: [], // short-lived pitch tags (speed alerts, rocket shots)
  lastCommentary: null,
  recap: null,
  crewReport: null,
  error: null,
};

function reducer(state, action) {
  switch (action.type) {
    case 'reset':
      return { ...initial, status: 'connecting' };
    case 'meta':
      return {
        ...state,
        meta: action.meta,
        status: 'live',
        lineup: {
          home: action.meta.teams.home.players.filter((p) => p.starter),
          away: action.meta.teams.away.players.filter((p) => p.starter),
        },
      };
    case 'event': {
      const ev = action.ev;
      const next = { ...state, clock: ev.clock.display, period: ev.period, score: ev.score, elapsed: ev.elapsed };
      if (ev.type === 'substitution') {
        const side = ev.team;
        next.lineup = {
          ...state.lineup,
          [side]: state.lineup[side].map((p) => (p.id === ev.data.playerOut.id ? { ...ev.data.playerIn, position: ev.data.playerIn.position } : p)),
        };
      }
      if (ev.type === 'card' && ev.data.color === 'red') {
        next.lineup = { ...state.lineup, [ev.team]: state.lineup[ev.team].filter((p) => p.id !== ev.player.id) };
      }
      const end = ev.data?.endLocation;
      if (end) next.ball = end;
      else if (ev.location) next.ball = ev.location;
      if (ev.possession?.team) next.ballTeam = ev.possession.team;
      if (ev.type === 'pass' && ev.data.recipient) next.carrier = { ...ev.data.recipient, team: ev.team };
      else if (ev.player && ['carry', 'kickoff', 'interception', 'possession_change', 'shot'].includes(ev.type)) next.carrier = { ...ev.player, team: ev.team };
      return next;
    }
    case 'stats': {
      const s = action.stats;
      const elapsed = action.elapsed ?? 0;
      return {
        ...state,
        stats: s,
        momentum: [...state.momentum, { elapsed, value: s.momentum.index }],
      };
    }
    case 'moment': {
      const m = action.moment;
      let tags = state.tags;
      if (m.type === 'speed_alert' || m.type === 'rocket_shot') {
        tags = [...tags.slice(-3), { id: m.id, team: m.team, text: m.headline, at: Date.now() }];
      }
      const inFeed = m.importance >= FEED_MIN_IMPORTANCE || ALWAYS_SHOW.has(m.type);
      return {
        ...state,
        tags,
        feed: inFeed ? [{ moment: m, commentary: null }, ...state.feed].slice(0, 60) : state.feed,
      };
    }
    case 'commentary': {
      const c = action.commentary;
      const found = state.feed.some((f) => f.moment.id === c.momentId);
      const feed = found
        ? state.feed.map((f) => (f.moment.id === c.momentId ? { ...f, commentary: c } : f))
        : [{ moment: { id: c.momentId, ...c }, commentary: c }, ...state.feed];
      const isRecap = c.type === 'half_time' || c.type === 'full_time';
      return { ...state, feed, lastCommentary: c, recap: isRecap ? c : state.recap };
    }
    case 'expireTags':
      return { ...state, tags: state.tags.filter((t) => Date.now() - t.at < 4000) };
    case 'crewReport':
      return { ...state, crewReport: action.report };
    case 'done':
      return { ...state, status: 'done' };
    case 'error':
      return { ...state, status: 'error', error: action.error };
    case 'closeRecap':
      return { ...state, recap: null };
    default:
      return state;
  }
}

export function useMatchStream() {
  const [state, dispatch] = useReducer(reducer, initial);
  const sourceRef = useRef(null);
  const elapsedRef = useRef(0);

  const stop = useCallback(() => {
    sourceRef.current?.close();
    sourceRef.current = null;
  }, []);

  const start = useCallback(({ seed, home, away, speed, persona, langs }) => {
    stop();
    dispatch({ type: 'reset' });
    elapsedRef.current = 0;
    const qs = new URLSearchParams({ home, away, speed: String(speed), crew: '1', langs: langs.join(','), persona });
    const es = new EventSource(`/matches/${encodeURIComponent(seed)}/stream?${qs}`);
    sourceRef.current = es;
    const parse = (fn) => (e) => fn(JSON.parse(e.data));
    es.addEventListener('meta', parse((meta) => dispatch({ type: 'meta', meta })));
    es.addEventListener('match_event', parse((ev) => { elapsedRef.current = ev.elapsed; dispatch({ type: 'event', ev }); }));
    es.addEventListener('stats', parse((stats) => dispatch({ type: 'stats', stats, elapsed: elapsedRef.current })));
    es.addEventListener('moment', parse((moment) => dispatch({ type: 'moment', moment })));
    es.addEventListener('commentary', parse((commentary) => dispatch({ type: 'commentary', commentary })));
    es.addEventListener('crew_report', parse((report) => dispatch({ type: 'crewReport', report })));
    es.addEventListener('done', () => { dispatch({ type: 'done' }); stop(); });
    es.onerror = () => {
      // EventSource reconnects by itself and resumes from Last-Event-ID. Only report a hard failure.
      if (es.readyState === EventSource.CLOSED) dispatch({ type: 'error', error: 'Connection lost' });
    };
  }, [stop]);

  useEffect(() => {
    const t = setInterval(() => dispatch({ type: 'expireTags' }), 1000);
    return () => { clearInterval(t); stop(); };
  }, [stop]);

  return { state, start, stop, closeRecap: () => dispatch({ type: 'closeRecap' }) };
}
