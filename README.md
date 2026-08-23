# VitaLens — AI-Powered Contactless Wellness Monitoring

Heart Rate (rPPG) · Stress/HRV (personal baseline calibration) · Eye Strain & Drowsiness (EAR) — all from a single webcam feed, built on two shared MediaPipe Face Mesh pipelines. Zero wearables, zero cost.

Built for **Prasunethon 2.0 Hackathon — Round 2**, following the architecture in `VitaLens_Full_Documentation.docx`.

## How it maps to the documentation

| Doc section | Code |
| --- | --- |
| 11.1 Heart Rate (rPPG) | `vitalens_core/camera.py` (forehead ROI extraction) + `vitalens_core/signal_processing.py` (bandpass filter + FFT → BPM) |
| 11.2 Stress/HRV + baseline calibration | `vitalens_core/signal_processing.py` (peak detection → SDNN) + `vitalens_core/calibration.py` (30s baseline window, % deviation) |
| 11.3 Eye Strain / Drowsiness | `vitalens_core/eye_strain.py` (EAR formula, blink rate, drowsiness) |
| Combined Wellness Score | `vitalens_core/wellness.py` |
| Backend (Flask) | `app.py` |
| Frontend / Dashboard (HTML/JS + Chart.js) | `templates/index.html`, `static/js/dashboard.js`, `static/css/style.css` |

One `FaceMesh.process()` call per frame in `camera.py` feeds all three signals — matching the "two shared pipelines" story from the pitch deck.

## 1. Setup

Requires **Python 3.9–3.11** (MediaPipe doesn't yet support 3.12+ on all platforms) and a working webcam.

```bash
cd vitalens
python -m venv venv

# Windows
venv\Scripts\activate
# macOS / Linux
source venv/bin/activate

pip install -r requirements.txt
```

## 2. Run

```bash
python app.py
```

Open **http://localhost:5000** in a browser. Grant camera permission if prompted by your OS (not the browser — OpenCV opens the camera directly).

- The calibration ring runs for ~30 seconds on load ("sit still and look at the camera") — this sets your personal baseline BPM/SDNN per Section 11.2.
- After calibration, BPM, Stress (Low/Moderate/Elevated + % vs your baseline), and Eye Strain/Drowsiness all update live.
- **Recalibrate** button restarts the baseline window (useful between demo volunteers).
- Session Summary at the bottom rolls up avg BPM, stress trend, drowsy-alert count, and avg blink rate.

## 3. Project structure

```
vitalens/
├── app.py                     # Flask routes: dashboard, /api/data, /video_feed
├── requirements.txt
├── vitalens_core/
│   ├── camera.py               # threaded capture loop, shared Face Mesh, ROI extraction
│   ├── signal_processing.py    # resample, bandpass filter, FFT→BPM, peak detect→SDNN
│   ├── calibration.py          # 30s baseline window + % deviation stress scoring
│   ├── eye_strain.py           # EAR calc, blink counting, drowsiness detection
│   └── wellness.py             # combines all 3 signals into one 0-100 score
├── templates/index.html
└── static/{css,js}/
```

## 4. Testing checklist (from Section 19 of the doc)

- [ ] Test in bright, dim, and backlit rooms — rPPG/HRV are the most lighting-sensitive parts.
- [ ] Let the signal run 30-60s before judging HRV/stress accuracy.
- [ ] Test calibration on 2-3 different people; confirm baseline BPM/SDNN look sane (baseline shown in the Stress card once calibration finishes).
- [ ] Test EAR thresholds on someone wearing glasses — tune `EAR_THRESHOLD` in `eye_strain.py` if needed (default `0.22`).
- [ ] Deliberately close eyes for 2-3s and blink rapidly to confirm both alerts fire.
- [ ] Rehearse the "whose baseline are you comparing against" answer — it's the differentiator vs. Whoop/Oura/Binah.ai (Section 16).

## 5. Known tuning knobs

| Constant | File | Default | Purpose |
| --- | --- | --- | --- |
| `CALIBRATION_SECONDS` | `calibration.py` | 30 | Baseline window length |
| `EAR_THRESHOLD` | `eye_strain.py` | 0.22 | Eye-closed cutoff — calibrate on your own eyes first |
| `EAR_SMOOTHING_FRAMES` | `eye_strain.py` | 3 | Moving average window for raw EAR smoothing |
| `CONSECUTIVE_CLOSED_FRAMES` | `eye_strain.py` | 2 | Consecutive frames below cutoff to confirm closure (debouncing) |
| `REFRACTORY_SECONDS` | `eye_strain.py` | 0.20 | Minimum cooldown period between consecutive blinks |
| `DROWSY_SECONDS` | `eye_strain.py` | 2.0 | Sustained closure before flagging drowsy |
| `LOW_BLINK_RATE_PER_MIN` | `eye_strain.py` | 8 | Sustained low blink rate → eye strain flag |
| `FOREHEAD_LANDMARKS` | `camera.py` | — | ROI landmark indices — switch to cheek landmarks if forehead is covered by hair/bangs during testing |


## 6. Submitting for Round 2

Your email asks for, on **both** the Google Form and the Prasunet Portal:
- Working Project / Demo → run `python app.py` and screen-record the dashboard (calibration → live signals → recalibrate).
- Source Code → zip this folder (already provided) or push to a GitHub repo and share the link.
- Project Documentation → `VitaLens_Full_Documentation.docx` (already have it).
- PPT / Presentation → `VitaLens_Prasunethon_Pitch.pptx` (already have it).
- Demo Video → record a short walkthrough narrating the calibration step as intentional, per Section 15 Part 7.

## 7. Next steps in Antigravity

This codebase is ready to drop straight into **Google Antigravity** (Gemini-3-powered agentic IDE) for further iteration:

1. Open Antigravity → **File → Open Folder** → select this `vitalens/` folder.
2. Its built-in browser + terminal can run `python app.py` and visually test the dashboard for you, so it's a good fit for tasks like: tuning `EAR_THRESHOLD`/`LOW_BLINK_RATE_PER_MIN` against your own webcam, adding the optional UBFC-rPPG-trained model mentioned in Section 15 (Part 2, Step 7), or polishing the UI further for the demo.
3. Since agents there can act autonomously, review each diff/plan before accepting — especially anything touching `signal_processing.py`, since a bad edit there silently degrades BPM/HRV accuracy rather than crashing.
