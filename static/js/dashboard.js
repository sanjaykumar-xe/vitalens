/**
 * VitaLens Client-Side Dashboard Controller & MediaPipe Pipeline
 */

const FOREHEAD_LANDMARKS = [10, 109, 108, 151, 337, 338, 297, 332, 103];
const BUFFER_SECONDS = 30.0;
const CALIBRATION_TOTAL_SECONDS = 30;
const RING_RADIUS = 58;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

// DOM Element References
const els = {
  video: document.getElementById("webcamVideo"),
  canvas: document.getElementById("outputCanvas"),
  calibOverlay: document.getElementById("calibrationOverlay"),
  ringFg: document.getElementById("ringFg"),
  calibSeconds: document.getElementById("calibSeconds"),
  faceStatus: document.getElementById("faceStatus"),
  faceStatusText: document.getElementById("faceStatusText"),
  wellnessScore: document.getElementById("wellnessScore"),
  wellnessLabel: document.getElementById("wellnessLabel"),
  wellnessDesc: document.getElementById("wellnessDesc"),
  wellnessBarFill: document.getElementById("wellnessBarFill"),
  bpmValue: document.getElementById("bpmValue"),
  beatingHeart: document.getElementById("beatingHeart"),
  stressValue: document.getElementById("stressValue"),
  stressDetail: document.getElementById("stressDetail"),
  segLow: document.getElementById("segLow"),
  segMod: document.getElementById("segMod"),
  segElev: document.getElementById("segElev"),
  blinkValue: document.getElementById("blinkValue"),
  totalBlinks: document.getElementById("totalBlinks"),
  eyeStatusFlag: document.getElementById("eyeStatusFlag"),
  eyeStatusText: document.getElementById("eyeStatusText"),
  sumAvgBpm: document.getElementById("sumAvgBpm"),
  sumStressTrend: document.getElementById("sumStressTrend"),
  sumDrowsy: document.getElementById("sumDrowsy"),
  sumBlinkAvg: document.getElementById("sumBlinkAvg"),
  recalibrateBtn: document.getElementById("recalibrateBtn"),
  soundToggleBtn: document.getElementById("soundToggleBtn"),
  soundToggleText: document.getElementById("soundToggleText"),
  soundIcon: document.getElementById("soundIcon"),
  sessionTimer: document.getElementById("sessionTimer"),
};

if (els.ringFg) {
  els.ringFg.style.strokeDasharray = `${RING_CIRCUMFERENCE}`;
}

// Instantiate Client Engines
const calibrator = new VitaLensDSP.BaselineCalibrator(CALIBRATION_TOTAL_SECONDS);
const eyeTracker = new VitaLensEye.ClientEyeTracker();

// Green Channel & Time Buffers
const greenBuffer = [];
const timeBuffer = [];
const historyBpm = [];
let drowsyAlertCount = 0;
let wasDrowsy = false;
let blinkSamples = [];
const sessionStartTime = Date.now();

// Offscreen canvas for fast green ROI extraction
const offscreenCanvas = document.createElement("canvas");
offscreenCanvas.width = 640;
offscreenCanvas.height = 480;
const offscreenCtx = offscreenCanvas.getContext("2d", { willReadFrequently: true });
const mainCtx = els.canvas.getContext("2d");

// Session Timer updater
setInterval(() => {
  if (!els.sessionTimer) return;
  const elapsed = Math.floor((Date.now() - sessionStartTime) / 1000);
  const mins = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const secs = String(elapsed % 60).padStart(2, "0");
  els.sessionTimer.textContent = `${mins}:${secs}`;
}, 1000);

// ---- Web Audio API Alert Sound --------------------------------------
let audioCtx = null;
let soundEnabled = false;
let wasAlerting = false;

function initAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }
}

function playAlertSound() {
  if (!soundEnabled) return;
  initAudio();
  if (!audioCtx) return;

  try {
    if (audioCtx.state === "suspended") {
      audioCtx.resume();
    }

    function beep(startTime, freq) {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.type = "square";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.6, startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.25);
      osc.start(startTime);
      osc.stop(startTime + 0.25);
    }

    const now = audioCtx.currentTime;
    beep(now, 1000);
    beep(now + 0.3, 1000);
  } catch (e) {
    console.warn("Audio playback error:", e);
  }
}

function checkAndPlayAlert(currentlyAlerting) {
  if (currentlyAlerting && !wasAlerting) {
    playAlertSound();
  }
  wasAlerting = Boolean(currentlyAlerting);
}

