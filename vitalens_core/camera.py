"""
VitaLens core processing loop.

One MediaPipe Face Mesh call per frame feeds THREE outputs, per the
shared-pipeline architecture in the documentation (Section 2 / Figure 1):

  frame -> Face Mesh landmarks -> forehead ROI green channel  -> rPPG buffer
                                                                     |
                                                                     +--> Heart Rate (FFT/BPM)
                                                                     +--> Stress/HRV (peaks -> SDNN -> baseline deviation)
                                -> eye landmarks (EAR)              -> Eye Strain / Drowsiness

Runs in a background thread so the Flask web server stays responsive.
The latest computed values are stored in `self.state` (thread-safe via lock)
and polled by the /api/data endpoint.
"""

import time
import threading
from collections import deque

import cv2
import numpy as np
import mediapipe as mp

from . import signal_processing as sig
from .calibration import BaselineCalibrator
from .eye_strain import EyeStrainTracker
from .wellness import compute_wellness_score

# Buffer holds 30 seconds of samples at ~30fps -- matching the 30s calibration window
# so live SDNN and baseline SDNN are computed over identical window lengths.
BUFFER_SECONDS = 30
TARGET_FPS = 30


# Forehead landmark indices (MediaPipe Face Mesh, 468-point model).
# These bound a small patch of skin between the eyebrows and hairline,
# avoiding eyes/hair -- a standard rPPG ROI choice.
FOREHEAD_LANDMARKS = [10, 109, 108, 151, 337, 338, 297, 332, 103]


