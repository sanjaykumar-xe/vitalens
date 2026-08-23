/**
 * VitaLens Client-Side Digital Signal Processing (DSP) Engine
 * 
 * Implements:
 * 1. Resampling onto uniform 30 Hz time grid.
 * 2. 4th-order zero-phase Butterworth Bandpass Filter (0.7 Hz - 4.0 Hz / 42 - 240 BPM).
 * 3. Hanning Windowing + Radix-2 FFT with parabolic sub-bin frequency interpolation.
 * 4. Systolic pulse peak detection with dynamic prominence thresholding (0.30 * sigma).
 * 5. Physiological RR interval filtering (300ms - 1500ms, +-35% median filter).
 * 6. Rolling 30s SDNN & Personal Baseline Stress evaluation.
 */

// Biquad SOS coefficients for Fs = 30 Hz:
// Highpass: fc = 0.7 Hz, 2nd order Butterworth
const HP_B = [0.9015131895029912, -1.8030263790059824, 0.9015131895029912];
const HP_A = [1.0, -1.7933030915845394, 0.8127496664274267];

// Lowpass: fc = 4.0 Hz, 2nd order Butterworth
const LP_B = [0.108447438890226, 0.216894877780452, 0.108447438890226];
const LP_A = [1.0, -0.8772706323073944, 0.3110603878682986];

function biquadFilter(input, b, a) {
  const n = input.length;
  const output = new Float64Array(n);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < n; i++) {
    const x0 = input[i];
    const y0 = b[0] * x0 + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2;
    output[i] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }
  return output;
}

function filtfilt(input, b, a) {
  // Forward pass
  const forward = biquadFilter(input, b, a);
  // Reverse
  const reversed = new Float64Array(forward.length);
  for (let i = 0; i < forward.length; i++) {
    reversed[i] = forward[forward.length - 1 - i];
  }
  // Backward pass
  const backward = biquadFilter(reversed, b, a);
  // Reverse back
  const result = new Float64Array(backward.length);
  for (let i = 0; i < backward.length; i++) {
    result[i] = backward[backward.length - 1 - i];
  }
  return result;
}

function butterworthBandpass(signal) {
  // Chain HP and LP with zero phase forward-backward filtering
  const hpFiltered = filtfilt(signal, HP_B, HP_A);
  const bpFiltered = filtfilt(hpFiltered, LP_B, LP_A);
  return bpFiltered;
}

function resampleSignal(timestamps, values, targetFs = 30.0) {
  if (timestamps.length < 2) return { tResampled: [], vResampled: [] };
  const tStart = timestamps[0];
  const tEnd = timestamps[timestamps.length - 1];
  const duration = tEnd - tStart;
  if (duration <= 0) return { tResampled: [], vResampled: [] };

  const numSamples = Math.floor(duration * targetFs);
  if (numSamples < 2) return { tResampled: [], vResampled: [] };

  const tResampled = new Float64Array(numSamples);
  const vResampled = new Float64Array(numSamples);
  const dt = 1.0 / targetFs;

  let srcIdx = 0;
  for (let i = 0; i < numSamples; i++) {
    const t = tStart + i * dt;
    tResampled[i] = t;

    while (srcIdx < timestamps.length - 2 && timestamps[srcIdx + 1] < t) {
      srcIdx++;
    }

    const t0 = timestamps[srcIdx];
    const t1 = timestamps[srcIdx + 1] || t0;
    const v0 = values[srcIdx];
    const v1 = values[srcIdx + 1] || v0;

    if (t1 === t0) {
      vResampled[i] = v0;
    } else {
      const alpha = (t - t0) / (t1 - t0);
      vResampled[i] = v0 + alpha * (v1 - v0);
    }
  }

  return { tResampled, vResampled };
}

