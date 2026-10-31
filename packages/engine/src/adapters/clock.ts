import type { Clock } from '../ports';

export const systemClock: Clock = { now: () => new Date() };

/** Deterministic clock for tests and scenario runs. */
export class ManualClock implements Clock {
  constructor(private current: Date) {}

  now(): Date {
    return new Date(this.current);
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}
