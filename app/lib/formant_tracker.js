export class FormantTracker {
  constructor() {
    this.f1 = null;
    this.f2 = null;
    this.f3 = null;
    this.maxJump = 200;
    this.smooth = 0.7;
    this.missCount = 0;
    this.resetAfter = 5; // reset after this many consecutive misses
    this.priors = [
      { center: 550, width: 300 },
      { center: 1600, width: 500 },
      { center: 2700, width: 500 },
    ];
    this.priorWeight = 0.3;
  }

  update(formants) {
    if (formants.length < 3) {
      this.missCount++;
      if (this.missCount >= this.resetAfter) {
        this.f1 = null;
        this.f2 = null;
        this.f3 = null;
      }
      return [this.f1, this.f2, this.f3];
    }

    if (this.f1 === null) {
      this.missCount = 0;
      return this._initialize(formants);
    }

    let bestF1 = null,
      bestF2 = null,
      bestF3 = null;
    let bestCost = Infinity;
    const tracks = [this.f1, this.f2, this.f3];

    for (let i = 0; i < formants.length; i++) {
      for (let j = i + 1; j < formants.length; j++) {
        for (let k = j + 1; k < formants.length; k++) {
          const candidates = [formants[i], formants[j], formants[k]];

          let contCost =
            Math.abs(candidates[0] - tracks[0]) +
            Math.abs(candidates[1] - tracks[1]) +
            Math.abs(candidates[2] - tracks[2]);

          let priorCost = 0;
          for (let n = 0; n < 3; n++) {
            priorCost +=
              Math.abs(candidates[n] - this.priors[n].center) /
              this.priors[n].width;
          }

          let cost =
            (1 - this.priorWeight) * contCost +
            this.priorWeight * priorCost * 200;

          if (cost < bestCost) {
            bestCost = cost;
            bestF1 = candidates[0];
            bestF2 = candidates[1];
            bestF3 = candidates[2];
          }
        }
      }
    }

    let updated = false;
    if (Math.abs(bestF1 - this.f1) <= this.maxJump) {
      this.f1 = this.smooth * this.f1 + (1 - this.smooth) * bestF1;
      updated = true;
    }
    if (Math.abs(bestF2 - this.f2) <= this.maxJump) {
      this.f2 = this.smooth * this.f2 + (1 - this.smooth) * bestF2;
      updated = true;
    }
    if (Math.abs(bestF3 - this.f3) <= this.maxJump) {
      this.f3 = this.smooth * this.f3 + (1 - this.smooth) * bestF3;
      updated = true;
    }

    if (updated) {
      this.missCount = 0;
    } else {
      // All three were gated — nothing matched
      this.missCount++;
      if (this.missCount >= this.resetAfter) {
        this.f1 = null;
        this.f2 = null;
        this.f3 = null;
        return this._initialize(formants);
      }
    }

    return [this.f1, this.f2, this.f3];
  }

  _initialize(formants) {
    let bestCost = Infinity;
    let bestTriple = [formants[0], formants[1], formants[2]];

    for (let i = 0; i < formants.length; i++) {
      for (let j = i + 1; j < formants.length; j++) {
        for (let k = j + 1; k < formants.length; k++) {
          let cost =
            Math.abs(formants[i] - this.priors[0].center) /
              this.priors[0].width +
            Math.abs(formants[j] - this.priors[1].center) /
              this.priors[1].width +
            Math.abs(formants[k] - this.priors[2].center) /
              this.priors[2].width;
          if (cost < bestCost) {
            bestCost = cost;
            bestTriple = [formants[i], formants[j], formants[k]];
          }
        }
      }
    }

    [this.f1, this.f2, this.f3] = bestTriple;
    this.missCount = 0;
    return [this.f1, this.f2, this.f3];
  }
}