// Cooley-Tukey Radix-2 In-Place FFT
function fft(real, imag) {
  const n = real.length;
  if (n <= 1) return;

  // Bit reversal
  let j = 0;
  for (let i = 0; i < n - 1; i++) {
    if (i < j) {
      const tempR = real[i]; real[i] = real[j]; real[j] = tempR;
      const tempI = imag[i]; imag[i] = imag[j]; imag[j] = tempI;
    }
    let k = n >> 1;
    while (k <= j) {
      j -= k;
      k >>= 1;
    }
    j += k;
  }

  // Butterfly computation
  for (let len = 2; len <= n; len <<= 1) {
    const halfLen = len >> 1;
    const angle = (-2.0 * Math.PI) / len;
    const wStepR = Math.cos(angle);
    const wStepI = Math.sin(angle);

    for (let i = 0; i < n; i += len) {
      let wR = 1.0;
      let wI = 0.0;
      for (let k = 0; k < halfLen; k++) {
        const uR = real[i + k];
        const uI = imag[i + k];
        const vR = real[i + k + halfLen] * wR - imag[i + k + halfLen] * wI;
        const vI = real[i + k + halfLen] * wI + imag[i + k + halfLen] * wR;

        real[i + k] = uR + vR;
        imag[i + k] = uI + vI;
        real[i + k + halfLen] = uR - vR;
        imag[i + k + halfLen] = uI - vI;

        const nextWR = wR * wStepR - wI * wStepI;
        wI = wR * wStepI + wI * wStepR;
        wR = nextWR;
      }
    }
  }
}

function computeHeartRateBPM(filteredSignal, fs = 30.0) {
  const n = filteredSignal.length;
  if (n < 60) return null; // need at least 2s of signal

  // Zero-pad to next power of 2 for fine FFT bin resolution
  let nFft = 512;
  while (nFft < n) nFft <<= 1;
  if (nFft < 1024) nFft = 1024;

  const real = new Float64Array(nFft);
  const imag = new Float64Array(nFft);

  // Apply Hanning window
  for (let i = 0; i < n; i++) {
    const hann = 0.5 * (1.0 - Math.cos((2.0 * Math.PI * i) / (n - 1)));
    real[i] = filteredSignal[i] * hann;
  }

  fft(real, imag);

  // Power spectrum in physiological heart rate band (0.7 Hz to 3.0 Hz / 42 to 180 BPM)
  const minFreq = 0.7;
  const maxFreq = 3.0;
  const df = fs / nFft;

  let maxPower = -1;
  let peakBin = -1;

  const minBin = Math.max(1, Math.floor(minFreq / df));
  const maxBin = Math.min(nFft / 2 - 1, Math.ceil(maxFreq / df));

  for (let k = minBin; k <= maxBin; k++) {
    const power = real[k] * real[k] + imag[k] * imag[k];
    if (power > maxPower) {
      maxPower = power;
      peakBin = k;
    }
  }

  if (peakBin <= minBin || peakBin >= maxBin || maxPower <= 0) {
    return null;
  }

  // Parabolic sub-bin interpolation for ultra-precise peak frequency
  const pPrev = Math.log(real[peakBin - 1] ** 2 + imag[peakBin - 1] ** 2 + 1e-12);
  const pCurr = Math.log(maxPower + 1e-12);
  const pNext = Math.log(real[peakBin + 1] ** 2 + imag[peakBin + 1] ** 2 + 1e-12);

  const delta = (0.5 * (pPrev - pNext)) / (pPrev - 2 * pCurr + pNext);
  const refinedBin = peakBin + (isFinite(delta) ? Math.max(-0.5, Math.min(0.5, delta)) : 0);
  const peakFreq = refinedBin * df;
  const bpm = peakFreq * 60.0;

  return bpm >= 40 && bpm <= 200 ? bpm : null;
}

