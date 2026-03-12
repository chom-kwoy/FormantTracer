import { erf } from "mathjs";

export class KalmanFilter {
  constructor(
    eig,
    F1_INTERVALS = 10,
    F2_INTERVALS = 10,
    F1_MIN = 200,
    F1_MAX = 1500,
    F2_MIN = 500,
    F2_MAX = 3000,
    F1_SCALE = 50,
    F2_SCALE = 60,
    F1_EMIT_SCALE = 50,
    F2_EMIT_SCALE = 60,
    F1_MISSING_PR = 0.1,
    F1_MISSING_AND_F2_SAME_PR = 0.1,
    F2_MISSING_PR = 0.01,
  ) {
    this.eig = eig;
    this.F1_INTERVALS = F1_INTERVALS;
    this.F2_INTERVALS = F2_INTERVALS;
    this.F1_MIN = F1_MIN;
    this.F1_MAX = F1_MAX;
    this.F2_MIN = F2_MIN;
    this.F2_MAX = F2_MAX;
    this.F1_SCALE = F1_SCALE;
    this.F2_SCALE = F2_SCALE;
    this.F1_EMIT_SCALE = F1_EMIT_SCALE;
    this.F2_EMIT_SCALE = F2_EMIT_SCALE;
    this.F1_MISSING_PR = F1_MISSING_PR;
    this.F1_MISSING_AND_F2_SAME_PR = F1_MISSING_AND_F2_SAME_PR;
    this.F2_MISSING_PR = F2_MISSING_PR;

    this.trMat = this.make_transition_matrix();

    // Initial probability distribution
    this.alpha = new eig.Matrix(this.F1_INTERVALS * this.F2_INTERVALS, 1);
    for (let i = 0; i < this.F1_INTERVALS; ++i) {
      for (let j = 0; j < this.F2_INTERVALS; ++j) {
        let pr = 1 / (this.F1_INTERVALS * this.F2_INTERVALS);
        this.alpha.set(i * this.F2_INTERVALS + j, 0, pr);
      }
    }

    this.tmpMat = new eig.Matrix(
      this.F1_INTERVALS * this.F2_INTERVALS,
      this.F1_INTERVALS * this.F2_INTERVALS,
    );
    this.emission_prs = new eig.Matrix(
      this.F1_INTERVALS * this.F2_INTERVALS,
      1,
    );

    this.f1 = F1_MIN + (F1_MAX - F1_MIN) / 2;
    this.f2 = F2_MIN + (F2_MAX - F2_MIN) / 2;

    // Variance
    this.p1 = 500;
    this.p2 = 1000;

    // Process noise
    this.q1 = 20;
    this.q2 = 40;

    // Measurement noise
    this.r1 = 40;
    this.r2 = 80;
  }

