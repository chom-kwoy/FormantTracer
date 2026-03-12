import { DeblurredCanvas } from "@/app/lib/types";

interface VowelReference {
  vowel: string;
  F1: number;
  F2: number;
}

interface TrailPoint {
  x: number;
  y: number;
  r: number;
  hue: number;
}

const VOWELS: VowelReference[] = [
  { vowel: "i", F1: 250, F2: 2400 },
  { vowel: "y", F1: 245, F2: 2050 },
  { vowel: "e", F1: 390, F2: 2300 },
  { vowel: "ø", F1: 370, F2: 1900 },
  { vowel: "ɛ", F1: 610, F2: 1900 },
  { vowel: "œ", F1: 590, F2: 1710 },
  { vowel: "a", F1: 850, F2: 1610 },
  { vowel: "ɶ", F1: 810, F2: 1550 },

  { vowel: "u", F1: 250, F2: 550 },
  { vowel: "ɯ", F1: 300, F2: 1500 },
  { vowel: "o", F1: 350, F2: 650 },
  { vowel: "ɤ", F1: 460, F2: 1300 },
  { vowel: "ɔ", F1: 500, F2: 700 },
  { vowel: "ʌ", F1: 600, F2: 1200 },
  { vowel: "ɒ", F1: 700, F2: 750 },
  { vowel: "ɑ", F1: 750, F2: 950 },
];

type TransformFunction = (x: number) => number;

export class FormantGrid {
  private vowelCanvas: DeblurredCanvas;
  private vowelCanvasCtx: CanvasRenderingContext2D;
  private offCanvas: HTMLCanvasElement;
  private offCtx: CanvasRenderingContext2D;

  private transformFunctionF1: TransformFunction;
  private transformFunctionF2: TransformFunction;
  private f1Min: number;
  private f1Max: number;
  private f2Min: number;
  private f2Max: number;

  private trail: (TrailPoint | null)[];
  private maxTrail: number;
  private decayRate: number;

  constructor(
    vowelCanvas: DeblurredCanvas,
    f1Min: number,
    f1Max: number,
    f2Min: number,
    f2Max: number,
    transformFunctionF1: TransformFunction,
    transformFunctionF2: TransformFunction,
  ) {
    this.vowelCanvas = vowelCanvas;
    this.vowelCanvasCtx = vowelCanvas.getContext("2d")!;

    const dpr = window.devicePixelRatio;
    this.vowelCanvasCtx.scale(dpr, dpr);

    // Single offscreen canvas for trail
    this.offCanvas = document.createElement("canvas");
    this.offCanvas.width = vowelCanvas.origWidth * dpr;
    this.offCanvas.height = vowelCanvas.origHeight * dpr;
    this.offCtx = this.offCanvas.getContext("2d")!;
    this.offCtx.scale(dpr, dpr);

    this.transformFunctionF1 = transformFunctionF1;
    this.transformFunctionF2 = transformFunctionF2;
    this.f1Min = f1Min;
    this.f1Max = f1Max;
    this.f2Min = f2Min;
    this.f2Max = f2Max;

    this.trail = [];
    this.maxTrail = 300;
    this.decayRate = 0.998;
  }

