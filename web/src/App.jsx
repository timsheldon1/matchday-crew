import { useEffect, useMemo, useRef, useState } from 'react';
import { createVoicePlayer } from './voicePlayer.js';
import { useMatchStream } from './useMatchStream.js';
import { UI, LANGS } from './i18n.js';
import Pitch from './components/Pitch.jsx';
import ScoreBar from './components/ScoreBar.jsx';
import MomentumChart from './components/MomentumChart.jsx';
import Feed from './components/Feed.jsx';
import { StatsPanel, CrewPanel, RecapModal } from './components/Panels.jsx';

const CLUB_OPTIONS = [
  { id: 'NNS', name: 'Nairobi Northstars' },
  { id: 'KLS', name: 'Kisumu Lakeside' },
  { id: 'RVU', name: 'Riverside United' },
  { id: 'HLA', name: 'Highland Athletic' },
];

export default function App() {
  const { state, start, closeRecap } = useMatchStream();
  const [lang, setLang] = useState('en');
  const [view, setView] = useState('fan');
  const [follow, setFollow] = useState('');
  const [focusId, setFocusId] = useState('');
  const [seed, setSeed] = useState('42');
  const [home, setHome] = useState('NNS');
  const [away, setAway] = useState('KLS');
  const [speed, setSpeed] = useState(30);
  const [lowerThird, setLowerThird] = useState(null);
  const [showNames, setShowNames] = useState(false);
  const [voiceOn, setVoiceOn] = useState(false);
  const [voiceKind, setVoiceKind] = useState(null);
  const voiceRef = useRef(null);
  if (!voiceRef.current) voiceRef.current = createVoicePlayer(setVoiceKind);
  const t = UI[lang];

  // Show big AI lines as a broadcast lower third for a few seconds.
  const last = state.lastCommentary;
  useEffect(() => {
    if (!last || last.importance < 0.6 || last.recaps) return undefined;
    setLowerThird(last);
    const timer = setTimeout(() => setLowerThird(null), 7000);
    return () => clearTimeout(timer);
  }, [last]);

  // Voice: speak big moments and recaps in the selected language.
  useEffect(() => {
    if (!voiceOn || !last) return;
    if (last.recaps) {
      const r = last.recaps[lang] ?? last.recaps.en;
      voiceRef.current.speak(`${r.headline}. ${r.recap}`, lang, 1);
    } else if (last.importance >= 0.6) {
      voiceRef.current.speak(last.lines[lang] ?? last.lines.en, lang, last.importance);
    }
  }, [last]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleVoice = () => {
    setVoiceOn((on) => {
      if (on) voiceRef.current.stop();
      return !on;
    });
  };

  const players = useMemo(() => {
    if (!state.meta) return [];
    return ['home', 'away'].flatMap((side) => state.meta.teams[side].players
      .filter((p) => p.starter)
      .map((p) => ({ ...p, side, club: state.meta.teams[side].shortName })));
  }, [state.meta]);

  const kickOff = () => {
    setFocusId('');
    voiceRef.current.stop();
    start({ seed, home, away: away === home ? CLUB_OPTIONS.find((c) => c.id !== home).id : away, speed, persona: view === 'analyst' ? 'analyst' : 'casual', langs: ['en', 'sw', 'ja'] });
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">Matchday <span>Crew</span></div>
        <div className="controls">
          <label>{t.seed}
            <select value={home} onChange={(e) => setHome(e.target.value)} aria-label="Home club">
              {CLUB_OPTIONS.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <span className="vs">vs</span>
            <select value={away} onChange={(e) => setAway(e.target.value)} aria-label="Away club">
              {CLUB_OPTIONS.filter((c) => c.id !== home).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <input value={seed} onChange={(e) => setSeed(e.target.value)} size={4} aria-label="Match seed" />
          </label>
          <label>{t.speed}
            <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
              {[10, 20, 30, 60].map((s) => <option key={s} value={s}>{s}x</option>)}
            </select>
          </label>
          <button type="button" className="primary" onClick={kickOff}>{state.status === 'idle' ? t.start : t.restart}</button>
        </div>
        <div className="toggles">
          <div className="seg" role="group" aria-label="Language">
            {LANGS.map((l) => (
              <button type="button" key={l.code} className={lang === l.code ? 'on' : ''} onClick={() => setLang(l.code)}>{l.label}</button>
            ))}
          </div>
          <button type="button" className={showNames ? 'on-btn' : ''} onClick={() => setShowNames((v) => !v)} aria-pressed={showNames}>{t.names}</button>
          <button type="button" className={voiceOn ? 'on-btn' : ''} onClick={toggleVoice} aria-pressed={voiceOn} title={voiceKind === 'azure' ? 'Azure AI Speech' : voiceKind === 'browser' ? 'Browser voice' : ''}>
            {voiceOn ? '🔊' : '🔇'} {t.voice}{voiceOn && voiceKind ? ` · ${voiceKind === 'azure' ? 'Azure' : 'browser'}` : ''}
          </button>
          <div className="seg" role="group" aria-label="View">
            <button type="button" className={view === 'fan' ? 'on' : ''} onClick={() => setView('fan')}>{t.fan}</button>
            <button type="button" className={view === 'analyst' ? 'on' : ''} onClick={() => setView('analyst')}>{t.analyst}</button>
          </div>
          {state.meta && (
            <>
              <select value={follow} onChange={(e) => setFollow(e.target.value)} aria-label={t.follow}>
                <option value="">{t.follow}: {t.none}</option>
                <option value="home">{state.meta.teams.home.name}</option>
                <option value="away">{state.meta.teams.away.name}</option>
              </select>
              <select value={focusId} onChange={(e) => setFocusId(e.target.value)} aria-label={t.focus}>
                <option value="">{t.focus}: {t.none}</option>
                {players.map((p) => <option key={p.id} value={p.id}>{p.club} · {p.number} {p.name}</option>)}
              </select>
            </>
          )}
        </div>
      </header>

      <ScoreBar state={state} t={t} follow={follow} />

      <main className="layout">
        <section className="stage">
          <Pitch state={state} lang={lang} focusId={focusId} lowerThird={lowerThird} t={t} showNames={showNames} />
          <MomentumChart state={state} t={t} />
          <div className="below">
            <StatsPanel state={state} t={t} />
            <CrewPanel state={state} t={t} />
          </div>
        </section>
        <aside className="side">
          <Feed state={state} lang={lang} view={view} t={t} follow={follow} focusId={focusId} />
        </aside>
      </main>

      {state.error && <div className="toast-error">{state.error}</div>}
      <RecapModal recap={state.recap} lang={lang} t={t} onClose={closeRecap} />
    </div>
  );
}