class VitaLensProcessor:
    def __init__(self, camera_index=0):
        self.camera_index = camera_index
        self.lock = threading.Lock()
        self.running = False
        self.thread = None

        self.face_mesh = mp.solutions.face_mesh.FaceMesh(
            max_num_faces=1,
            refine_landmarks=False,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5,
        )

        self.green_buffer = deque(maxlen=int(BUFFER_SECONDS * TARGET_FPS))
        self.time_buffer = deque(maxlen=int(BUFFER_SECONDS * TARGET_FPS))

        self.eye_tracker = EyeStrainTracker()
        self.calibrator = BaselineCalibrator()

        self.latest_frame = None  # for MJPEG streaming
        self.state = {
            "face_detected": False,
            "bpm": None,
            "sdnn_ms": None,
            "stress_pct_deviation": None,
            "stress_label": None,
            "calibration": self.calibrator.status(),
            "eye": {"ear": None, "drowsy": False, "blink_rate_per_min": 0, "eye_strain": False},
            "wellness_score": None,
            "wellness_label": None,
            "session_start": time.time(),
            "history": [],  # list of {t, bpm, sdnn} for session summary
        }

    # ---- lifecycle -----------------------------------------------------

    def start(self):
        if self.running:
            return
        self.running = True
        self.thread = threading.Thread(target=self._run_loop, daemon=True)
        self.thread.start()

    def stop(self):
        self.running = False
        if self.thread is not None:
            self.thread.join(timeout=2)

    def restart_calibration(self):
        with self.lock:
            self.calibrator.reset()
            self.eye_tracker.reset()


    def get_state(self):
        with self.lock:
            return dict(self.state)

    def get_jpeg_frame(self):
        with self.lock:
            frame = self.latest_frame
        if frame is None:
            return None
        ok, buf = cv2.imencode(".jpg", frame)
        if not ok:
            return None
        return buf.tobytes()

    # ---- main loop -------------------------------------------------------

    def _run_loop(self):
        cap = cv2.VideoCapture(self.camera_index)
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)

        if not cap.isOpened():
            with self.lock:
                self.state["face_detected"] = False
                self.state["error"] = "Could not open webcam. Check camera permissions/index."
            self.running = False
            return

        last_bpm_update = 0.0

        while self.running:
            ok, frame = cap.read()
            if not ok:
                time.sleep(0.05)
                continue

            frame = cv2.flip(frame, 1)
            h, w = frame.shape[:2]
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            results = self.face_mesh.process(rgb)

            now = time.time()
            face_detected = bool(results.multi_face_landmarks)

            if face_detected:
                landmarks = results.multi_face_landmarks[0].landmark
                pts = [(int(lm.x * w), int(lm.y * h)) for lm in landmarks]

                # --- rPPG: forehead ROI green channel ---
                roi_pts = np.array([pts[i] for i in FOREHEAD_LANDMARKS], dtype=np.int32)
                mask = np.zeros((h, w), dtype=np.uint8)
                hull = cv2.convexHull(roi_pts)
                cv2.fillConvexPoly(mask, hull, 255)
                mean_green = cv2.mean(frame[:, :, 1], mask=mask)[0]

                self.green_buffer.append(mean_green)
                self.time_buffer.append(now)

                # --- Eye strain / drowsiness (same landmark set) ---
                eye_snapshot = self.eye_tracker.update(pts)

                cv2.polylines(frame, [hull], True, (0, 255, 0), 1)
            else:
                eye_snapshot = {"ear": None, "drowsy": False, "blink_rate_per_min": self.eye_tracker.blink_rate_per_minute(), "eye_strain": False}

            bpm = None
            sdnn_ms = None
            stress_pct = None
            stress_label = None

            # Recompute BPM/HRV at most every ~1s once we have enough buffer
            if now - last_bpm_update >= 1.0 and len(self.time_buffer) >= int(TARGET_FPS * 4):
                last_bpm_update = now
                uniform_t, uniform_v = sig.interpolate_to_uniform(
                    list(self.time_buffer), list(self.green_buffer), fps=TARGET_FPS
                )
                if uniform_v is not None:
                    fps_est = TARGET_FPS
                    filtered = sig.bandpass_filter(uniform_v, fps_est)
                    bpm = sig.estimate_bpm_fft(filtered, fps_est)
                    sdnn_ms, peak_bpm, _ibis = sig.detect_peaks_and_sdnn(filtered, uniform_t, estimated_bpm=bpm)
                    if bpm is None:
                        bpm = peak_bpm

                    with self.lock:
                        self.calibrator.add_sample(bpm, sdnn_ms)
                        if self.calibrator.done:
                            stress_pct, stress_label = self.calibrator.stress_from_sdnn(sdnn_ms)
                            if int(now) % 5 == 0:
                                print(f"[VITALENS] Live BPM: {bpm:.1f} | Live SDNN: {sdnn_ms:.1f}ms | Baseline SDNN: {self.calibrator.baseline_sdnn:.1f}ms | Stress: {stress_label} ({stress_pct}%)")
                        if bpm is not None:
                            self.state["history"].append({
                                "t": round(now - self.state["session_start"], 1),
                                "bpm": round(bpm, 1) if bpm else None,
                                "sdnn": round(sdnn_ms, 1) if sdnn_ms else None,
                            })

                            # cap history length for memory
                            if len(self.state["history"]) > 3600:
                                self.state["history"] = self.state["history"][-3600:]

            score, score_label = compute_wellness_score(
                bpm, stress_label, eye_snapshot.get("eye_strain"), eye_snapshot.get("drowsy")
            )

            with self.lock:
                if bpm is not None:
                    self.state["bpm"] = round(bpm, 1)
                if sdnn_ms is not None:
                    self.state["sdnn_ms"] = round(sdnn_ms, 1)
                if stress_pct is not None:
                    self.state["stress_pct_deviation"] = stress_pct
                    self.state["stress_label"] = stress_label
                self.state["face_detected"] = face_detected
                self.state["calibration"] = self.calibrator.status()
                self.state["eye"] = eye_snapshot
                self.state["wellness_score"] = score
                self.state["wellness_label"] = score_label
                self.latest_frame = frame

            time.sleep(1.0 / TARGET_FPS)

        cap.release()