  add_and_predict(F1, F2) {
    for (let i = 0; i < this.F1_INTERVALS; ++i) {
      for (let j = 0; j < this.F2_INTERVALS; ++j) {
        const [pr, _] = this.emission_probability(i, j, F1, F2);
        this.emission_prs.set(i * this.F2_INTERVALS + j, 0, pr);
      }
    }

    for (let i = 0; i < this.F1_INTERVALS; ++i) {
      for (let j = 0; j < this.F2_INTERVALS; ++j) {
        for (let k = 0; k < this.F1_INTERVALS; ++k) {
          for (let l = 0; l < this.F2_INTERVALS; ++l) {
            const s = i * this.F2_INTERVALS + j;
            const t = k * this.F2_INTERVALS + l;
            this.tmpMat.set(
              s,
              t,
              this.trMat.get(s, t) * this.emission_prs.get(s, 0),
            );
          }
        }
      }
    }
    this.alpha = this.tmpMat.matMul(this.alpha);
    this.alpha = this.alpha.div(this.alpha.sum());

    // Find the most likely state
    let max_pr = -1;
    let max_idx = -1;
    for (let i = 0; i < this.F1_INTERVALS * this.F2_INTERVALS; ++i) {
      if (this.alpha.get(i, 0) > max_pr) {
        max_pr = this.alpha.get(i, 0);
        max_idx = i;
      }
    }
    const max_f1 = Math.floor(max_idx / this.F2_INTERVALS);
    const max_f2 = max_idx % this.F2_INTERVALS;

    const [_, max_case] = this.emission_probability(max_f1, max_f2, F1, F2);

    let F1_result = F1;
    let F2_result = F2;
    switch (max_case) {
      case 1:
      case 2:
        F1_result = this.f1_idx_to_value(max_f1);
        F2_result = F1;
        break;
      case 3:
        F1_result = this.f1_idx_to_value(max_f1);
        F2_result = this.f2_idx_to_value(max_f2);
        break;
    }

    // Continuous kalman filter
    this.p1 += this.q1;
    let y1 = F1_result - this.f1;
    let K1 = this.p1 / (this.p1 + this.r1);
    this.f1 += K1 * y1;
    this.p1 = (1 - K1) * (1 - K1) * this.p1 + K1 * K1 * this.r1;

    this.p2 += this.q2;
    let y2 = F2_result - this.f2;
    let K2 = this.p2 / (this.p2 + this.r2);
    this.f2 += K2 * y2;
    this.p2 = (1 - K2) * (1 - K2) * this.p2 + K2 * K2 * this.r2;

    return [this.f1, this.f2];
  }

  // P(y_f1, y_f2 | f1, f2)
  emission_probability(f1, f2, y_f1, y_f2) {
    f1 = this.f1_idx_to_value(f1);
    f2 = this.f2_idx_to_value(f2);

    let y_f1_pr, y_f2_pr;

    // Case 1: normal
    y_f1_pr = this.norm_pdf(y_f1, f1, this.F1_EMIT_SCALE);
    y_f2_pr = this.norm_pdf(y_f2, f2, this.F2_EMIT_SCALE);
    const y_pr_normal = y_f1_pr * y_f2_pr;

    // Case 2: F1 is missing and y_F1=F2, y_F2=F3
    y_f1_pr = this.norm_pdf(y_f1, f2, this.F2_EMIT_SCALE);
    y_f2_pr = 1 / (5000 - y_f1);
    const y_pr_F1_missing = y_f1_pr * y_f2_pr;

    // Case 3: F1 is missing and y_F1=y_F2=F2
    y_f1_pr = this.norm_pdf(y_f1, f2, this.F2_EMIT_SCALE);
    y_f2_pr = this.norm_pdf(y_f2, f2, this.F2_EMIT_SCALE);
    const y_pr_F1_missing_and_F2_same = y_f1_pr * y_f2_pr;

    // Case 4: F2 is missing and y_F1=F1, F1<y_F2<F2
    y_f1_pr = this.norm_pdf(y_f1, f1, this.F1_EMIT_SCALE);
    y_f2_pr = f1 < y_f2 && y_f2 < f2 ? 1 / (f2 - f1) : 0;
    const y_pr_F2_missing = y_f1_pr * y_f2_pr;

    const prs = [
      (1 -
        this.F1_MISSING_PR -
        this.F1_MISSING_AND_F2_SAME_PR -
        this.F2_MISSING_PR) *
        y_pr_normal,
      this.F1_MISSING_PR * y_pr_F1_missing,
      this.F1_MISSING_AND_F2_SAME_PR * y_pr_F1_missing_and_F2_same,
      this.F2_MISSING_PR * y_pr_F2_missing,
    ];

    let max_pr = -1;
    let max_idx = -1;
    for (let i = 0; i < prs.length; ++i) {
      if (prs[i] > max_pr) {
        max_pr = prs[i];
        max_idx = i;
      }
    }

    return [prs[0] + prs[1] + prs[2] + prs[3], max_idx];
  }

