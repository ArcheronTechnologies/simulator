// Pure 24-hour schedule model. Given a citizen (archetype + id for jitter) and
// a game time, returns their intended activity and anchor — with NO per-frame
// state, NO Date, NO randomness beyond deterministic id-seeded hashing. This is
// the function evaluated for the small "tracked" set near the player; the
// ~120k dormant citizens never touch it. Shared by the offline generator (for
// aggregate sanity checks) and the runtime.
import { ARCHETYPES } from './archetypes.mjs';
import { rangeHash, unitHash } from './hash.mjs';

export const MINUTES_PER_DAY = 1440;

// Activities. Stationary ones resolve to their anchor's position; Commuting
// interpolates from->to (the runtime only renders the visible ends).
export const AtHome = 'AtHome';
export const AtWork = 'AtWork';
export const Leisure = 'Leisure';
export const Commuting = 'Commuting';

const ACTIVITY_FOR_ANCHOR = { home: AtHome, work: AtWork, leisure: Leisure };

const COMMUTE_MIN = 32; // minutes we model a commute lasting (only the ends render)

function archName(citizen) {
  return typeof citizen.arch === 'number' ? ARCHETYPES[citizen.arch] : citizen.arch;
}

function isWeekend(day) {
  return day === 0 || day === 6; // 0 = Sunday, 6 = Saturday
}

/**
 * Assemble a contiguous, ordered segment list for a day from a starting anchor
 * plus a list of trips {depart, dest, dur}. Guarantees segments tile [0,1440)
 * with no gaps/overlaps regardless of jitter (trips are clamped forward).
 */
function buildDay(startAnchor, trips) {
  const segs = [];
  let cur = 0;
  let anchor = startAnchor;
  for (const trip of trips) {
    const depart = Math.min(MINUTES_PER_DAY - 1, Math.max(cur, Math.round(trip.depart)));
    const arrive = Math.min(MINUTES_PER_DAY, depart + trip.dur);
    if (depart > cur) segs.push({ start: cur, end: depart, activity: ACTIVITY_FOR_ANCHOR[anchor], from: anchor, to: anchor });
    if (arrive > depart) segs.push({ start: depart, end: arrive, activity: Commuting, from: anchor, to: trip.dest });
    cur = arrive;
    anchor = trip.dest;
  }
  if (cur < MINUTES_PER_DAY) segs.push({ start: cur, end: MINUTES_PER_DAY, activity: ACTIVITY_FOR_ANCHOR[anchor], from: anchor, to: anchor });
  return segs;
}

/** Trips for a standard commuter (worker/student/child), weekday. */
function commuterTrips(id, { leaveBase, leaveJit, workEndBase, workEndJit, leisureChance, leisureStart }) {
  const leave = leaveBase + rangeHash(id, 'leave', -leaveJit, leaveJit);
  const workEnd = workEndBase + rangeHash(id, 'end', -workEndJit, workEndJit);
  const trips = [
    { depart: leave, dest: 'work', dur: COMMUTE_MIN },
    { depart: workEnd, dest: 'home', dur: COMMUTE_MIN },
  ];
  if (leisureChance > 0 && unitHash(id, 'leisureRoll') < leisureChance) {
    const out = leisureStart + rangeHash(id, 'leisureOut', -45, 45);
    trips.push({ depart: out, dest: 'leisure', dur: 18 });
    trips.push({ depart: out + 18 + 90, dest: 'home', dur: 18 });
  }
  return trips;
}

function middayLeisureTrips(id, chance, startBase) {
  if (unitHash(id, 'midday') >= chance) return [];
  const out = startBase + rangeHash(id, 'middayOut', -60, 60);
  return [
    { depart: out, dest: 'leisure', dur: 15 },
    { depart: out + 15 + 75, dest: 'home', dur: 15 },
  ];
}

function weekdaySegments(arch, id) {
  switch (arch) {
    case 'worker':
      return buildDay('home', commuterTrips(id, {
        leaveBase: 480, leaveJit: 35, workEndBase: 1020, workEndJit: 40, leisureChance: 0.4, leisureStart: 1110,
      }));
    case 'uniStudent':
      return buildDay('home', commuterTrips(id, {
        leaveBase: 540, leaveJit: 70, workEndBase: 975, workEndJit: 90, leisureChance: 0.6, leisureStart: 1170,
      }));
    case 'schoolChild':
      return buildDay('home', commuterTrips(id, {
        leaveBase: 470, leaveJit: 20, workEndBase: 870, workEndJit: 20, leisureChance: 0.25, leisureStart: 990,
      }));
    case 'shift': {
      const roll = unitHash(id, 'shiftKind');
      if (roll < 0.34) {
        return buildDay('home', commuterTrips(id, { leaveBase: 330, leaveJit: 25, workEndBase: 840, workEndJit: 25, leisureChance: 0.2, leisureStart: 1020 }));
      }
      if (roll < 0.67) {
        return buildDay('home', commuterTrips(id, { leaveBase: 810, leaveJit: 25, workEndBase: 1320, workEndJit: 25, leisureChance: 0.15, leisureStart: 1380 }));
      }
      // Night shift: already at work at midnight, commute home ~06:00, sleep,
      // commute back ~22:00, at work through midnight.
      const homeArr = 360 + rangeHash(id, 'nightEnd', -25, 25);
      const backOut = 1290 + rangeHash(id, 'nightOut', -25, 25);
      return buildDay('work', [
        { depart: homeArr, dest: 'home', dur: COMMUTE_MIN },
        { depart: backOut, dest: 'work', dur: COMMUTE_MIN },
      ]);
    }
    case 'retiree':
      return buildDay('home', middayLeisureTrips(id, 0.7, 690));
    case 'home':
    default:
      return buildDay('home', middayLeisureTrips(id, 0.45, 780));
  }
}

function weekendSegments(arch, id) {
  // No work/school on weekends; shift workers still cover services. Everyone
  // else is home-heavy with a better chance of a daytime outing.
  if (arch === 'shift') return weekdaySegments(arch, id);
  const chance = arch === 'retiree' || arch === 'home' ? 0.6 : 0.75;
  return buildDay('home', middayLeisureTrips(id, chance, 720));
}

/** Segment list for a citizen on a given day (cached-friendly; pure). */
export function daySegments(citizen, day) {
  const arch = archName(citizen);
  return isWeekend(day) ? weekendSegments(arch, citizen.id) : weekdaySegments(arch, citizen.id);
}

/**
 * The intended state of a citizen at game time `t` (minutes 0..1440) on `day`.
 * Returns { activity, from, to, phase } where phase in [0,1] is commute
 * progress (0 for stationary activities).
 */
export function scheduleState(citizen, t, day = 1) {
  const tt = ((t % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const segs = daySegments(citizen, day);
  for (const s of segs) {
    if (tt >= s.start && tt < s.end) {
      const phase = s.activity === Commuting && s.end > s.start ? (tt - s.start) / (s.end - s.start) : 0;
      return { activity: s.activity, from: s.from, to: s.to, phase };
    }
  }
  // Numerically t==1440-epsilon should be covered; fall back to last segment.
  const last = segs[segs.length - 1];
  return { activity: last.activity, from: last.from, to: last.to, phase: 0 };
}