if (els.soundToggleBtn) {
  els.soundToggleBtn.addEventListener("click", () => {
    initAudio();
    soundEnabled = !soundEnabled;
    if (soundEnabled) {
      els.soundToggleBtn.classList.add("active");
      els.soundToggleText.textContent = "Sound: On";
      if (els.soundIcon) els.soundIcon.textContent = "🔊";
      playAlertSound();
    } else {
      els.soundToggleBtn.classList.remove("active");
      els.soundToggleText.textContent = "Sound: Off";
      if (els.soundIcon) els.soundIcon.textContent = "🔇";
    }
  });
}

// ---- Chart.js Setup with Neon Emerald Gradient ---------------------
const chartCanvas = document.getElementById("bpmChart");
const chartCtx = chartCanvas.getContext("2d");
const chartGradient = chartCtx.createLinearGradient(0, 0, 0, 70);
chartGradient.addColorStop(0, "rgba(16, 185, 129, 0.35)");
chartGradient.addColorStop(1, "rgba(16, 185, 129, 0.0)");

const bpmChart = new Chart(chartCtx, {
  type: "line",
  data: {
    labels: [],
    datasets: [{
      data: [],
      borderColor: "#10b981",
      backgroundColor: chartGradient,
      fill: true,
      tension: 0.4,
      pointRadius: 0,
      borderWidth: 2.2,
    }],
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    scales: {
      x: { display: false },
      y: { display: false },
    },
    plugins: { legend: { display: false } },
  },
});

function setPill(el, textEl, text, variant) {
  if (!el) return;
  el.className = `pill pill-${variant}`;
  if (textEl) {
    textEl.textContent = text;
  } else {
    el.textContent = text;
  }
}

function updateStressMeter(label) {
  if (!els.segLow || !els.segMod || !els.segElev) return;
  els.segLow.className = "meter-seg";
  els.segMod.className = "meter-seg";
  els.segElev.className = "meter-seg";

  if (label === "Low") {
    els.segLow.classList.add("active-low");
  } else if (label === "Moderate") {
    els.segMod.classList.add("active-mod");
  } else if (label === "Elevated") {
    els.segElev.classList.add("active-elev");
  }
}

// Compute average green channel value in forehead polygon ROI
function computePolygonMeanGreen(ctx, points, width, height) {
  if (points.length < 3) return null;

  ctx.save();
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(els.video, 0, 0, width, height);

  ctx.beginPath();
  ctx.moveTo(points[0].x * width, points[0].y * height);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x * width, points[i].y * height);
  }
  ctx.closePath();
  ctx.clip();

  // Find bounding box
  let minX = width, minY = height, maxX = 0, maxY = 0;
  for (const p of points) {
    const px = p.x * width;
    const py = p.y * height;
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }
  minX = Math.max(0, Math.floor(minX));
  minY = Math.max(0, Math.floor(minY));
  const bw = Math.min(width - minX, Math.ceil(maxX - minX));
  const bh = Math.min(height - minY, Math.ceil(maxY - minY));

  if (bw <= 0 || bh <= 0) {
    ctx.restore();
    return null;
  }

  const imgData = ctx.getImageData(minX, minY, bw, bh).data;
  ctx.restore();

  let greenSum = 0;
  let count = 0;
  // Step by 2 pixels for speed
  for (let i = 0; i < imgData.length; i += 8) {
    if (imgData[i + 3] > 0) { // non-transparent
      greenSum += imgData[i + 1];
      count++;
    }
  }

  return count > 0 ? greenSum / count : null;
}

// ---- MediaPipe FaceMesh & Frame Handler ------------------------------
let lastProcessTime = 0;

