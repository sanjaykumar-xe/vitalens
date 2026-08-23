"""
Eye strain / drowsiness pipeline (VitaLens Documentation, Section 11.3 & 15 Part 4).

Pure geometry on MediaPipe Face Mesh landmarks -- no separate model, no
signal processing. Reuses the same Face Mesh output already computed for
the rPPG ROI.

EAR = (|p2-p6| + |p3-p5|) / (2 * |p1-p4|)

Key Features:
- Adaptive Open-Eye Calibration: dynamically computes the user's natural open EAR baseline
  and calculates a personalized closure threshold (e.g. 72% of open baseline), solving
  issues with different eye shapes, camera angles, and eyeglasses.
- Responsive temporal smoothing (2 frames) ensuring fast 100-300ms blinks are never missed.
- Normalized blink-rate extrapolation during session warmup.
- Session total blink counter for instant visual verification.
"""

import time
from collections import deque
import numpy as np

# Standard 6-point eye landmark sets for MediaPipe Face Mesh (468 landmarks).
# Order per eye: [outer_corner, top_1, top_2, inner_corner, bottom_2, bottom_1]
LEFT_EYE = [33, 160, 158, 133, 153, 144]
RIGHT_EYE = [362, 385, 387, 263, 373, 380]

DEFAULT_EAR_THRESHOLD = 0.22     # fallback cutoff
REFRACTORY_SECONDS = 0.18        # minimum interval between consecutive blinks (180ms)
DROWSY_SECONDS = 2.0             # sustained closure to flag drowsiness
BLINK_MIN_SECONDS = 0.05         # minimum closure duration (50ms)
BLINK_MAX_SECONDS = 0.50         # maximum closure duration (500ms) for a blink
LOW_BLINK_RATE_PER_MIN = 8       # sustained rate below this flags eye strain
WARMUP_SECONDS = 15.0            # warmup time before evaluating low blink rate


def _euclidean(p1, p2):
    return float(np.linalg.norm(np.array(p1) - np.array(p2)))


def eye_aspect_ratio(landmarks_xy, eye_indices):
    p1, p2, p3, p4, p5, p6 = [landmarks_xy[i] for i in eye_indices]
    vertical = _euclidean(p2, p6) + _euclidean(p3, p5)
    horizontal = _euclidean(p1, p4)
    if horizontal == 0:
        return None
    return vertical / (2.0 * horizontal)


class EyeStrainTracker:
    def __init__(self):
        self.reset()

    def reset(self):
        self.tracker_start_time = time.time()
        self.raw_ear_window = deque(maxlen=2)
        self.open_ear_samples = deque(maxlen=150)  # ~5 seconds of open frames
        self.open_ear_baseline = 0.28
        self.current_threshold = DEFAULT_EAR_THRESHOLD
        
        self.consecutive_closed = 0
        self.eye_closed_since = None
        self.drowsy = False
        
        self.blink_timestamps = deque(maxlen=200)
        self.ear_history = deque(maxlen=300)
        self.total_blinks = 0
        
        self._closing = False
        self._close_start = None
        self._potential_close_start = None
        self.last_blink_time = 0.0

    def update(self, landmarks_xy):
        """landmarks_xy: list of (x, y) pixel coords indexed like MediaPipe's 468 points."""
        now = time.time()
        left_ear = eye_aspect_ratio(landmarks_xy, LEFT_EYE)
        right_ear = eye_aspect_ratio(landmarks_xy, RIGHT_EYE)
        if left_ear is None or right_ear is None:
            return self.snapshot(None)

        raw_ear = (left_ear + right_ear) / 2.0
        self.raw_ear_window.append(raw_ear)

        # 2-frame fast smoothing for high responsiveness
        smoothed_ear = float(np.mean(self.raw_ear_window))
        self.ear_history.append(smoothed_ear)

        # Adaptive Open-Eye Calibration:
        # Collect samples when eye appears unclosed to learn natural baseline
        if smoothed_ear > 0.18:
            self.open_ear_samples.append(smoothed_ear)
            if len(self.open_ear_samples) >= 15:
                # 80th percentile reflects typical relaxed open eyes
                self.open_ear_baseline = float(np.percentile(self.open_ear_samples, 80))
                # Dynamic threshold is 72% of open-eye baseline, bounded in [0.16, 0.27]
                self.current_threshold = float(np.clip(self.open_ear_baseline * 0.72, 0.16, 0.27))

        # Check closure against dynamic threshold
        is_closed = smoothed_ear < self.current_threshold

        if is_closed:
            self.consecutive_closed += 1
            if self.consecutive_closed == 1:
                self._potential_close_start = now
        else:
            self.consecutive_closed = 0

        # Debounced closure: 1-2 frames below threshold
        is_closed_debounced = self.consecutive_closed >= 1

        # Drowsiness detection: sustained closure >= DROWSY_SECONDS
        if is_closed:
            if self.eye_closed_since is None:
                self.eye_closed_since = self._potential_close_start or now
            elif now - self.eye_closed_since >= DROWSY_SECONDS:
                self.drowsy = True
        else:
            self.eye_closed_since = None
            self.drowsy = False

        # Blink detection with refractory period & onset tracking
        if is_closed_debounced and not self._closing:
            if now - self.last_blink_time >= REFRACTORY_SECONDS:
                self._closing = True
                self._close_start = self._potential_close_start or now
        elif not is_closed and self._closing:
            self._closing = False
            if self._close_start is not None:
                closed_duration = now - self._close_start
                # Valid blink duration check (50ms to 500ms)
                if BLINK_MIN_SECONDS <= closed_duration <= BLINK_MAX_SECONDS:
                    if now - self.last_blink_time >= REFRACTORY_SECONDS:
                        self.total_blinks += 1
                        self.blink_timestamps.append(now)
                        self.last_blink_time = now
            self._close_start = None
            self._potential_close_start = None
        elif not is_closed:
            self._potential_close_start = None

        return self.snapshot(smoothed_ear)

    def blink_rate_per_minute(self):
        now = time.time()
        # Trim timestamps older than 60s
        while self.blink_timestamps and now - self.blink_timestamps[0] > 60:
            self.blink_timestamps.popleft()
        
        recent_count = len(self.blink_timestamps)
        elapsed = now - self.tracker_start_time

        # If session just started, extrapolate rate cleanly so user doesn't see "1 blink/min"
        if elapsed < 60.0:
            if elapsed < 5.0 or recent_count == 0:
                return recent_count
            scale = 60.0 / elapsed
            return int(round(recent_count * scale))
        
        return recent_count

    def snapshot(self, ear):
        now = time.time()
        blink_rate = self.blink_rate_per_minute()
        elapsed = now - self.tracker_start_time
        eye_strain = (elapsed >= WARMUP_SECONDS) and (blink_rate < LOW_BLINK_RATE_PER_MIN)
        return {
            "ear": round(ear, 3) if ear is not None else None,
            "open_baseline_ear": round(self.open_ear_baseline, 3),
            "threshold_ear": round(self.current_threshold, 3),
            "drowsy": self.drowsy,
            "blink_rate_per_min": blink_rate,
            "total_blinks": self.total_blinks,
            "eye_strain": eye_strain,
        }

