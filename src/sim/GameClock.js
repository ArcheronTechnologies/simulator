// Game time-of-day clock. Converts real elapsed seconds into in-game minutes
// at a configurable rate (a full 1440-minute day in `dayLengthMinutes` real
// minutes). Pure math, no THREE — unit-testable. Drives citizen schedules and
// the day/night sky.

const MINUTES_PER_DAY = 1440;
const DAYS_PER_WEEK = 7;

export class GameClock {
  /**
   * @param {object} [opts]
   * @param {number} [opts.dayLengthMinutes] real minutes per in-game day
   * @param {number} [opts.startHour] hour of day to start at (0-24)
   * @param {number} [opts.startDay] day index to start at (0=Sun..6=Sat)
   * @param {number} [opts.speed] extra speed multiplier (1 = as configured)
   */
  constructor({ dayLengthMinutes = 48, startHour = 8, startDay = 1, speed = 1 } = {}) {
    // In-game minutes advanced per real second, before the speed multiplier.
    this._gameMinutesPerRealSecond = MINUTES_PER_DAY / (dayLengthMinutes * 60);
    this.speed = speed;
    this.paused = false;
    this.minutes = startDay * MINUTES_PER_DAY + startHour * 60;
  }

  /** Advance by a real-time delta (seconds). */
  update(deltaSeconds) {
    if (this.paused) return;
    this.minutes += deltaSeconds * this._gameMinutesPerRealSecond * this.speed;
  }

  /** Minutes since midnight, [0, 1440). */
  get minutesOfDay() {
    return ((this.minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  }

  /** Hour of day as a float, [0, 24). */
  get hours() {
    return this.minutesOfDay / 60;
  }

  /** Day index [0,6] (0=Sun..6=Sat), wrapping weekly. */
  get day() {
    return ((Math.floor(this.minutes / MINUTES_PER_DAY) % DAYS_PER_WEEK) + DAYS_PER_WEEK) % DAYS_PER_WEEK;
  }

  /** Normalized time through the day, [0, 1) — for sun angle / sky lerp. */
  get normalizedDay() {
    return this.minutesOfDay / MINUTES_PER_DAY;
  }

  /** "HH:MM" for the HUD. */
  formatClock() {
    const total = Math.floor(this.minutesOfDay);
    const h = Math.floor(total / 60);
    const m = total % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  /** Jump to a specific hour on the current day (debug/testing). */
  setHour(hour) {
    const dayStart = Math.floor(this.minutes / MINUTES_PER_DAY) * MINUTES_PER_DAY;
    this.minutes = dayStart + hour * 60;
  }

  setSpeed(multiplier) {
    this.speed = multiplier;
  }

  togglePause() {
    this.paused = !this.paused;
    return this.paused;
  }
}
