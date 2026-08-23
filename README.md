# VitaLens — AI-Powered Contactless Wellness Monitoring

> **Real-Time Biometric & Ergonomic Telemetry from a Single Webcam Stream — Zero Wearables, Zero Sensors, Zero Cost.**

VitaLens leverages a shared **MediaPipe Face Mesh (468 landmarks)** pipeline to extract three simultaneous health signals from a standard RGB video stream in real time:
1. **Heart Rate (rPPG)**: Remote Photoplethysmography extracting blood pulse micro-fluctuations from a dynamic forehead ROI polygon.
2. **Stress & Heart Rate Variability (HRV / SDNN)**: High-resolution peak detection & inter-beat interval analysis calibrated against a **personalized 30-second resting baseline**.
3. **Eye Strain & Drowsiness**: Geometric Eye Aspect Ratio (EAR) with adaptive open-eye baseline calibration, blink-rate tracking, and Web Audio API alerts.
4. **Composite Wellness Score (0–100)**: Transparent, deterministic multi-signal synthesis.

---

## 🌟 Key Features & Architecture

```
                               ┌── Forehead Skin ROI ──> 30s Rolling Buffer ──> Butterworth Bandpass Filter (0.7-4.0 Hz) ──┬──> FFT Spectrum ──> Heart Rate (BPM)
                               │                                                                                           └──> Peak Detection ──> Inter-Beat Intervals ──> SDNN (ms) ──> % Deviation from Baseline ──> Stress Level
Webcam Stream ──> MediaPipe ───┤
                  Face Mesh    │
                               └── Eye Landmarks (EAR) ──> Adaptive Open-Eye Calibration ──> Dynamic Cutoff ──┬──> Sustained Closure (≥ 2.0s) ──> Drowsy Alert!
                                                                                                              └──> Rolling Window Count ──> Extrapolated Blink Rate (/min) & Eye Strain
```

### 1. Heart Rate (rPPG)
- Extracts the mean green-channel intensity from a convex hull bounded by facial landmarks `[10, 109, 108, 151, 337, 338, 297, 332, 103]`.
- Resamples non-uniform webcam timestamps onto a uniform 30 Hz time grid using linear interpolation.
- Filters using a 3rd-order Butterworth bandpass filter ($0.7\text{ Hz}$ to $4.0\text{ Hz}$ / 42–240 BPM).
- Extracts dominant frequency via Fast Fourier Transform (FFT) with a Hanning window.

### 2. Stress & HRV (SDNN) with Personal Baseline Calibration
- Detects systolic pulse peaks with dynamic prominence thresholds ($0.30 \times \sigma$) to reject dicrotic notches and camera noise.
- Filters physiological inter-beat intervals (300ms–1500ms) with relative outlier rejection ($\pm 35\%$ from window median).
- Computes SDNN over a 30-second rolling window matching the calibration window.
- Evaluates stress based on percentage deviation ($\Delta\%$) from the user's own resting baseline:
  - **Low Stress**: $\ge -15\%$ deviation
  - **Moderate Stress**: $-15\%$ to $-35\%$ deviation
  - **Elevated Stress**: $< -35\%$ deviation

### 3. Adaptive Eye Strain & Drowsiness Detection
- Calculates Eye Aspect Ratio: $\text{EAR} = \frac{\|p_2 - p_6\| + \|p_3 - p_5\|}{2 \|p_1 - p_4\|}$.
- Automatically learns the user's natural open-eye baseline ($\text{EAR}_{\text{open}}$) and sets an adaptive threshold ($72\%$ of open baseline), accommodating eyeglasses and different facial features.
- Tracks session blinks with a 180ms refractory period and normalizes rate per minute.
- Flags **Drowsy Alert** on sustained closure ($\ge 2.0\text{s}$) and **Eye Strain** on sustained low blink rate ($< 8\text{ blinks/min}$).

