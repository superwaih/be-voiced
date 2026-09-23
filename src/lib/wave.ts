/** Waveform peaks are stored at 20 values per second (see media.rs). */
export const PEAK_RATE = 20;

/** Reduce a time range of peaks to `bins` values between 0 and 1 (max per bin). */
export function sampleWave(peaks: Uint8Array | number[] | null | undefined, start: number, end: number, bins: number): number[] {
  if (!peaks || !peaks.length || end <= start || bins <= 0) return [];
  const out: number[] = new Array(bins);
  const from = Math.max(0, start * PEAK_RATE);
  const to = Math.min(peaks.length, end * PEAK_RATE);
  const span = Math.max(1e-6, to - from);
  for (let b = 0; b < bins; b++) {
    const i0 = Math.floor(from + (span * b) / bins);
    const i1 = Math.max(i0 + 1, Math.ceil(from + (span * (b + 1)) / bins));
    let max = 0;
    for (let i = i0; i < Math.min(i1, peaks.length); i++) if (peaks[i] > max) max = peaks[i];
    out[b] = max / 255;
  }
  return out;
}

/** Stored waves are quantised to 0..99 to keep meta.json small. */
export const packWave = (values: number[]) => values.map((v) => Math.round(v * 99));
export const unpackWave = (values: number[] | undefined) => (values ?? []).map((v) => v / 99);
