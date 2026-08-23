/**
 * VitaLens Composite Wellness Index Synthesizer
 */

function computeWellnessScore(bpm, stressLabel, eyeStrain, drowsy) {
  let score = 100;

  if (bpm != null) {
    if (bpm < 50 || bpm > 100) {
      score -= 15;
    }
  }

  if (stressLabel === "Moderate") {
    score -= 10;
  } else if (stressLabel === "Elevated") {
    score -= 25;
  }

  if (eyeStrain) {
    score -= 15;
  }

  if (drowsy) {
    score -= 35;
  }

  score = Math.max(0, Math.min(100, score));

  let label = "Good";
  if (score < 60) {
    label = "Take a break";
  } else if (score < 80) {
    label = "Fair";
  }

  return { score, label };
}

window.VitaLensWellness = {
  computeWellnessScore,
};
