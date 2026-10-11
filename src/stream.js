// Replays a generated match in (accelerated) real time.
// speed = 1 is real time, speed = 30 plays 90 minutes in about 3 minutes.

export async function* replay(events, { speed = 30, fromSeq = 0, signal } = {}) {
  const pending = events.filter((e) => e.seq > fromSeq);
  if (!pending.length) return;
  const startWall = Date.now();
  const startGame = pending[0].elapsed;
  for (const ev of pending) {
    if (signal?.aborted) return;
    const due = startWall + ((ev.elapsed - startGame) * 1000) / speed;
    const wait = due - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    yield ev;
  }
}
