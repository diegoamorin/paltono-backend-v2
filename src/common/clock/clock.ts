/**
 * Source of the current time. Inject it instead of calling `new Date()` so tests
 * can control expirations, waiting periods and derived availability.
 */
export abstract class Clock {
  abstract now(): Date;
}

export class SystemClock extends Clock {
  now(): Date {
    return new Date();
  }
}
