"""
Eye strain / drowsiness pipeline (VitaLens Documentation, Section 11.3 & 15 Part 4).

Pure geometry on MediaPipe Face Mesh landmarks -- no separate model, no
signal processing. Reuses the same Face Mesh output already computed for
the rPPG ROI.

EAR = (|p2-p6| + |p3-p5|) / (2 * |p1-p4|)

Includes:
- Moving-average temporal smoothing for raw EAR to eliminate landmark jitter.
- Consecutive-frame debouncing (requires >= 2 frames below threshold).
- 200ms refractory period after each counted blink.
"""

import time
from collections import deque
import numpy as np

# Standard 6-point eye landmark sets for MediaPipe Face Mesh (468 landmarks).
# Order per eye: [outer_corner, top_1, top_2, inner_corner, bottom_2, bottom_1]
LEFT_EYE = [33, 160, 158, 133, 153, 144]
RIGHT_EYE = [362, 385, 387, 263, 373, 380]

EAR_THRESHOLD = 0.22             # below this = eye considered "closed"
EAR_SMOOTHING_FRAMES = 3         # moving-average filter window (frames)
CONSECUTIVE_CLOSED_FRAMES = 2    # frames below threshold to confirm closure start
REFRACTORY_SECONDS = 0.20        # minimum interval between consecutive blinks (200ms)
DROWSY_SECONDS = 2.0             # sustained closure to flag drowsiness
BLINK_MIN_SECONDS = 0.05         # minimum duration (50ms) to filter micro-glitches
BLINK_MAX_SECONDS = 0.45         # longer than 450ms = sustained closure / drowsiness
LOW_BLINK_RATE_PER_MIN = 8       # sustained rate below this flags eye strain
WARMUP_SECONDS = 30.0            # warmup time before evaluating low blink rate


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
        self.tracker_start_time = time.time()
        self.raw_ear_window = deque(maxlen=EAR_SMOOTHING_FRAMES)
        self.consecutive_closed = 0
        self.eye_closed_since = None
        self.drowsy = False
        self.blink_timestamps = deque(maxlen=200)
        self.ear_history = deque(maxlen=300)
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

        # Smooth EAR with small moving average to suppress single-frame landmark jitter
        smoothed_ear = float(np.mean(self.raw_ear_window))
        self.ear_history.append(smoothed_ear)

        if smoothed_ear < EAR_THRESHOLD:
            self.consecutive_closed += 1
            if self.consecutive_closed == 1:
                self._potential_close_start = now
        else:
            self.consecutive_closed = 0

        # Debounced closure: requires at least CONSECUTIVE_CLOSED_FRAMES
        is_closed_debounced = self.consecutive_closed >= CONSECUTIVE_CLOSED_FRAMES

        # Drowsiness: sustained closure >= DROWSY_SECONDS
        if is_closed_debounced:
            if self.eye_closed_since is None:
                self.eye_closed_since = self._potential_close_start or now
            elif now - self.eye_closed_since >= DROWSY_SECONDS:
                self.drowsy = True
        else:
            self.eye_closed_since = None
            self.drowsy = False

        # Blink detection with refractory period & debouncing
        if is_closed_debounced and not self._closing:
            # Check refractory period before accepting a new closure
            if now - self.last_blink_time >= REFRACTORY_SECONDS:
                self._closing = True
                self._close_start = self._potential_close_start or now
        elif not is_closed_debounced and self._closing:
            self._closing = False
            if self._close_start is not None:
                closed_duration = now - self._close_start
                # Valid blink duration check (50ms to 450ms)
                if BLINK_MIN_SECONDS <= closed_duration <= BLINK_MAX_SECONDS:
                    if now - self.last_blink_time >= REFRACTORY_SECONDS:
                        self.blink_timestamps.append(now)
                        self.last_blink_time = now
            self._close_start = None
            self._potential_close_start = None
        elif not is_closed_debounced:
            self._potential_close_start = None

        return self.snapshot(smoothed_ear)

    def blink_rate_per_minute(self):
        now = time.time()
        # Clean older entries
        while self.blink_timestamps and now - self.blink_timestamps[0] > 60:
            self.blink_timestamps.popleft()
        return len(self.blink_timestamps)

    def snapshot(self, ear):
        now = time.time()
        blink_rate = self.blink_rate_per_minute()
        # Only evaluate eye strain after warmup period has elapsed
        elapsed = now - self.tracker_start_time
        eye_strain = (elapsed >= WARMUP_SECONDS) and (blink_rate < LOW_BLINK_RATE_PER_MIN)
        return {
            "ear": round(ear, 3) if ear is not None else None,
            "drowsy": self.drowsy,
            "blink_rate_per_min": blink_rate,
            "eye_strain": eye_strain,
        }
