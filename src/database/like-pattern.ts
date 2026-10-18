/** A `LIKE` pattern that matches the value anywhere, with its own `%`, `_` and `\` taken literally. */
export function containsPattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}
