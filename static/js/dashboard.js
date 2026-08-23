const CALIBRATION_TOTAL_SECONDS = 30;
const RING_RADIUS = 58;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

const els = {
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

let drowsyAlertCount = 0;
let wasDrowsy = false;
let blinkSamples = [];
const sessionStartTime = Date.now();

// Session Timer updater
setInterval(() => {
  if (!els.sessionTimer) return;
  const elapsed = Math.floor((Date.now() - sessionStartTime) / 1000);
  const mins = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const secs = String(elapsed % 60).padStart(2, "0");
  els.sessionTimer.textContent = `${mins}:${secs}`;
}, 1000);

// ---- Web Audio API alert sound (Square wave, double beep @ 1000Hz) ---
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

// ---- Chart.js Setup with Neon Gradient -----------------------------
const ctx = document.getElementById("bpmChart").getContext("2d");
const chartGradient = ctx.createLinearGradient(0, 0, 0, 70);
chartGradient.addColorStop(0, "rgba(16, 185, 129, 0.35)");
chartGradient.addColorStop(1, "rgba(16, 185, 129, 0.0)");

const bpmChart = new Chart(ctx, {
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
      shadowColor: "rgba(16, 185, 129, 0.5)",
      shadowBlur: 10,
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

function render(state) {
  // 1. Calibration overlay & circular progress ring
  const calib = state.calibration || {};
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

  // 4. Heart Rate (BPM) & Beating animation
  if (state.bpm != null) {
    els.bpmValue.textContent = state.bpm.toFixed(0);
    if (els.beatingHeart) {
      const beatPeriod = Math.max(0.35, Math.min(1.5, 60 / state.bpm));
      els.beatingHeart.style.animationDuration = `${beatPeriod}s`;
      els.beatingHeart.classList.add("heart-beat");
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
    console.log(`[VitaLens] BPM: ${state.bpm} | Live SDNN: ${state.sdnn_ms}ms | Baseline: ${calib.baseline_sdnn}ms | Stress: ${state.stress_label} (${pct}%)`);
  } else {
    els.stressValue.textContent = "--";
    els.stressDetail.textContent = "Waiting for stable signal…";
    updateStressMeter(null);
  }

  // 6. Eye Strain & Drowsiness
  const eye = state.eye || {};
  els.blinkValue.textContent = eye.blink_rate_per_min ?? "--";
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

  checkAndPlayAlert(isAlerting);

  // 7. Chart updates & Session rolling summary
  const history = state.history || [];
  if (history.length) {
    bpmChart.data.labels = history.map(h => h.t);
    bpmChart.data.datasets[0].data = history.map(h => h.bpm);
    bpmChart.update("none");

    const bpms = history.map(h => h.bpm).filter(v => v != null);
    if (bpms.length) {
      const avg = bpms.reduce((a, b) => a + b, 0) / bpms.length;
      els.sumAvgBpm.textContent = avg.toFixed(0);
    }
  }

  els.sumDrowsy.textContent = drowsyAlertCount;
  if (blinkSamples.length) {
    const avgBlink = blinkSamples.reduce((a, b) => a + b, 0) / blinkSamples.length;
    els.sumBlinkAvg.textContent = avgBlink.toFixed(1);
  }

  if (!calib.calibrating && state.stress_label) {
    els.sumStressTrend.textContent = state.stress_label;
  }
}

async function poll() {
  try {
    const res = await fetch("/api/data");
    const state = await res.json();
    render(state);
  } catch (e) {
    // Camera or backend initializing; retry
  } finally {
    setTimeout(poll, 1000);
  }
}

if (els.recalibrateBtn) {
  els.recalibrateBtn.addEventListener("click", async () => {
    drowsyAlertCount = 0;
    blinkSamples = [];
    wasAlerting = false;
    await fetch("/api/calibrate/restart", { method: "POST" });
  });
}

poll();


