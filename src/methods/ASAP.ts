import { calculateMean, calculateSMA, calculateSTD } from '../utils';
import { fft, inverseFFT } from '../fft';

const findWindowSize = (
  head: number,
  tail: number,
  data: number[],
  minObj: number,
  originalKurt: number,
  windowSize: number,
): number => {
  while (head <= tail) {
    const w = Math.round((head + tail) / 2);
    const smoothed = calculateSMA(data, w, 1);
    const metrics = new Metrics(smoothed);
    if (metrics.kurtosis() >= originalKurt) {
      /* Search second half if feasible */
      const roughness = metrics.roughness();
      if (roughness < minObj) {
        windowSize = w;
        minObj = roughness;
      }
      head = w + 1;
    } else {
      /* Search first half */
      tail = w - 1;
    }
  }
  return windowSize;
};

class ACF {
  private readonly CORR_THRESH: number = 0.2;

  public readonly correlations: number[];

  public readonly mean: number;

  public maxACF = 0;

  constructor(public readonly values: number[], maxLag: number) {
    this.mean = calculateMean(values);
    this.correlations = new Array(maxLag);

    this.calculate();
  }

  calculate(): void {
    /* Padding to the closest power of 2 */
    const len = Math.pow(2, Math.trunc(Math.log2(this.values.length)) + 1);
    const fftreal = new Array(len).fill(0);
    const fftimg = new Array(len).fill(0);

    for (let i = 0; i < this.values.length; i += 1) {
      fftreal[i] = this.values[i] - this.mean;
    }

    /* F_R(f) = FFT(X) */
    fft(fftreal, fftimg);

    /* S(f) = F_R(f)F_R*(f) */
    for (let i = 0; i < fftreal.length; i += 1) {
      fftreal[i] = Math.pow(fftreal[i], 2) + Math.pow(fftimg[i], 2);
      fftimg[i] = 0;
    }

    /*  R(t) = IFFT(S(f)) */
    inverseFFT(fftreal, fftimg);
    for (let i = 1; i < this.correlations.length; i += 1) {
      this.correlations[i] = fftreal[i] / fftreal[0];
    }
  }

  findPeaks() {
    const peakIndices = [];
    if (this.correlations.length > 1) {
      let positive = this.correlations[1] > this.correlations[0];
      let max = 1;
      for (let i = 2; i < this.correlations.length; i += 1) {
        if (!positive && this.correlations[i] > this.correlations[i - 1]) {
          max = i;
          positive = !positive;
        } else if (positive && this.correlations[i] > this.correlations[max]) {
          max = i;
        } else if (positive && this.correlations[i] < this.correlations[i - 1]) {
          if (max > 1 && this.correlations[max] > this.CORR_THRESH) {
            peakIndices.push(max);
            if (this.correlations[max] > this.maxACF) {
              this.maxACF = this.correlations[max];
            }
          }
          positive = !positive;
        }
      }
    }
    /* If there is no autocorrelation peak within the MAX_WINDOW boundary try windows from the largest to the smallest */
    if (peakIndices.length <= 1) {
      for (let i = 2; i < this.correlations.length; i += 1) {
        peakIndices.push(i);
      }
    }

    return peakIndices;
  }
}

class Metrics {
  public readonly len: number;

  public readonly mean: number;

  constructor(public readonly values: number[]) {
    this.len = values.length;
    this.mean = calculateMean(values);
  }

  kurtosis(): number {
    let u4 = 0;
    let variance = 0;
    for (let i = 0; i < this.len; i++) {
      u4 += Math.pow(this.values[i] - this.mean, 4);
      variance += Math.pow(this.values[i] - this.mean, 2);
    }
    return (this.len * u4) / Math.pow(variance, 2);
  }

  roughness(): number {
    return calculateSTD(this.diffs());
  }

  diffs(): number[] {
    const diff = new Array(this.len - 1);
    for (let i = 1; i < this.len; i += 1) {
      diff[i - 1] = this.values[i] - this.values[i - 1];
    }
    return diff;
  }
}

export function ASAP(data: number[], resolution: number) {
  /* Ignore the last value if it's NaN */
  if (isNaN(data[data.length - 1])) {
    data = data.slice(0, -1);
  }

  if (data.length >= 2 * resolution) {
    data = calculateSMA(data, Math.trunc(data.length / resolution), Math.trunc(data.length / resolution));
  }

  const acf = new ACF(data, Math.round(data.length / 10));
  const peaks = acf.findPeaks();
  let metrics = new Metrics(data);
  const originalKurt = metrics.kurtosis();
  let minObj = metrics.roughness();
  let windowSize = 1;
  let lb = 1;
  let largestFeasible = -1;
  let tail = data.length / 10;
  for (let i = peaks.length - 1; i >= 0; i -= 1) {
    const w = peaks[i];
    if (w < lb || w == 1) {
      break;
    } else if (Math.sqrt(1 - acf.correlations[w]) * windowSize > Math.sqrt(1 - acf.correlations[windowSize]) * w) {
      continue;
    }
    const smoothed = calculateSMA(data, w, 1);
    metrics = new Metrics(smoothed);
    const roughness = metrics.roughness();
    if (metrics.kurtosis() >= originalKurt) {
      if (roughness < minObj) {
        minObj = roughness;
        windowSize = w;
      }
      lb = Math.round(Math.max(w * Math.sqrt((acf.maxACF - 1) / (acf.correlations[w] - 1)), lb));
      if (largestFeasible < 0) {
        largestFeasible = i;
      }
    }
  }
  if (largestFeasible > 0) {
    if (largestFeasible < peaks.length - 2) {
      tail = peaks[largestFeasible + 1];
    }
    lb = Math.max(lb, peaks[largestFeasible] + 1);
  }

  windowSize = findWindowSize(lb, tail, data, minObj, originalKurt, windowSize);

  return calculateSMA(data, windowSize, 1);
}