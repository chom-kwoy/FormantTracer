export class FormantTracker {
  constructor() {
    this.state = null;
    this.variance = null;

    this.priors = [
      { center: 550, var: 300 * 300 },
      { center: 1600, var: 500 * 500 },
      { center: 2700, var: 500 * 500 },
    ];

    this.processNoise = [3000, 5000, 5000];
    this.measureNoise = [2500, 4000, 5000];
    this.missingPenalty = 12;
    this.priorWeight = 0.002;
    this.maxVariance = 500 * 500;
  }

  update(formants) {
    if (this.state === null) {
      return this._initialize(formants);
    }

    // --- Predict step ---
    // As variance grows, blend prediction toward prior center.
    // This is the key fix: after a pause, tracks relax toward
    // expected ranges instead of staying stuck at stale values.
    const predicted = new Array(3);
    const predVar = new Array(3);
    for (let t = 0; t < 3; t++) {
      const v = this.variance[t] + this.processNoise[t];
      predVar[t] = v;

      // How much to trust the prior vs the last state
      // At low variance (confident), priorBlend ≈ 0 (trust last state)
      // At high variance (after gaps), priorBlend → 1 (trust prior)
      const priorBlend = v / (v + this.priors[t].var);
      predicted[t] =
        (1 - priorBlend) * this.state[t] + priorBlend * this.priors[t].center;
    }

    // Reset if all tracks have diverged
    if (predVar.every((v) => v > this.maxVariance)) {
      this.state = null;
      this.variance = null;
      return this._initialize(formants);
    }

    // No observations — just update state to prediction and return
    if (formants.length === 0) {
      this.state = predicted;
      this.variance = predVar;
      return [null, null, null];
    }

    // --- Assignment ---
    const best = this._bestAssignment(formants, predicted, predVar);

    // --- Update step ---
    const result = [null, null, null];
    const newState = [...predicted];
    const newVar = [...predVar];

    for (let t = 0; t < 3; t++) {
      const obsIdx = best[t];
      if (obsIdx !== null) {
        const z = formants[obsIdx];
        const S = predVar[t] + this.measureNoise[t];
        const K = predVar[t] / S;
        newState[t] = predicted[t] + K * (z - predicted[t]);
        newVar[t] = (1 - K) * predVar[t];
        result[t] = newState[t];
      }
    }

    this.state = newState;
    this.variance = newVar;

    return result;
  }

  _bestAssignment(formants, predicted, predVar) {
    const options = [null, ...formants.map((_, i) => i)];

    let bestScore = -Infinity;
    let bestAssignment = [null, null, null];

    for (const a0 of options) {
      for (const a1 of options) {
        if (a1 !== null && a1 === a0) continue;
        for (const a2 of options) {
          if (a2 !== null && (a2 === a0 || a2 === a1)) continue;

          const assignment = [a0, a1, a2];
          if (!this._checkOrdering(formants, assignment)) continue;

          // Require at least 1 assignment — don't allow all-null
          if (a0 === null && a1 === null && a2 === null) continue;

          const score = this._scoreAssignment(
            formants,
            assignment,
            predicted,
            predVar,
          );

          if (score > bestScore) {
            bestScore = score;
            bestAssignment = assignment;
          }
        }
      }
    }

    return bestAssignment;
  }

  _checkOrdering(formants, assignment) {
    let prev = -Infinity;
    for (let t = 0; t < 3; t++) {
      if (assignment[t] !== null) {
        const f = formants[assignment[t]];
        if (f <= prev) return false;
        prev = f;
      }
    }
    return true;
  }

  _scoreAssignment(formants, assignment, predicted, predVar) {
    let score = 0;

    for (let t = 0; t < 3; t++) {
      const obsIdx = assignment[t];

      if (obsIdx !== null) {
        const z = formants[obsIdx];
        const S = predVar[t] + this.measureNoise[t];

        // Innovation log-likelihood
        const innovation = z - predicted[t];
        score += (-0.5 * (innovation * innovation)) / S - 0.5 * Math.log(S);

        // Prior pull
        const priorDist = z - this.priors[t].center;
        score -=
          (this.priorWeight * (priorDist * priorDist)) / this.priors[t].var;
      } else {
        // Scale missing penalty by confidence — if we're uncertain anyway,
        // missing is less surprising; if we're confident, missing is costly
        const confidence =
          this.priors[t].var / (predVar[t] + this.priors[t].var);
        score -= this.missingPenalty * (0.5 + 0.5 * confidence);
      }
    }

    // Bonus for more assignments — prefer explaining observations
    let nAssigned = assignment.filter((a) => a !== null).length;
    score += nAssigned * 8;

    return score;
  }

  _initialize(formants) {
    if (formants.length < 2) return [null, null, null];

    const options = [null, ...formants.map((_, i) => i)];

    let bestScore = -Infinity;
    let bestAssignment = [null, null, null];

    for (const a0 of options) {
      for (const a1 of options) {
        if (a1 !== null && a1 === a0) continue;
        for (const a2 of options) {
          if (a2 !== null && (a2 === a0 || a2 === a1)) continue;

          const assignment = [a0, a1, a2];
          if (!this._checkOrdering(formants, assignment)) continue;

          let score = 0;
          let nAssigned = 0;
          for (let t = 0; t < 3; t++) {
            if (assignment[t] !== null) {
              const f = formants[assignment[t]];
              const dist = f - this.priors[t].center;
              score -= (dist * dist) / this.priors[t].var;
              nAssigned++;
            } else {
              score -= this.missingPenalty;
            }
          }
          if (nAssigned < 2) continue;

          if (score > bestScore) {
            bestScore = score;
            bestAssignment = assignment;
          }
        }
      }
    }

    this.state = [
      this.priors[0].center,
      this.priors[1].center,
      this.priors[2].center,
    ];
    this.variance = [
      this.priors[0].var,
      this.priors[1].var,
      this.priors[2].var,
    ];

    const result = [null, null, null];
    for (let t = 0; t < 3; t++) {
      if (bestAssignment[t] !== null) {
        const z = formants[bestAssignment[t]];
        const S = this.variance[t] + this.measureNoise[t];
        const K = this.variance[t] / S;
        this.state[t] = this.priors[t].center + K * (z - this.priors[t].center);
        this.variance[t] = (1 - K) * this.variance[t];
        result[t] = this.state[t];
      }
    }

    return result;
  }
}
