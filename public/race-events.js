// Plain-language race-control entries. Pure functions: the UI decides how to show them.
// Every entry keeps the provider's original message, so nothing is lost by rewording.
// Wording rules only restate what the message says; anything unrecognised stays as written.

const sentence = text => {
  const clean = String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
  return clean ? clean[0].toUpperCase() + clean.slice(1) : '';
};
// Car numbers named in a message, in order, plus the record's own driver_number.
export function eventDrivers(event) {
  const message = event.message || '', found = [];
  for (const match of message.matchAll(/\bCARS?\s+(\d+)|\bAND\s+(\d+)\s*\(/gi)) {
    const number = Number(match[1] ?? match[2]);
    if (!found.includes(number)) found.push(number);
  }
  if (Number.isInteger(event.driver_number) && !found.includes(event.driver_number)) found.push(event.driver_number);
  return found;
}
// The local time some messages carry, e.g. "(14:50:05)" at the end.
export function messageLocalTime(message) {
  return String(message || '').match(/\((\d{2}:\d{2}:\d{2})\)\s*$/)?.[1] ?? null;
}
const reasonOf = message => {
  const text = String(message || '').replace(/\s*\(\d{2}:\d{2}:\d{2}\)\s*$/, '');
  const index = text.indexOf(' - ');
  return index >= 0 ? sentence(text.slice(index + 3)) : '';
};

// kind: penalty | stewards | race | safety | flag | yellow | limits | blue | other
// key: shown in "Key moments" by default.
export function describeEvent(event, nameOf = n => `Car ${n}`) {
  const message = String(event.message || ''), upper = message.toUpperCase(), flag = (event.flag || '').toUpperCase();
  const drivers = eventDrivers(event), names = drivers.map(nameOf);
  const who = names.length ? ' · ' + names.join(' & ') : '';
  const base = {drivers, original: message, local: messageLocalTime(message)};
  if (flag === 'BLUE') return {...base, kind: 'blue', key: false, title: `Blue flag${who}`, detail: 'Shown to a car about to be lapped'};
  if (flag === 'RED' || upper === 'SESSION ABORTED') return {...base, kind: 'safety', key: true, title: 'Red flag', detail: sentence(message)};
  if (event.category === 'SafetyCar' || /\bSAFETY CAR\b|\bVSC\b/.test(upper)) {
    const virtual = /\bVSC\b|VIRTUAL/.test(upper);
    const ending = /ENDING|IN THIS LAP|WITHDRAWN/.test(upper);
    return {...base, kind: 'safety', key: true, title: `${virtual ? 'Virtual safety car' : 'Safety car'} ${ending ? 'ending' : 'deployed'}`, detail: sentence(message)};
  }
  if (/PENALTY SERVED/.test(upper)) {
    const what = message.match(/PENALTY SERVED\s*-\s*(.*?)(\s+FOR\s+CAR|\s*\(|$)/i)?.[1];
    return {...base, kind: 'penalty', key: true, title: `Penalty served${who}`, detail: sentence(what || 'Penalty served')};
  }
  if (/\bPENALTY\b|DRIVE THROUGH|STOP AND GO|\bREPRIMAND\b|DISQUALIFIED/.test(upper) && !/NO FURTHER|NOTED|UNDER INVESTIGATION|WILL BE INVESTIGATED/.test(upper)) {
    const seconds = upper.match(/(\d+)\s+SECOND\s+(TIME|STOP\/GO)?\s*PENALTY/);
    const label = seconds ? `${seconds[1]}-second ${seconds[2] === 'STOP/GO' ? 'stop/go ' : ''}penalty`
      : /DRIVE THROUGH/.test(upper) ? 'Drive-through penalty'
      : /STOP AND GO/.test(upper) ? 'Stop-and-go penalty'
      : /GRID/.test(upper) ? 'Grid penalty'
      : /REPRIMAND/.test(upper) ? 'Reprimand'
      : /DISQUALIFIED/.test(upper) ? 'Disqualified'
      : 'Penalty';
    return {...base, kind: 'penalty', key: true, title: label + who, detail: reasonOf(message) || sentence(message)};
  }
  if (/WILL BE INVESTIGATED AFTER/.test(upper)) return {...base, kind: 'stewards', key: true, title: `Investigation after the race${who}`, detail: reasonOf(message) || 'Incident'};
  if (/UNDER INVESTIGATION/.test(upper)) return {...base, kind: 'stewards', key: false, title: `Under investigation${who}`, detail: reasonOf(message) || 'Incident'};
  if (/NO FURTHER (ACTION|INVESTIGATION)/.test(upper)) return {...base, kind: 'stewards', key: false, title: `No further action${who}`, detail: reasonOf(message) || 'Reviewed by the stewards'};
  if (/\bNOTED\b/.test(upper)) return {...base, kind: 'stewards', key: false, title: `Incident noted${who}`, detail: reasonOf(message) || 'Noted by the stewards'};
  if (/TRACK LIMITS/.test(upper) && /DELETED|REINSTATED/.test(upper)) {
    const lap = upper.match(/\bLAP\s+(\d+)/)?.[1], corner = upper.match(/TURN\s+(\d+)/)?.[1];
    const reinstated = /REINSTATED/.test(upper);
    return {...base, kind: 'limits', key: false, title: `${reinstated ? 'Lap time reinstated' : 'Lap time deleted'}${who}`, detail: `Track limits${corner ? ' at turn ' + corner : ''}${lap ? ' · lap ' + lap : ''}`};
  }
  if (flag === 'BLACK AND WHITE') return {...base, kind: 'flag', key: true, title: `Black-and-white flag${who}`, detail: reasonOf(message) || 'Warning'};
  if (flag === 'BLACK' || flag === 'BLACK AND ORANGE') return {...base, kind: 'flag', key: true, title: `${flag === 'BLACK' ? 'Black' : 'Black-and-orange'} flag${who}`, detail: reasonOf(message) || sentence(message)};
  if (flag === 'YELLOW' || flag === 'DOUBLE YELLOW') {
    const sector = upper.match(/SECTOR\s+(\d+)/)?.[1];
    return {...base, kind: 'yellow', key: false, title: flag === 'DOUBLE YELLOW' ? 'Double yellow flag' : 'Yellow flag', detail: sector ? `Track sector ${sector}` : sentence(message)};
  }
  if (flag === 'CHEQUERED') return {...base, kind: 'race', key: true, title: 'Chequered flag', detail: 'End of the race'};
  if (flag === 'GREEN' || flag === 'CLEAR') return {...base, kind: 'other', key: false, title: flag === 'GREEN' ? 'Green flag' : 'Track clear', detail: sentence(message)};
  if (upper === 'RACE START' || (event.category === 'SessionStatus' && /STARTED/.test(upper))) return {...base, kind: 'race', key: upper === 'RACE START', title: 'Race start', detail: sentence(message)};
  if (event.category === 'SessionStatus') return {...base, kind: 'race', key: false, title: sentence(message), detail: 'Session status'};
  const aid = upper.match(/^(OVERTAKE|DRS)\s+(ENABLED|DISABLED)$/);
  if (aid) return {...base, kind: 'race', key: true, title: `${aid[1] === 'DRS' ? 'DRS' : 'Overtake mode'} ${aid[2].toLowerCase()}`, detail: aid[2] === 'ENABLED' ? 'Available to drivers from here' : 'Switched off by race control'};
  if (/^(LOW|NORMAL) GRIP CONDITIONS$/.test(upper)) return {...base, kind: 'race', key: true, title: sentence(message), detail: 'Declared by race control'};
  return {...base, kind: 'other', key: false, title: sentence(message), detail: ''};
}

// Laps on which DRS / overtake mode was switched off, from enable/disable messages.
export function aidOffBands(entries, maxLap) {
  const bands = []; let off = null;
  for (const entry of [...entries].sort((a, b) => a.time - b.time)) {
    const match = entry.original.toUpperCase().match(/^(OVERTAKE|DRS)\s+(ENABLED|DISABLED)$/);
    if (!match || !Number.isInteger(entry.lap)) continue;
    if (match[2] === 'DISABLED' && off == null) off = entry.lap;
    if (match[2] === 'ENABLED') { bands.push({from: off ?? 1, to: Math.max(off ?? 1, entry.lap - 1)}); off = null; }
  }
  if (off != null) bands.push({from: off, to: maxLap});
  return bands.filter(b => b.to >= b.from);
}

export function trackLimitCounts(entries) {
  const counts = new Map();
  for (const entry of entries) if (entry.kind === 'limits' && entry.title.startsWith('Lap time deleted') && entry.drivers.length) counts.set(entry.drivers[0], (counts.get(entry.drivers[0]) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}
