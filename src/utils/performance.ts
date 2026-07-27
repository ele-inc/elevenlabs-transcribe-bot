export type PerformanceFields = Record<
  string,
  string | number | boolean | null | undefined
>;

export function elapsedMs(startedAt: number): number {
  return Math.round((performance.now() - startedAt) * 100) / 100;
}

export function logPerformance(
  event: string,
  fields: PerformanceFields,
): void {
  console.log(
    "[performance]",
    JSON.stringify({
      event,
      ...fields,
    }),
  );
}
