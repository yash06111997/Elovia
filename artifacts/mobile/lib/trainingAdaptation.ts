export interface WorkoutFeedback {
  /** Session effort (RPE), 1–10. */
  effort: number;
  /** Pain experienced during the session, 0–10. */
  pain: number;
  /** How enjoyable the session felt, 1–5. */
  enjoyment: number;
  /** Perceived readiness for the next session, 1–5. */
  readiness: number;
}

export interface TrainingAdjustment {
  direction: "reduce" | "maintain" | "progress";
  volumeFactor: number;
  summary: string;
}

/**
 * A deliberately conservative rules engine. Pain always outranks performance,
 * and progression requires several positive signals rather than one easy day.
 */
export function recommendTrainingAdjustment(
  feedback: WorkoutFeedback,
): TrainingAdjustment {
  if (feedback.pain >= 7) {
    return {
      direction: "reduce",
      volumeFactor: 0.7,
      summary:
        "Reduce the next session and prioritise recovery. Persistent or sharp pain needs professional assessment.",
    };
  }

  if (feedback.pain >= 4) {
    return {
      direction: "reduce",
      volumeFactor: 0.85,
      summary:
        "Use a lighter next session and avoid movements that reproduce pain.",
    };
  }

  if (feedback.effort >= 9 || feedback.readiness <= 2) {
    return {
      direction: "reduce",
      volumeFactor: 0.85,
      summary: "Trim the next session slightly so fatigue does not compound.",
    };
  }

  if (
    feedback.effort <= 6 &&
    feedback.pain <= 2 &&
    feedback.enjoyment >= 4 &&
    feedback.readiness >= 4
  ) {
    return {
      direction: "progress",
      volumeFactor: 1.05,
      summary:
        "You look ready for a small progression next time—about 5% more load or volume.",
    };
  }

  return {
    direction: "maintain",
    volumeFactor: 1,
    summary:
      "Keep the next session at the current level and continue monitoring recovery.",
  };
}
