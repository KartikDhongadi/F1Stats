export const isQualifying = session => /Qualifying|Shootout/i.test(session?.session_name || '');
export const phasePrefix = session => /Sprint/i.test(session?.session_name || '') ? 'SQ' : 'Q';
const validTime = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
const lapKey = lap => `${lap.driver_number}:${lap.lap_number}`;

// Only explicit phase-tagged session start/finish events define phase ranges.
// A resumed Q1 must not be mistaken for Q2, nor a scheduled start for an actual start.
export function phaseWindows(messages) {
  const windows = [];
  for (const phase of [1, 2, 3]) {
    const events = messages.filter(m => Number(m.qualifying_phase) === phase && Number.isFinite(Date.parse(m.date)));
    const starts = events.filter(m => m.category === 'SessionStatus' && /^SESSION STARTED$/i.test(m.message || ''));
    const finishes = events.filter(m => m.category === 'SessionStatus' && /^SESSION FINISHED$/i.test(m.message || ''));
    if (!starts.length) continue;
    windows.push({phase, start:Math.min(...starts.map(m => Date.parse(m.date))), end:finishes.length ? Math.max(...finishes.map(m => Date.parse(m.date))) : null});
  }
  return windows;
}
export function lapDeletionStates(messages) {
  const states = new Map();
  for (const m of [...messages].sort((a,b) => Date.parse(a.date)-Date.parse(b.date))) {
    const message = m.message || '';
    if (!/\b(DELETED|REINSTATED)\b/i.test(message)) continue;
    const driver = m.driver_number ?? message.match(/\bCAR\s+(\d+)\b/i)?.[1];
    const lap = m.lap_number ?? message.match(/\bLAP\s+(\d+)\b/i)?.[1];
    if (driver == null || lap == null) continue; // Never guess from a time alone.
    states.set(`${Number(driver)}:${Number(lap)}`, {deleted:! /\bREINSTATED\b/i.test(message), message});
  }
  return states;
}
export function qualifyingModel(session, drivers, laps, results, messages) {
  const windows = phaseWindows(messages), deletions = lapDeletionStates(messages);
  const ids = [...new Set([...drivers, ...laps, ...results].map(d => d.driver_number).filter(n => n != null))];
  const rows = ids.map(id => {
    const driver = drivers.find(d => d.driver_number === id) || {driver_number:id,full_name:`Driver ${id}`};
    const result = results.find(d => d.driver_number === id);
    const best = [0,1,2].map(i => Array.isArray(result?.duration) && validTime(result.duration[i]) ? result.duration[i] : null);
    const attempts = laps.filter(l => l.driver_number === id).map(lap => {
      const start = Date.parse(lap.date_start);
      const explicit = [1,2,3].includes(Number(lap.qualifying_phase)) ? Number(lap.qualifying_phase) : null;
      // Classify by lap start, allowing a lap already in progress to finish after the flag.
      const window = windows.find(w => w.end != null && start >= w.start-1000 && start <= w.end);
      const phase = explicit ?? window?.phase ?? null;
      const deletion = deletions.get(lapKey(lap));
      return {...lap, key:lapKey(lap), start, phase, deleted:deletion?.deleted || false, deletionMessage:deletion?.message || '', timed:validTime(lap.lap_duration), best:false};
    }).sort((a,b) => a.lap_number-b.lap_number);
    for (const lap of attempts) lap.best = lap.phase != null && lap.timed && !lap.deleted && !lap.is_pit_out_lap && best[lap.phase-1] != null && Math.abs(lap.lap_duration-best[lap.phase-1]) < .0015;
    return {driver,result,best,attempts};
  }).sort((a,b) => (a.result?.position ?? Infinity)-(b.result?.position ?? Infinity) || a.driver.driver_number-b.driver.driver_number);
  const starts = rows.flatMap(r => r.attempts).filter(l => Number.isFinite(l.start)).map(l => l.start);
  const first = Math.min(...starts, ...windows.map(w => w.start));
  const last = Math.max(...rows.flatMap(r => r.attempts).filter(l => Number.isFinite(l.start)).map(l => l.start+(l.timed?l.lap_duration*1000:0)), ...windows.map(w => w.end || w.start));
  return {session, rows, windows, prefix:phasePrefix(session), first:Number.isFinite(first)?first:Date.parse(session.date_start), last:Number.isFinite(last)?last:Date.parse(session.date_end)};
}
