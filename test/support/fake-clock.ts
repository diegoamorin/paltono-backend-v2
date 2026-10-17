import { Clock } from '../../src/common/clock/clock';

/** A clock that only moves when the test says so. */
export class FakeClock extends Clock {
  constructor(private current = new Date('2026-01-01T00:00:00.000Z')) {
    super();
  }

  now(): Date {
    return new Date(this.current);
  }

  set(instant: Date | string): void {
    this.current = new Date(instant);
  }

  advance(milliseconds: number): void {
    this.current = new Date(this.current.getTime() + milliseconds);
  }
}
