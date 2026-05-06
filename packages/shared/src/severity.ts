export function parseSeverity(output: string | null | undefined): number | null {
  if (!output) return null;
  const match = output.match(/\b([1-5])\b/);
  return match ? Number(match[1]) : null;
}

export function fallbackSeverity(input: {
  isOpen: boolean;
  durationMinutes: number;
  failureRateLast5: number;
  errorCode?: string | null;
  publicMonitor: boolean;
}): number {
  if (input.isOpen && input.durationMinutes >= 30) return 5;
  if (input.isOpen && input.durationMinutes >= 10) return 4;
  if (input.failureRateLast5 >= 1 && input.publicMonitor) return 4;
  if (input.failureRateLast5 >= 0.6) return 3;
  if (!input.isOpen && input.durationMinutes <= 2) return 2;
  return 3;
}

export function applySeverityOverrides(score: number, input: Parameters<typeof fallbackSeverity>[0]): number {
  return Math.max(score, fallbackSeverity(input));
}