function onResults(results) {
  const width = els.canvas.width;
  const height = els.canvas.height;
  const now = Date.now() / 1000;

  // 1. Draw video frame on main canvas
  mainCtx.save();
  mainCtx.drawImage(results.image, 0, 0, width, height);

  let faceDetected = false;
  let liveBpm = null;
  let liveSdnn = null;
  let eyeSnapshot = null;

  if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
    faceDetected = true;
    const landmarks = results.multiFaceLandmarks[0];

    // Extract forehead ROI points
    const roiPoints = FOREHEAD_LANDMARKS.map(idx => landmarks[idx]);

    // Draw cybernetic forehead polygon contour
    mainCtx.beginPath();
    mainCtx.moveTo(roiPoints[0].x * width, roiPoints[0].y * height);
    for (let i = 1; i < roiPoints.length; i++) {
      mainCtx.lineTo(roiPoints[i].x * width, roiPoints[i].y * height);
    }
    mainCtx.closePath();
    mainCtx.strokeStyle = "rgba(16, 185, 129, 0.75)";
    mainCtx.lineWidth = 1.5;
    mainCtx.stroke();

    // Extract mean green value
    const meanGreen = computePolygonMeanGreen(offscreenCtx, roiPoints, width, height);

    if (meanGreen != null) {
      greenBuffer.push(meanGreen);
      timeBuffer.push(now);

      // Keep rolling BUFFER_SECONDS
      while (timeBuffer.length > 0 && now - timeBuffer[0] > BUFFER_SECONDS) {
        timeBuffer.shift();
        greenBuffer.shift();
      }

      // Signal processing if buffer >= 8 seconds (~240 frames)
      if (timeBuffer.length >= 120 && timeBuffer[timeBuffer.length - 1] - timeBuffer[0] >= 4.0) {
        const { tResampled, vResampled } = VitaLensDSP.resampleSignal(timeBuffer, greenBuffer, 30.0);
        if (vResampled.length >= 90) {
          const bpFiltered = VitaLensDSP.butterworthBandpass(vResampled);
          liveBpm = VitaLensDSP.computeHeartRateBPM(bpFiltered, 30.0);
          liveSdnn = VitaLensDSP.computeSDNN(bpFiltered, 30.0);
        }
      }
    }

    // Eye Strain & Drowsiness Tracking
    eyeSnapshot = eyeTracker.update(landmarks);
  } else {
    eyeSnapshot = eyeTracker.snapshot(null);
  }

  mainCtx.restore();

  // Baseline calibration update
  const calibState = calibrator.update(liveBpm, liveSdnn);
  const stressState = calibrator.evaluateStress(liveSdnn);
  const wellnessState = VitaLensWellness.computeWellnessScore(
    liveBpm,
    stressState.stress_label,
    eyeSnapshot.eye_strain,
    eyeSnapshot.drowsy
  );

  // Render complete state to UI
  renderUI({
    face_detected: faceDetected,
    bpm: liveBpm,
    sdnn_ms: liveSdnn != null ? Math.round(liveSdnn * 10) / 10 : null,
    calibration: calibState,
    stress_label: stressState.stress_label,
    stress_pct_deviation: stressState.stress_pct_deviation,
    eye: eyeSnapshot,
    wellness_score: wellnessState.score,
    wellness_label: wellnessState.label,
  });
}

