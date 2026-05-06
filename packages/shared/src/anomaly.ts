export interface AnomalyResult {
  anomalous: boolean;
  mean: number;
  stddev: number;
  zScore: number;
}

export function detectLatencyAnomaly(samples: number[], current: number, minSamples = 10, threshold = 3): AnomalyResult {
  if (samples.length < minSamples) return { anomalous: false, mean: 0, stddev: 0, zScore: 0 };
  const mean = samples.reduce((sum, item) => sum + item, 0) / samples.length;
  const variance = samples.reduce((sum, item) => sum + (item - mean) ** 2, 0) / samples.length;
  const stddev = Math.sqrt(variance);
  if (stddev === 0) return { anomalous: false, mean, stddev, zScore: 0 };
  const zScore = (current - mean) / stddev;
  return { anomalous: zScore >= threshold, mean, stddev, zScore };
}
