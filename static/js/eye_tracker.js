/**
 * VitaLens Client-Side Eye Strain & Drowsiness Tracker
 * 
 * Features:
 * - Geometric Eye Aspect Ratio (EAR) on MediaPipe 468 landmarks.
 * - Adaptive Open-Eye Baseline Calibration: dynamically learns user's resting open EAR
 *   and sets closure cutoff to 72% of baseline (robust to eyeglasses & eye shapes).
 * - Fast 2-frame debouncing & 180ms refractory cooldown for responsive natural blink detection.
 * - Drowsiness detection on sustained closure >= 2.0s.
 * - Session total blinks counter and extrapolated rate per minute.
 */

const LEFT_EYE_INDICES = [33, 160, 158, 133, 153, 144];
const RIGHT_EYE_INDICES = [362, 385, 387, 263, 373, 380];

const DEFAULT_EAR_THRESHOLD = 0.22;
const REFRACTORY_SECONDS = 0.18;
const DROWSY_SECONDS = 2.0;
const BLINK_MIN_SECONDS = 0.05;
const BLINK_MAX_SECONDS = 0.50;
const LOW_BLINK_RATE_PER_MIN = 8;
const WARMUP_SECONDS = 15.0;

function euclideanDist(p1, p2) {
  const dx = p1.x - p2.x;
  const dy = p1.y - p2.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function calculateEAR(landmarks, indices) {
  const p1 = landmarks[indices[0]];
  const p2 = landmarks[indices[1]];
  const p3 = landmarks[indices[2]];
  const p4 = landmarks[indices[3]];
  const p5 = landmarks[indices[4]];
  const p6 = landmarks[indices[5]];

  if (!p1 || !p2 || !p3 || !p4 || !p5 || !p6) return null;

  const vertical = euclideanDist(p2, p6) + euclideanDist(p3, p5);
  const horizontal = euclideanDist(p1, p4);

  if (horizontal === 0) return null;
  return vertical / (2.0 * horizontal);
}

class ClientEyeTracker {
  constructor() {
    this.reset();
  }

  reset() {
    this.startTime = Date.now() / 1000;
    this.rawEarWindow = [];
    this.openEarSamples = [];
    this.openEarBaseline = 0.28;
    this.currentThreshold = DEFAULT_EAR_THRESHOLD;

    this.consecutiveClosed = 0;
    this.eyeClosedSince = null;
    this.drowsy = false;

    this.blinkTimestamps = [];
    this.totalBlinks = 0;

    this._closing = false;
    this._closeStart = null;
    this._potentialCloseStart = null;
    this.lastBlinkTime = 0.0;
  }

  update(landmarks) {
    const now = Date.now() / 1000;
    const leftEar = calculateEAR(landmarks, LEFT_EYE_INDICES);
    const rightEar = calculateEAR(landmarks, RIGHT_EYE_INDICES);

    if (leftEar == null || rightEar == null) {
      return this.snapshot(null);
    }

    const rawEar = (leftEar + rightEar) / 2.0;
    this.rawEarWindow.push(rawEar);
    if (this.rawEarWindow.length > 2) this.rawEarWindow.shift();

    const smoothedEar = this.rawEarWindow.reduce((a, b) => a + b, 0) / this.rawEarWindow.length;

    // Adaptive Open-Eye Calibration
    if (smoothedEar > 0.18) {
      this.openEarSamples.push(smoothedEar);
      if (this.openEarSamples.length > 150) this.openEarSamples.shift();

      if (this.openEarSamples.length >= 15) {
        const sorted = [...this.openEarSamples].sort((a, b) => a - b);
        const idx80 = Math.floor(sorted.length * 0.80);
        this.openEarBaseline = sorted[idx80];
        this.currentThreshold = Math.max(0.16, Math.min(0.27, this.openEarBaseline * 0.72));
      }
    }

    const isClosed = smoothedEar < this.currentThreshold;

    if (isClosed) {
      this.consecutiveClosed += 1;
      if (this.consecutiveClosed === 1) {
        this._potentialCloseStart = now;
      }
    } else {
      this.consecutiveClosed = 0;
    }

    const isClosedDebounced = this.consecutiveClosed >= 1;

    // Drowsiness: sustained closure >= 2.0s
    if (isClosed) {
      if (this.eyeClosedSince == null) {
        this.eyeClosedSince = this._potentialCloseStart || now;
      } else if (now - this.eyeClosedSince >= DROWSY_SECONDS) {
        this.drowsy = true;
      }
    } else {
      this.eyeClosedSince = null;
      this.drowsy = false;
    }

    // Blink detection with refractory period & onset tracking
    if (isClosedDebounced && !this._closing) {
      if (now - this.lastBlinkTime >= REFRACTORY_SECONDS) {
        this._closing = true;
        this._closeStart = this._potentialCloseStart || now;
      }
    } else if (!isClosed && this._closing) {
      this._closing = false;
      if (this._closeStart != null) {
        const closedDuration = now - this._closeStart;
        if (closedDuration >= BLINK_MIN_SECONDS && closedDuration <= BLINK_MAX_SECONDS) {
          if (now - this.lastBlinkTime >= REFRACTORY_SECONDS) {
            this.totalBlinks += 1;
            this.blinkTimestamps.push(now);
            this.lastBlinkTime = now;
          }
        }
      }
      this._closeStart = null;
      this._potentialCloseStart = null;
    } else if (!isClosed) {
      this._potentialCloseStart = null;
    }

    return this.snapshot(smoothedEar);
  }

  getBlinkRatePerMinute() {
    const now = Date.now() / 1000;
    // Clean older than 60s
    while (this.blinkTimestamps.length > 0 && now - this.blinkTimestamps[0] > 60) {
      this.blinkTimestamps.shift();
    }

    const recentCount = this.blinkTimestamps.length;
    const elapsed = now - this.startTime;

    if (elapsed < 60.0) {
      if (elapsed < 5.0 || recentCount === 0) return recentCount;
      const scale = 60.0 / elapsed;
      return Math.round(recentCount * scale);
    }

    return recentCount;
  }

  snapshot(smoothedEar) {
    const now = Date.now() / 1000;
    const blinkRate = this.getBlinkRatePerMinute();
    const elapsed = now - this.startTime;
    const eyeStrain = elapsed >= WARMUP_SECONDS && blinkRate < LOW_BLINK_RATE_PER_MIN;

    return {
      ear: smoothedEar != null ? Math.round(smoothedEar * 1000) / 1000 : null,
      open_baseline_ear: Math.round(this.openEarBaseline * 1000) / 1000,
      threshold_ear: Math.round(this.currentThreshold * 1000) / 1000,
      drowsy: this.drowsy,
      blink_rate_per_min: blinkRate,
      total_blinks: this.totalBlinks,
      eye_strain: eyeStrain,
    };
  }
}

window.VitaLensEye = {
  ClientEyeTracker,
};
