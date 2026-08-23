"""
Combine the three live signals into one glanceable Wellness Score
(VitaLens Documentation, Section 15 Part 5, Step 3).

This is intentionally simple and explainable -- judges can follow the
scoring logic in one sentence, which matters as much as the number itself.
"""


def compute_wellness_score(bpm, stress_label, eye_strain, drowsy):
    """
    Returns an integer 0-100 wellness score plus a short label.
    Starts at 100 and subtracts penalties for each concerning signal.
    """
    score = 100

    # Heart rate: penalize only if clearly outside a relaxed resting range.
    if bpm is not None:
        if bpm > 100 or bpm < 45:
            score -= 15
        elif bpm > 90:
            score -= 5

    # Stress / HRV deviation from personal baseline.
    if stress_label == "Elevated":
        score -= 30
    elif stress_label == "Moderate":
        score -= 15

    # Eye strain / drowsiness.
    if drowsy:
        score -= 25
    elif eye_strain:
        score -= 10

    score = max(0, min(100, score))

    if score >= 80:
        label = "Great"
    elif score >= 60:
        label = "Good"
    elif score >= 40:
        label = "Fair"
    else:
        label = "Take a break"

    return score, label
