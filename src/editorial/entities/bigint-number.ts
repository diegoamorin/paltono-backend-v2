import { ValueTransformer } from 'typeorm';

/** Versions are BIGINT, which the driver reads as strings; they stay far below 2^53. */
export const bigintNumber: ValueTransformer = {
  to: (value: number | undefined) => value,
  from: (value: string | null) => (value === null ? null : Number(value)),
};