function renderUI(state) {
  const calib = state.calibration || {};

  // 1. Calibration Overlay
  if (calib.calibrating) {
    els.calibOverlay.classList.remove("hidden");
    const remaining = calib.seconds_remaining ?? CALIBRATION_TOTAL_SECONDS;
    els.calibSeconds.textContent = Math.ceil(remaining);
    const progress = 1 - (remaining / CALIBRATION_TOTAL_SECONDS);
    if (els.ringFg) {
      els.ringFg.style.strokeDashoffset = `${RING_CIRCUMFERENCE * (1 - progress)}`;
    }
  } else {
    els.calibOverlay.classList.add("hidden");
  }

  // 2. Face tracking status
  if (state.face_detected) {
    setPill(els.faceStatus, els.faceStatusText, "Face Locked & Tracking", "good");
  } else {
    setPill(els.faceStatus, els.faceStatusText, "No Face Detected", "muted");
  }

  // 3. Composite Wellness Score
  const score = state.wellness_score;
  els.wellnessScore.textContent = score != null ? score : "--";
  if (els.wellnessBarFill) {
    els.wellnessBarFill.style.width = score != null ? `${score}%` : "0%";
  }

  if (calib.calibrating) {
    setPill(els.wellnessLabel, null, "Calibrating", "muted");
    if (els.wellnessDesc) els.wellnessDesc.textContent = "Establishing your individual baseline parameters…";
  } else {
    const wLabel = state.wellness_label ?? "--";
    let pillVariant = "good";
    if (wLabel === "Take a break") pillVariant = "danger";
    else if (wLabel === "Fair") pillVariant = "warn";

    setPill(els.wellnessLabel, null, wLabel, pillVariant);
    if (els.wellnessDesc) {
      if (score >= 80) els.wellnessDesc.textContent = "Optimal state: steady pulse, healthy HRV, low fatigue.";
      else if (score >= 60) els.wellnessDesc.textContent = "Good condition: mild eye strain or slightly elevated pulse.";
      else els.wellnessDesc.textContent = "Elevated stress or eye fatigue detected. Recommended: short break.";
    }
  }

  // 4. Heart Rate (BPM) & Beating Animation
  if (state.bpm != null) {
    els.bpmValue.textContent = state.bpm.toFixed(0);
    if (els.beatingHeart) {
      const beatPeriod = Math.max(0.35, Math.min(1.5, 60 / state.bpm));
      els.beatingHeart.style.animationDuration = `${beatPeriod}s`;
      els.beatingHeart.classList.add("heart-beat");
    }

    // Chart history
    historyBpm.push({ t: new Date().toLocaleTimeString(), bpm: state.bpm });
    if (historyBpm.length > 30) historyBpm.shift();

    bpmChart.data.labels = historyBpm.map(h => h.t);
    bpmChart.data.datasets[0].data = historyBpm.map(h => h.bpm);
    bpmChart.update("none");

    const bpms = historyBpm.map(h => h.bpm).filter(v => v != null);
    if (bpms.length) {
      const avg = bpms.reduce((a, b) => a + b, 0) / bpms.length;
      els.sumAvgBpm.textContent = avg.toFixed(0);
    }
  } else {
    els.bpmValue.textContent = "--";
    if (els.beatingHeart) {
      els.beatingHeart.classList.remove("heart-beat");
    }
  }

  // 5. Stress Level (HRV / SDNN)
  if (calib.calibrating) {
    els.stressValue.textContent = "--";
    els.stressDetail.textContent = `Establishing baseline… (${Math.ceil(calib.seconds_remaining ?? 0)}s remaining)`;
    updateStressMeter(null);
  } else if (state.stress_label) {
    els.stressValue.textContent = state.stress_label;
    const pct = state.stress_pct_deviation;
    els.stressDetail.textContent = pct != null
      ? `${pct > 0 ? "+" : ""}${pct}% vs baseline (baseline: ${calib.baseline_sdnn} ms, live: ${state.sdnn_ms} ms)`
      : "";
    updateStressMeter(state.stress_label);
    els.sumStressTrend.textContent = state.stress_label;
  } else {
    els.stressValue.textContent = "--";
    els.stressDetail.textContent = "Waiting for stable signal…";
    updateStressMeter(null);
  }

  // 6. Eye Strain & Drowsiness
  const eye = state.eye || {};
  els.blinkValue.textContent = eye.blink_rate_per_min ?? "--";
  if (els.totalBlinks) {
    els.totalBlinks.textContent = eye.total_blinks ?? 0;
  }
  if (eye.blink_rate_per_min != null) blinkSamples.push(eye.blink_rate_per_min);

  const isDrowsy = Boolean(eye.drowsy);
  const isStrain = Boolean(eye.eye_strain);
  const isAlerting = isDrowsy || isStrain;

  if (calib.calibrating) {
    setPill(els.eyeStatusFlag, els.eyeStatusText, "Calibrating", "muted");
    wasDrowsy = false;
  } else if (isDrowsy) {
    setPill(els.eyeStatusFlag, els.eyeStatusText, "Drowsy Alert!", "danger");
    if (!wasDrowsy) drowsyAlertCount += 1;
    wasDrowsy = true;
  } else if (isStrain) {
    setPill(els.eyeStatusFlag, els.eyeStatusText, "Eye Strain Flagged", "warn");
    wasDrowsy = false;
  } else {
    setPill(els.eyeStatusFlag, els.eyeStatusText, "Eyes Relaxed & Alert", "good");
    wasDrowsy = false;
  }

  els.sumDrowsy.textContent = drowsyAlertCount;
  if (blinkSamples.length) {
    const avgBlink = blinkSamples.reduce((a, b) => a + b, 0) / blinkSamples.length;
    els.sumBlinkAvg.textContent = avgBlink.toFixed(1);
  }

  checkAndPlayAlert(isAlerting);
}

// ---- Recalibrate Button Handler --------------------------------------
if (els.recalibrateBtn) {
  els.recalibrateBtn.addEventListener("click", () => {
    calibrator.reset();
    eyeTracker.reset();
    drowsyAlertCount = 0;
    blinkSamples = [];
    wasAlerting = false;
  });
}

// ---- Initialization: Camera & FaceMesh -------------------------------
async function initCameraAndModel() {
  try {
    setPill(els.faceStatus, els.faceStatusText, "Requesting Camera…", "muted");

    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, frameRate: { ideal: 30 } },
      audio: false,
    });

    els.video.srcObject = stream;
    await new Promise(resolve => {
      els.video.onloadedmetadata = () => {
        els.video.play();
        resolve();
      };
    });

    setPill(els.faceStatus, els.faceStatusText, "Loading FaceMesh AI…", "muted");

    const faceMesh = new FaceMesh({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
    });

    faceMesh.setOptions({
      maxNumFaces: 1,
      refineLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

    faceMesh.onResults(onResults);

    const camera = new Camera(els.video, {
      onFrame: async () => {
        await faceMesh.send({ image: els.video });
      },
      width: 640,
      height: 480,
    });

    camera.start();
    setPill(els.faceStatus, els.faceStatusText, "Camera Ready", "good");
  } catch (err) {
    console.error("Camera/FaceMesh initialization error:", err);
    setPill(els.faceStatus, els.faceStatusText, `Camera error: ${err.name || err.message}`, "danger");
  }
}

window.addEventListener("DOMContentLoaded", initCameraAndModel);
