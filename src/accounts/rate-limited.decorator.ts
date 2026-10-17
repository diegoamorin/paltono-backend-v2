import { UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Limits requests per client address on this route, with the limit configured in
 * `AccountsModule`. Each route counts separately. The counters live in memory,
 * which holds for a single instance only (ADR 0002).
 */
export function RateLimited() {
  return UseGuards(ThrottlerGuard);
}
