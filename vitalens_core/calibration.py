"""
Personal baseline calibration (VitaLens Documentation, Section 11.2 & 15 Part 3).

On app start the user sits still for ~30 seconds. During this window we
record BPM and SDNN samples, then average them into baseline_bpm /
baseline_sdnn. Every stress reading after calibration is expressed as a
percentage deviation from the user's OWN baseline_sdnn, not a fixed
population threshold.
"""

import time
import numpy as np

CALIBRATION_SECONDS = 30


class BaselineCalibrator:
    def __init__(self, duration_seconds=CALIBRATION_SECONDS):
        self.duration_seconds = duration_seconds
        self.start_time = time.time()
        self.bpm_samples = []
        self.sdnn_samples = []
        self.baseline_bpm = None
        self.baseline_sdnn = None
        self.done = False

    def reset(self):
        self.__init__(self.duration_seconds)

    def seconds_remaining(self):
        elapsed = time.time() - self.start_time
        return max(0.0, self.duration_seconds - elapsed)

    def is_calibrating(self):
        return not self.done

    def add_sample(self, bpm, sdnn):
        """Feed a live (bpm, sdnn) reading in during the calibration window."""
        if self.done:
            return
        if bpm is not None:
            self.bpm_samples.append(bpm)
        if sdnn is not None:
            self.sdnn_samples.append(sdnn)

        if self.seconds_remaining() <= 0:
            self._finalize()

    def _finalize(self):
        if self.bpm_samples:
            self.baseline_bpm = float(np.median(self.bpm_samples))
        if self.sdnn_samples:
            self.baseline_sdnn = float(np.median(self.sdnn_samples))
        # Require at least a minimal amount of real data; otherwise keep
        # collecting a bit longer rather than lock in a garbage baseline.
        if self.baseline_bpm is not None and self.baseline_sdnn is not None:
            self.done = True
        else:
            # extend window slightly if signal was too poor to calibrate
            self.start_time = time.time() - (self.duration_seconds - 5)

    def status(self):
        if self.done:
            return {
                "calibrating": False,
                "seconds_remaining": 0,
                "baseline_bpm": round(self.baseline_bpm, 1),
                "baseline_sdnn": round(self.baseline_sdnn, 1),
            }
        return {
            "calibrating": True,
            "seconds_remaining": round(self.seconds_remaining(), 1),
            "baseline_bpm": None,
            "baseline_sdnn": None,
        }

    def stress_from_sdnn(self, live_sdnn):
        """
        Percentage deviation of live SDNN from this user's own baseline
        SDNN (Section 15, Part 3, Step 6). Lower SDNN relative to baseline
        = higher stress.

        Thresholds:
        - >= -15%: Low stress (normal resting variability)
        - -15% to -35%: Moderate stress (mild sympathetic activation)
        - < -35%: Elevated stress (marked vagal withdrawal)
        """
        if not self.done or live_sdnn is None or self.baseline_sdnn in (None, 0):
            return None, None

        pct_deviation = ((live_sdnn - self.baseline_sdnn) / self.baseline_sdnn) * 100.0

        if pct_deviation >= -15:
            label = "Low"
        elif pct_deviation >= -35:
            label = "Moderate"
        else:
            label = "Elevated"

        return round(pct_deviation, 1), label

