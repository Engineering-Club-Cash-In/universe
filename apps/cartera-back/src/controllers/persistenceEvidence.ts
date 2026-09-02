export function countPersistedRows(results: readonly (readonly unknown[])[]): number {
  return results.reduce((count, rows) => count + rows.length, 0);
}