function computeSDNN(filteredSignal, fs = 30.0) {
  const n = filteredSignal.length;
  if (n < 90) return null; // minimum 3s

  // Mean & Std Dev
  let sum = 0, sumSq = 0;
  for (let i = 0; i < n; i++) {
    sum += filteredSignal[i];
    sumSq += filteredSignal[i] * filteredSignal[i];
  }
  const mean = sum / n;
  const variance = Math.max(0, sumSq / n - mean * mean);
  const std = Math.sqrt(variance);

  // Dynamic prominence threshold
  const minHeight = mean + 0.30 * std;
  const minDistance = Math.floor(fs * 0.33); // max 180 BPM => min distance ~10 frames

  const peakIndices = [];
  for (let i = 1; i < n - 1; i++) {
    if (filteredSignal[i] > filteredSignal[i - 1] && filteredSignal[i] > filteredSignal[i + 1]) {
      if (filteredSignal[i] > minHeight) {
        if (peakIndices.length === 0 || i - peakIndices[peakIndices.length - 1] >= minDistance) {
          peakIndices.push(i);
        } else if (filteredSignal[i] > filteredSignal[peakIndices[peakIndices.length - 1]]) {
          peakIndices[peakIndices.length - 1] = i;
        }
      }
    }
  }

  if (peakIndices.length < 4) return null;

  // Compute inter-beat RR intervals in milliseconds
  const rawIbis = [];
  for (let i = 0; i < peakIndices.length - 1; i++) {
    const dtSeconds = (peakIndices[i + 1] - peakIndices[i]) / fs;
    rawIbis.push(dtSeconds * 1000.0);
  }

  // Filter physiological range (300ms to 1500ms)
  const validIbis = rawIbis.filter(rr => rr >= 300 && rr <= 1500);
  if (validIbis.length < 3) return null;

  // Outlier rejection (+-35% from median)
  const sorted = [...validIbis].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const cleanIbis = validIbis.filter(rr => Math.abs(rr - median) / median <= 0.35);

  if (cleanIbis.length < 3) return null;

  // Calculate SDNN
  let rrSum = 0;
  for (const rr of cleanIbis) rrSum += rr;
  const rrMean = rrSum / cleanIbis.length;

  let rrVarSum = 0;
  for (const rr of cleanIbis) rrVarSum += (rr - rrMean) ** 2;
  const sdnn = Math.sqrt(rrVarSum / (cleanIbis.length - 1));

  return sdnn;
}

/**
 * Manages 30-second resting baseline calibration & stress scoring.
 */
class BaselineCalibrator {
  constructor(calibrationSeconds = 30.0) {
    this.totalSeconds = calibrationSeconds;
    this.reset();
  }

  reset() {
    this.startTime = Date.now() / 1000;
    this.bpmSamples = [];
    this.sdnnSamples = [];
    this.baselineBpm = null;
    this.baselineSdnn = null;
    this.calibrated = false;
  }

  update(liveBpm, liveSdnn) {
    const now = Date.now() / 1000;
    const elapsed = now - this.startTime;

    if (!this.calibrated) {
      if (liveBpm != null) this.bpmSamples.push(liveBpm);
      if (liveSdnn != null) this.sdnnSamples.push(liveSdnn);

      if (elapsed >= this.totalSeconds) {
        if (this.bpmSamples.length > 0) {
          const sortedBpm = [...this.bpmSamples].sort((a, b) => a - b);
          this.baselineBpm = Math.round(sortedBpm[Math.floor(sortedBpm.length / 2)] * 10) / 10;
        }
        if (this.sdnnSamples.length > 0) {
          const sortedSdnn = [...this.sdnnSamples].sort((a, b) => a - b);
          this.baselineSdnn = Math.round(sortedSdnn[Math.floor(sortedSdnn.length / 2)] * 10) / 10;
        }
        this.calibrated = true;
      }
    }

    const remaining = Math.max(0, this.totalSeconds - elapsed);

    return {
      calibrating: !this.calibrated,
      seconds_remaining: Math.ceil(remaining),
      baseline_bpm: this.baselineBpm,
      baseline_sdnn: this.baselineSdnn,
    };
  }

  evaluateStress(liveSdnn) {
    if (!this.calibrated || this.baselineSdnn == null || liveSdnn == null) {
      return { stress_pct_deviation: null, stress_label: null };
    }

    const pctDeviation = ((liveSdnn - this.baselineSdnn) / this.baselineSdnn) * 100.0;
    const roundedPct = Math.round(pctDeviation * 10) / 10;

    let label = "Low";
    if (roundedPct < -35.0) {
      label = "Elevated";
    } else if (roundedPct < -15.0) {
      label = "Moderate";
    }

    return {
      stress_pct_deviation: roundedPct,
      stress_label: label,
    };
  }
}

window.VitaLensDSP = {
  resampleSignal,
  butterworthBandpass,
  computeHeartRateBPM,
  computeSDNN,
  BaselineCalibrator,
};
