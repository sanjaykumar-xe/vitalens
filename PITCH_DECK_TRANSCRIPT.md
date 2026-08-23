# VitaLens — Pitch Deck & Presentation Guide (Prasunethon 2.0)

> **File**: [`VitaLens_Pitch_Deck_Prasunethon2.0.pptx`](file:///c:/Users/HAREESH%20K%20M/OneDrive/Desktop/vitalens/VitaLens_Pitch_Deck_Prasunethon2.0.pptx)  
> **Live Web App**: [https://vitalens-fdtx.vercel.app/](https://vitalens-fdtx.vercel.app/)  
> **Demo Video**: [Google Drive Walkthrough](https://drive.google.com/file/d/1-__Ep_3rCFzFefDWSm10ybyXbbVenS59/view?usp=drive_link)  
> **GitHub**: [https://github.com/sanjaykumar-xe/vitalens](https://github.com/sanjaykumar-xe/vitalens)  

---

## 📑 Slide-by-Slide Script & Speaker Notes

### Slide 1: Title & Hero
- **Slide Title**: VitaLens — AI-Powered Contactless Wellness Monitoring
- **Subtitle**: Real-time Heart Rate (rPPG), Personalized HRV Stress, and Eye Strain / Drowsiness Detection from any standard webcam.
- **Speaker Script**:
  > *"Good morning, respected judges. We are thrilled to present VitaLens — an AI-powered contactless wellness monitoring system that turns any standard laptop or smartphone webcam into a continuous health diagnostic terminal. With zero wearables, zero sensors, and zero additional hardware costs, VitaLens measures heart rate, personalized stress, and eye strain in real time while preserving 100% client-side privacy."*

---

### Slide 2: The Problem Statement
- **Key Points**:
  1. **Wearable Barrier**: 85%+ of people don't wear fitness trackers 24/7; high cost ($300+) and charging friction.
  2. **Invisible Chronic Stress**: Autonomic nervous system fatigue peaks silently before burnout occurs. Static population thresholds fail because resting SDNN varies widely (30ms vs 90ms).
  3. **Computer Vision Syndrome**: Blink rates drop by 60% during screen work, leading to micro-sleeps and chronic eye fatigue.
- **Speaker Script**:
  > *"Over 70% of digital workers experience computer vision syndrome and burnout. Existing solutions rely on expensive smartwatches that people forget to charge or wear. Furthermore, traditional stress apps compare you against generic population averages, which are clinically inaccurate because everyone has a unique physiological baseline."*

---

### Slide 3: The Proposed Solution
- **Key Points**:
  1. **Optical Pulse (rPPG)**: Measures hemoglobin green light absorption micro-fluctuations on the forehead to extract real-time BPM.
  2. **Personal Baseline HRV**: 30-second resting calibration calculates your baseline SDNN and scores stress dynamically by percentage deviation ($\Delta\%$).
  3. **Adaptive Eye Ergonomics**: Geometric Eye Aspect Ratio (EAR) with adaptive open-eye baseline and Web Audio alert on sustained closure ($\ge 2.0\text{s}$).
- **Speaker Script**:
  > *"VitaLens solves this by unifying optical signal processing and facial geometry into a single webcam pass. On startup, a 30-second calibration ring measures your personal resting heart rate variability. From that point forward, your stress is evaluated relative to your own body, not a generic stranger's."*

---

### Slide 4: Technical Architecture & Signal Pipeline
- **Key Points**:
  - **Shared Vision Core**: 1 single MediaPipe Face Mesh (468 landmarks) execution.
  - **rPPG Pipeline**: Forehead polygon ROI $\to$ 30 Hz uniform resampling $\to$ 4th-order zero-phase Butterworth Bandpass ($0.7 - 4.0\text{ Hz}$) $\to$ Radix-2 FFT with parabolic sub-bin interpolation $\to$ Systolic peak detection $\to$ SDNN.
  - **Ocular Pipeline**: Geometric EAR formula $\to$ adaptive open-eye calibration ($72\%$ cutoff) $\to$ 2-frame debounce $\to$ 180ms refractory cooldown $\to$ Web Audio API square wave alert.
- **Speaker Script**:
  > *"Our architecture is uniquely lightweight. A single MediaPipe FaceMesh pass feeds both our rPPG blood flow engine and our ocular geometry engine. Our custom DSP pipeline resamples the green channel to 30 Hz, applies a zero-phase Butterworth bandpass filter, and uses FFT spectral estimation with sub-bin interpolation to achieve sub-beat pulse accuracy."*

---

### Slide 5: The Differentiator — Personal Baseline Calibration
- **Key Points**:
  - Why competitors fail: Static threshold fallacy (SDNN $< 50\text{ms} = \text{stress}$ triggers massive false alarms for healthy people with lower resting SDNN).
  - VitaLens formula: $\Delta\% = \frac{\text{SDNN}_{\text{live}} - \text{SDNN}_{\text{baseline}}}{\text{SDNN}_{\text{baseline}}} \times 100$.
  - Low Stress ($\ge -15\%$), Moderate Stress ($-15\%$ to $-35\%$), Elevated Stress ($< -35\%$).
- **Speaker Script**:
  > *"Our biggest competitive moat is Personal Baseline Calibration. An athlete might have a baseline SDNN of 80ms, while a sedentary desk worker has 35ms. By measuring individual baseline deviation, VitaLens eliminates false alarms and delivers clinical-grade, explainable stress telemetry."*

---

### Slide 6: Cybernetic Obsidian Dashboard
- **Key Points**:
  - Pulsating heart icon dynamically synchronized with live heart rate ($\text{period} = 60/\text{BPM}$).
  - Glowing tri-state stress meter (Low / Moderate / Elevated).
  - Session Blinks counter with rate per minute.
  - Real-time Chart.js neon sparkline.
- **Speaker Script**:
  > *"The dashboard is crafted with an obsidian glassmorphism aesthetic. The heart icon beats in exact synchrony with your detected pulse, the tri-state stress meter provides immediate visual clarity, and session telemetry aggregates your ergonomic trends over time."*

---

### Slide 7: Technology Stack & Dual-Engine Deployment
- **Key Points**:
  - **100% Client-Side WebAssembly (Vercel)**: Vanilla JS, MediaPipe FaceMesh, Web Audio API, Chart.js — zero server costs, zero cloud latency.
  - **Native Python Engine (Local/Edge)**: Flask, OpenCV, SciPy, NumPy.
- **Speaker Script**:
  > *"VitaLens is engineered with dual-engine flexibility. It runs as a 100% client-side WebAssembly application hosted on Vercel with zero server costs, as well as a native Python Flask package for edge computing and clinical kiosks."*

---

### Slide 8: Live Demonstration & Verification
- **Live Link**: [https://vitalens-fdtx.vercel.app/](https://vitalens-fdtx.vercel.app/)
- **Demo Video**: [Google Drive Link](https://drive.google.com/file/d/1-__Ep_3rCFzFefDWSm10ybyXbbVenS59/view?usp=drive_link)
- **Source Code**: [GitHub Repository](https://github.com/sanjaykumar-xe/vitalens)
- **Speaker Script**:
  > *"You can test VitaLens right now at vitalens-fdtx.vercel.app. In our recorded walkthrough, you can see the 30-second baseline calibration lock in, live pulse detection match a standard pulse oximeter, and the audio alarm immediately trigger upon 2 seconds of sustained eye closure."*

---

### Slide 9: Market Impact & Competitive Matrix
- **Key Points**:
  - Enterprise wellness ($50B+ market).
  - Commercial fleet & driver safety.
  - Telehealth and remote proctoring.
  - Comparison table: $0 hardware cost vs $300+ wearables; 100% private vs cloud-dependent SDKs.
- **Speaker Script**:
  > *"Compared to Apple Watch, Whoop, or Binah.ai, VitaLens requires zero hardware investment, zero app installation, and zero cloud data transmission. It can be integrated into corporate dashboards, Zoom calls, or vehicle dashcams with a single URL."*

---

### Slide 10: Future Roadmap & Conclusion
- **Key Points**:
  - Next steps: Blood Oxygenation ($SpO_2$) & Respiration Rate.
  - Neural network hybrid models (UBFC-rPPG on ONNX Web Runtime).
  - Final vision: "Transforming every camera in the world into a proactive life-saving health companion."
- **Speaker Script**:
  > *"In our roadmap, we will expand into blood oxygenation ($SpO_2$) and respiratory rate. VitaLens democratizes preventive healthcare for everyone, everywhere. Thank you, and we look forward to your questions!"*
