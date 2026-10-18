/**
 * Converts a dBFS value to a normalised audio level in 0..1.
 *
 * Silence floor is -50 dBFS; 0 dBFS is peak (1.0).
 * Any value <= -50 dBFS, undefined, or NaN maps to 0.0.
 * Any value >= 0 dBFS maps to 1.0.
 */
export function dbfsToLevel(db: number | undefined): number {
  if (db === undefined || Number.isNaN(db) || db <= -50) {
    return 0;
  }
  if (db >= 0) {
    return 1;
  }
  return (db + 50) / 50;
}