  // P(f1_t, f2_t | f1_tm1, f2_tm1)
  transition_probability(f1_tm1, f2_tm1, f1_t, f2_t) {
    f1_t = this.f1_idx_to_range(f1_t);
    f2_t = this.f2_idx_to_range(f2_t);
    f1_tm1 = this.f1_idx_to_value(f1_tm1);
    f2_tm1 = this.f2_idx_to_value(f2_tm1);

    const f1_pr =
      this.norm_cdf(f1_t[1], f1_tm1, this.F1_SCALE) -
      this.norm_cdf(f1_t[0], f1_tm1, this.F1_SCALE);
    const f2_pr =
      this.norm_cdf(f2_t[1], f2_tm1, this.F2_SCALE) -
      this.norm_cdf(f2_t[0], f2_tm1, this.F2_SCALE);
    const pr = f1_pr * f2_pr;

    if (f1_t[0] > f2_t[1]) {
      return 0;
    }

    return pr;
  }

  norm_pdf(x, mu, sigma) {
    return (
      (1 / (sigma * Math.sqrt(2 * Math.PI))) *
      Math.exp(-0.5 * Math.pow((x - mu) / sigma, 2))
    );
  }

  norm_cdf(x, mu, sigma) {
    return 0.5 * (1 + erf((x - mu) / (sigma * Math.sqrt(2))));
  }

  make_transition_matrix() {
    const trMat = new this.eig.Matrix(
      this.F1_INTERVALS * this.F2_INTERVALS,
      this.F1_INTERVALS * this.F2_INTERVALS,
    );

    for (let i = 0; i < this.F1_INTERVALS; ++i) {
      for (let j = 0; j < this.F2_INTERVALS; ++j) {
        for (let k = 0; k < this.F1_INTERVALS; ++k) {
          for (let l = 0; l < this.F2_INTERVALS; ++l) {
            trMat.set(
              i * this.F2_INTERVALS + j,
              k * this.F2_INTERVALS + l,
              this.transition_probability(i, j, k, l),
            );
          }
        }
      }
    }

    // normalize probabilities
    for (let i = 0; i < this.F1_INTERVALS * this.F2_INTERVALS; ++i) {
      let sum = 0;
      for (let j = 0; j < this.F1_INTERVALS * this.F2_INTERVALS; ++j) {
        sum += trMat.get(i, j);
      }
      for (let j = 0; j < this.F1_INTERVALS * this.F2_INTERVALS; ++j) {
        trMat.set(i, j, trMat.get(i, j) / sum);
      }
    }

    return trMat;
  }

  f1_idx_to_value(i) {
    return (
      (i / (this.F1_INTERVALS - 1)) * (this.F1_MAX - this.F1_MIN) + this.F1_MIN
    );
  }
  f2_idx_to_value(i) {
    return (
      (i / (this.F2_INTERVALS - 1)) * (this.F2_MAX - this.F2_MIN) + this.F2_MIN
    );
  }
  f1_idx_to_range(i) {
    return [
      i === 0 ? Number.NEGATIVE_INFINITY : this.f1_idx_to_value(i - 0.5),
      i === this.F1_INTERVALS - 1
        ? Number.POSITIVE_INFINITY
        : this.f1_idx_to_value(i + 0.5),
    ];
  }
  f2_idx_to_range(i) {
    return [
      i === 0 ? Number.NEGATIVE_INFINITY : this.f2_idx_to_value(i - 0.5),
      i === this.F2_INTERVALS - 1
        ? Number.POSITIVE_INFINITY
        : this.f2_idx_to_value(i + 0.5),
    ];
  }
  f1_value_to_idx(x) {
    return Math.min(
      Math.max(
        Math.round(
          ((x - this.F1_MIN) / (this.F1_MAX - this.F1_MIN)) *
            (this.F1_INTERVALS - 1),
        ),
        0,
      ),
      this.F1_INTERVALS - 1,
    );
  }
  f2_value_to_idx(x) {
    return Math.min(
      Math.max(
        Math.round(
          ((x - this.F2_MIN) / (this.F2_MAX - this.F2_MIN)) *
            (this.F2_INTERVALS - 1),
        ),
        0,
      ),
      this.F2_INTERVALS - 1,
    );
  }
}
