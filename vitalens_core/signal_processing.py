"""
Signal processing utilities shared by the rPPG heart-rate and HRV/stress
pipelines (VitaLens Documentation, Section 11.1 / 11.2).

Everything here operates on a 1-D buffer of the average green-channel
value sampled once per frame, plus the timestamps of those samples.
"""

import numpy as np
from scipy import signal as sp_signal

# Plausible human heart-rate range: 42-240 BPM -> 0.7-4.0 Hz
LOW_HZ = 0.7
HIGH_HZ = 4.0


def interpolate_to_uniform(timestamps, values, fps=30):
    """
    Webcam frame timing isn't perfectly uniform. Resample the (timestamp,
    value) samples onto a uniform time grid so bandpass filtering and FFT
    are valid (both assume a fixed sample rate).
    """
    timestamps = np.asarray(timestamps, dtype=np.float64)
    values = np.asarray(values, dtype=np.float64)

    if len(timestamps) < 4:
        return None, None

    duration = timestamps[-1] - timestamps[0]
    if duration <= 0:
        return None, None

    n_samples = max(int(duration * fps), 4)
    uniform_t = np.linspace(timestamps[0], timestamps[-1], n_samples)
    uniform_v = np.interp(uniform_t, timestamps, values)
    return uniform_t, uniform_v


def bandpass_filter(values, fps, low_hz=LOW_HZ, high_hz=HIGH_HZ, order=3):
    """
    Butterworth bandpass filter restricting the signal to plausible
    heart-rate frequencies (Section 11.1, Step 4).
    """
    nyquist = fps / 2.0
    low = max(low_hz / nyquist, 1e-6)
    high = min(high_hz / nyquist, 0.999)
    if low >= high:
        return values
    b, a = sp_signal.butter(order, [low, high], btype="band")
    # filtfilt needs enough samples relative to filter order; guard for short buffers
    padlen = 3 * (max(len(a), len(b)) - 1)
    if len(values) <= padlen:
        return values
    return sp_signal.filtfilt(b, a, values)


def estimate_bpm_fft(filtered_values, fps):
    """
    FFT-based BPM estimate: find the dominant frequency within the
    plausible heart-rate band and convert to BPM (Section 11.1, Step 5).
    """
    n = len(filtered_values)
    if n < 8:
        return None

    windowed = filtered_values * np.hanning(n)
    freqs = np.fft.rfftfreq(n, d=1.0 / fps)
    power = np.abs(np.fft.rfft(windowed)) ** 2

    band_mask = (freqs >= LOW_HZ) & (freqs <= HIGH_HZ)
    if not np.any(band_mask):
        return None

    band_freqs = freqs[band_mask]
    band_power = power[band_mask]
    dominant_freq = band_freqs[np.argmax(band_power)]
    bpm = dominant_freq * 60.0
    return float(bpm)


def detect_peaks_and_sdnn(filtered_values, uniform_t, estimated_bpm=None):
    """
    Detect individual heartbeat peaks in the filtered rPPG signal, compute
    inter-beat intervals (IBIs), and return SDNN — the standard deviation
    of the IBIs (Section 11.2, Steps 2-4).

    Improvements:
    - Uses signal standard deviation to set a peak prominence threshold,
      rejecting dicrotic notches and camera noise ripples.
    - Uses estimated BPM (or conservative default) to set physiological
      minimum peak distance.
    - Outlier rejection removes missed beats and motion artifacts from SDNN.

    Returns (sdnn_ms, mean_bpm_from_peaks, ibis_ms)
    """
    if filtered_values is None or len(filtered_values) < 8:
        return None, None, []

    fps_est = 1.0 / np.median(np.diff(uniform_t)) if len(uniform_t) > 1 else 30.0

    # Determine minimum peak distance based on estimated BPM if available
    if estimated_bpm and 40 <= estimated_bpm <= 200:
        # Expected period in seconds = 60 / BPM. Peaks shouldn't be closer than 60% of period.
        min_peak_interval_sec = max(0.30, (60.0 / estimated_bpm) * 0.60)
    else:
        # Default: 0.35s corresponds to ~170 BPM maximum
        min_peak_interval_sec = 0.35

    min_distance = max(int(fps_est * min_peak_interval_sec), 1)

    # Prominence threshold: true systolic peaks have significant prominence relative to signal noise
    sig_std = float(np.std(filtered_values))
    prominence = max(0.30 * sig_std, 1e-5) if sig_std > 0 else None

    peaks, _ = sp_signal.find_peaks(
        filtered_values,
        distance=min_distance,
        prominence=prominence
    )

    if len(peaks) < 3:
        # Fallback with lower prominence if signal is clean but quiet
        peaks, _ = sp_signal.find_peaks(filtered_values, distance=min_distance)
        if len(peaks) < 3:
            return None, None, []

    peak_times = uniform_t[peaks]
    ibis = np.diff(peak_times)  # in seconds
    ibis_ms = ibis * 1000.0

    # 1. Absolute physiological limits: 300ms (200 BPM) to 1500ms (40 BPM)
    valid_mask = (ibis_ms >= 300) & (ibis_ms <= 1500)
    valid_ibis = ibis_ms[valid_mask]

    if len(valid_ibis) < 2:
        return None, None, []

    # 2. Relative outlier rejection (ectopic beats / skipped beats / motion spikes)
    median_ibi = np.median(valid_ibis)
    if median_ibi > 0:
        # Keep IBIs within ±35% of median IBI
        inlier_mask = (valid_ibis >= 0.65 * median_ibi) & (valid_ibis <= 1.35 * median_ibi)
        clean_ibis = valid_ibis[inlier_mask]
        if len(clean_ibis) >= 2:
            valid_ibis = clean_ibis

    sdnn_ms = float(np.std(valid_ibis, ddof=1))
    mean_bpm = float(60000.0 / np.mean(valid_ibis))
    return sdnn_ms, mean_bpm, valid_ibis.tolist()