  draw(
    F_filtered: number[],
    avgAmpl: number,
    elapsed: number,
    isMale: boolean,
    doDraw: boolean = true,
  ): void {
    const ctx = this.vowelCanvasCtx;
    const w = this.vowelCanvas.origWidth;
    const h = this.vowelCanvas.origHeight;
    const t1 = this.transformFunctionF1;
    const t2 = this.transformFunctionF2;

    const f1YCoord = (i: number): number =>
      ((t1(i) - t1(this.f1Min)) / (t1(this.f1Max) - t1(this.f1Min))) * h;
    const f2XCoord = (i: number): number =>
      ((-t2(i) + t2(this.f2Max)) / (t2(this.f2Max) - t2(this.f2Min))) * w;

    // --- Add new point to trail ---
    if (F_filtered.length >= 2) {
      const x =
        ((-t2(F_filtered[1]) + t2(this.f2Max)) /
          (t2(this.f2Max) - t2(this.f2Min))) *
        w;
      const y =
        ((t1(F_filtered[0]) - t1(this.f1Min)) /
          (t1(this.f1Max) - t1(this.f1Min))) *
        h;
      const r = Math.sqrt(Math.max(1, 20 * (3 + Math.log10(avgAmpl))));
      const hue = elapsed * 0.2;

      this.trail.push({ x, y, r, hue });
    } else if (F_filtered.length === 0) {
      this.trail.push(null);
    }
    if (this.trail.length > this.maxTrail) {
      this.trail.shift();
    }

    if (doDraw) {
      // --- Draw grid ---
      ctx.fillStyle = "rgb(240,240,240)";
      ctx.fillRect(0, 0, w, h);

      ctx.fillStyle = "rgb(220,220,220)";
      ctx.beginPath();
      ctx.moveTo(f2XCoord(this.f1Max), f1YCoord(this.f1Max));
      for (let f = this.f1Max; f >= this.f2Min; f -= 100) {
        ctx.lineTo(f2XCoord(f), f1YCoord(f));
      }
      ctx.lineTo(f2XCoord(this.f2Min), f1YCoord(this.f2Min));
      ctx.lineTo(f2XCoord(this.f2Min), f1YCoord(this.f1Max));
      ctx.fill();

      for (let i = this.f1Min; i < this.f1Max; i += 100) {
        const y = f1YCoord(i);
        let th: number;
        if (i % 500 === 0) {
          ctx.fillStyle = "rgb(100,100,100)";
          ctx.font = "bold 11px sans-serif";
          th = 2;
        } else {
          ctx.fillStyle = "rgb(150,150,150)";
          ctx.font = "10px sans-serif";
          th = 1;
        }
        ctx.fillRect(0, y - th / 2, w, th);
        ctx.fillText(
          i === this.f1Min ? "F1 (Hz)" : `${i}`,
          1,
          y + (i === this.f1Min ? 10 : -2),
        );
      }
      for (let i = this.f2Min; i <= this.f2Max; i += 100) {
        const x = f2XCoord(i);
        let th: number;
        if (i % 500 === 0) {
          ctx.fillStyle = "rgb(100,100,100)";
          ctx.font = "bold 11px sans-serif";
          th = 2;
        } else {
          ctx.fillStyle = "rgb(150,150,150)";
          ctx.font = "10px sans-serif";
          th = 1;
        }
        ctx.fillRect(x - th / 2, 0, th, h);
        if (i <= 1500 || i % 500 === 0) {
          ctx.fillText(i === this.f2Min + 100 ? "F2" : `${i}`, x + 1, h - 3);
        }
      }

      // --- Draw trail oldest to newest, no transparency ---
      const off = this.offCtx;
      off.clearRect(0, 0, w, h);
      off.globalAlpha = 1.0;

      for (let i = 0; i < this.trail.length; i++) {
        const age = this.trail.length - 1 - i;
        const fade = Math.pow(this.decayRate, age);
        if (fade < 0.01) continue;

        const pt = this.trail[i];
        if (pt === null) {
          continue;
        }

        // Fade via lightness: 50% (vivid) → 92% (nearly background white)
        const lightness = 92 - fade * 42;
        const saturation = fade * 80;
        off.fillStyle = `hsl(${pt.hue}deg ${saturation}% ${lightness}%)`;

        // Draw dot
        off.beginPath();
        off.ellipse(pt.x, pt.y, pt.r, pt.r, 0, 0, 2 * Math.PI);
        off.fill();

        // Draw connector from previous point to current point
        if (i > 0) {
          const prev = this.trail[i - 1];
          if (prev !== null) {
            const dx = pt.x - prev.x;
            const dy = pt.y - prev.y;
            const rd = pt.r - prev.r;
            const d_sq = dx * dx + dy * dy;
            const disc = rd * rd * dx * dx - d_sq * (rd * rd - dy * dy);
            if (disc > 0 && Math.abs(dy) > 0.001) {
              const sq = Math.sqrt(disc);
              const a1x = (rd * dx + sq) / d_sq;
              const a1y = (rd - dx * a1x) / dy;
              const a2x = (rd * dx - sq) / d_sq;
              const a2y = (rd - dx * a2x) / dy;
              off.beginPath();
              off.moveTo(pt.x - pt.r * a1x, pt.y - pt.r * a1y);
              off.lineTo(prev.x - prev.r * a1x, prev.y - prev.r * a1y);
              off.lineTo(prev.x - prev.r * a2x, prev.y - prev.r * a2y);
              off.lineTo(pt.x - pt.r * a2x, pt.y - pt.r * a2y);
              off.fill();

              // Draw arrow
              off.strokeStyle = `rgba(255,255,255,${fade * 0.9})`;
              off.lineWidth = 1.2;
              off.beginPath();
              const len = Math.sqrt(d_sq);
              const px = -dy / len;
              const py = dx / len;
              const aw = prev.r * 0.5;
              const a = -3 / Math.sqrt(d_sq);
              off.moveTo(pt.x + dx * a + px * aw, pt.y + dy * a + py * aw);
              off.lineTo(pt.x, pt.y);
              off.lineTo(pt.x + dx * a - px * aw, pt.y + dy * a - py * aw);
              off.stroke();
            }
          }
        }
      }

      off.globalAlpha = 1.0;
      ctx.drawImage(
        this.offCanvas,
        0,
        0,
        this.offCanvas.width,
        this.offCanvas.height,
        0,
        0,
        w,
        h,
      );

      ctx.save();
      // Draw vowel points
      ctx.font = "italic 15px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "white";

      for (const ref of VOWELS) {
        let F1 = ref.F1;
        let F2 = ref.F2;
        if (!isMale) {
          F1 *= 1.12;
          F2 *= 1.12;
        }
        const x = f2XCoord(F2);
        const y = f1YCoord(F1);

        ctx.fillStyle = "rgb(255,0,0)";
        ctx.beginPath();
        ctx.arc(x, y, 2, 0, 2 * Math.PI);
        ctx.fill();

        ctx.strokeText(ref.vowel, x + 10, y - 10);

        ctx.fillStyle = "darkblue";
        ctx.fillText(ref.vowel, x + 10, y - 10);
      }
      ctx.restore();
    }
  }
}
