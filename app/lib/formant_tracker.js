export class FormantTracker {
  constructor() {
    this.state = null;
    this.variance = null;
    this.smoothed = null;
    this.smoothing = 0.5; // 0 = no smoothing, higher = more smooth

    this.priors = [
      { center: 550, var: 500 * 500 },
      { center: 1600, var: 1000 * 1000 },
      { center: 2700, var: 1000 * 1000 },
    ];

    this.processNoise = [3000, 5000, 5000];
    this.measureNoise = [2500, 4000, 5000];
    this.missingPenalty = 12;
    this.priorWeight = 0.002;
    this.maxVariance = 500 * 500;
  }

  _smooth(result) {
    if (this.smoothed === null) {
      this.smoothed = [...result];
    } else {
      for (let t = 0; t < 3; t++) {
        if (result[t] !== null) {
          this.smoothed[t] =
            this.smoothing * this.smoothed[t] +
            (1 - this.smoothing) * result[t];
        }
      }
    }
    return [...this.smoothed];
  }

  update(formants) {
    if (this.state === null) {
      const init = this._initialize(formants);
      init.formants = this._smooth(init.formants);
      return init;
    }

    // --- Predict step ---
    const predicted = new Array(3);
    const predVar = new Array(3);
    for (let t = 0; t < 3; t++) {
      const v = this.variance[t] + this.processNoise[t];
      predVar[t] = v;

      const priorBlend = v / (v + this.priors[t].var);
      predicted[t] =
        (1 - priorBlend) * this.state[t] + priorBlend * this.priors[t].center;
    }

    // Reset if all tracks have diverged
    if (predVar.every((v) => v > this.maxVariance)) {
      this.state = null;
      this.variance = null;
      this.smoothed = null;
      const init = this._initialize(formants);
      init.formants = this._smooth(init.formants);
      return init;
    }

    // No observations — coast on prediction
    if (formants.length === 0) {
      this.state = predicted;
      this.variance = predVar;
      return {
        formants: this._smooth(predicted),
        confidence: predVar.map(
          (v, t) => this.priors[t].var / (v + this.priors[t].var),
        ),
      };
    }

    // --- Assignment ---
    const best = this._bestAssignment(formants, predicted, predVar);

    // --- Update step ---
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
      }
    }

    this.state = newState;
    this.variance = newVar;

    return {
      formants: this._smooth(newState),
      confidence: newVar.map(
        (v, t) => this.priors[t].var / (v + this.priors[t].var),
      ),
    };
  }

  _bestAssignment(formants, predicted, predVar) {
    const N = formants.length;
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

        const innovation = z - predicted[t];
        score += (-0.5 * (innovation * innovation)) / S - 0.5 * Math.log(S);

        const priorDist = z - this.priors[t].center;
        score -=
          (this.priorWeight * (priorDist * priorDist)) / this.priors[t].var;
      } else {
        const confidence =
          this.priors[t].var / (predVar[t] + this.priors[t].var);
        score -= this.missingPenalty * (0.5 + 0.5 * confidence);
      }
    }

    let nAssigned = assignment.filter((a) => a !== null).length;
    score += nAssigned * 2;

    return score;
  }

  _initialize(formants) {
    const empty = {
      formants: [null, null, null],
      confidence: [0, 0, 0],
    };

    if (formants.length < 2) return empty;

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

    if (bestAssignment.every((a) => a === null)) return empty;

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

    const result = [...this.state];
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

    return {
      formants: result,
      confidence: this.variance.map(
        (v, t) => this.priors[t].var / (v + this.priors[t].var),
      ),
    };
  }
}