### 4. Audio Alerts & Cybernetic Glassmorphism UI
- Zero-asset Web Audio API 1000 Hz square-wave double-beep alert triggered on alert transitions.
- Obsidian dark-mode dashboard with Google Fonts (`Outfit`, `Plus Jakarta Sans`, `JetBrains Mono`), animated heartbeat sync, tri-state stress meter, and live Chart.js sparkline.

---

## 📁 Project Structure

```
vitalens/
├── app.py                     # Flask web server: / (UI), /api/data, /video_feed, /api/calibrate/restart
├── requirements.txt           # Core dependencies (flask, opencv-python, mediapipe, numpy, scipy)
├── .gitignore                 # Excludes venv, bytecode, and temporary files
├── vitalens_core/
│   ├── __init__.py
│   ├── camera.py              # Threaded capture loop, MediaPipe Face Mesh, ROI extraction & state
│   ├── signal_processing.py   # Resampling, Butterworth bandpass filter, FFT BPM, peak detection & SDNN
│   ├── calibration.py         # 30s baseline calibrator & percentage deviation stress evaluation
│   ├── eye_strain.py          # Adaptive EAR baseline, blink detection, and drowsiness monitor
│   └── wellness.py            # Composite 0-100 wellness index scoring
├── templates/
│   └── index.html             # Semantic glassmorphism HUD dashboard template
└── static/
    ├── css/
    │   └── style.css          # Futuristic obsidian styling, radial glows & responsive layout
    └── js/
        └── dashboard.js       # Client polling loop, Chart.js telemetry, audio alerts & timer
```

---

## ⚡ Installation & Quick Start

### Prerequisites
- **Python 3.9 – 3.11** (MediaPipe compatibility)
- Standard USB or built-in webcam

### 🚀 Deploying to Vercel (1-Click Client-Side Web App)

VitaLens is ready for 1-click deployment on **Vercel** with zero server costs and zero configuration:

1. Push this repository to your GitHub account (already synced to `https://github.com/sanjaykumar-xe/vitalens`).
2. Go to **[vercel.com](https://vercel.com)** and click **"Add New Project"**.
3. Import the `vitalens` repository.
4. Leave all build and output settings as default (`Framework Preset: Other`, `Root Directory: ./`).
5. Click **"Deploy"**.
6. Your live VitaLens app will be instantly live with an HTTPS link (e.g. `https://vitalens.vercel.app`), processing all camera feeds client-side via WebAssembly!

---

### 💻 Running Locally

#### Method A: Static Web Server (Client-Side Mode)
```bash
# Using Python
python -m http.server 3000

# Or using npx serve
npx serve .
```
Open **[http://localhost:3000](http://localhost:3000)** in your browser.

#### Method B: Local Python Flask Server
```bash
# Clone the repository
git clone https://github.com/sanjaykumar-xe/vitalens.git
cd vitalens

# Create virtual environment
python -m venv venv

# Activate virtual environment
# Windows:
venv\Scripts\activate
# macOS / Linux:
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Run
python app.py
```
Open **[http://localhost:5000](http://localhost:5000)** in your browser.

---

## ⚙️ Configuration & Tuning Knobs

| Parameter | Location | Default | Description |
|---|---|---|---|
| `BUFFER_SECONDS` | `vitalens_core/camera.py` / `dashboard.js` | `30` | Rolling sample buffer length (matches baseline window) |
| `CALIBRATION_SECONDS` | `vitalens_core/calibration.py` / `dsp.js` | `30` | Baseline learning window duration |
| `DROWSY_SECONDS` | `vitalens_core/eye_strain.py` / `eye_tracker.js` | `2.0` | Sustained eye closure threshold to trigger Drowsy Alert |
| `LOW_BLINK_RATE_PER_MIN` | `vitalens_core/eye_strain.py` / `eye_tracker.js` | `8` | Blink rate cutoff for eye strain detection |
| `REFRACTORY_SECONDS` | `vitalens_core/eye_strain.py` / `eye_tracker.js` | `0.18` | Minimum cooldown between consecutive blinks |
| `FOREHEAD_LANDMARKS` | `vitalens_core/camera.py` / `dashboard.js` | — | 468-point landmark indices for forehead rPPG ROI |


