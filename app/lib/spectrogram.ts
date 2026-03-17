import { DeblurredCanvas } from "@/app/lib/types";

import { freqBinSize, sampleRate, stftInterval } from "../constants.js";

export type SpectrogramHoverCallback = (
  time: number | null,
  freq: number | null,
) => void;

export class Spectrogram {
  private readonly canvas: DeblurredCanvas;
  private readonly canvasCtx: CanvasRenderingContext2D;
  private readonly width: number;
  private readonly height: number;
  private readonly imageData: ImageData;
  private dbBuffer: Float32Array | null;
  private greyLUT: Uint32Array | null;

  private windowSize: number;
  private minFreq: number;
  private maxFreq: number;
  private dynamicRange: number;
  private nyquist: number;

  private rowToBin: Float32Array;
  private slotX: Float32Array;
  private preemphasis: Float32Array;

  private hoverCallback: SpectrogramHoverCallback | null;

  // Cached state written by update(), consumed by draw()
  private renderNFrames: number;
  private renderFloor: number;
  private renderScale: number;
  private renderOrigFormantsHistory: number[][];
  private renderFormantsHistory: number[][];
  private renderValidityHistory: number[];
  private renderOtherHistories: number[][];
  private renderDrawFilteredFormants: boolean;

  private hoveredPoint: { time: number; freq: number } | null = null;

  private boundOnMouseMove: (e: MouseEvent) => void;
  private boundOnMouseLeave: () => void;

  constructor(canvas: DeblurredCanvas) {
    this.canvas = canvas;
    this.canvasCtx = canvas.getContext("2d")!;
    this.width = canvas.width;
    this.height = canvas.height;
    this.imageData = this.canvasCtx.createImageData(this.width, this.height);
    this.dbBuffer = null;
    this.greyLUT = null;

    this.windowSize = 300;
    this.minFreq = 50;
    this.maxFreq = 5000;
    this.dynamicRange = 70;
    this.nyquist = sampleRate / 2;

    // Precompute: for each pixel row, which freq bin(s) to sample
    // Row 0 = top = maxFreq, row height-1 = bottom = minFreq
    this.rowToBin = new Float32Array(this.height);
    for (let row = 0; row < this.height; row++) {
      const freq =
        this.maxFreq - (row / this.height) * (this.maxFreq - this.minFreq);
      this.rowToBin[row] = (freq / this.nyquist) * freqBinSize;
    }

    // Precompute x positions for each time slot
    this.slotX = new Float32Array(this.windowSize);
    for (let i = 0; i < this.windowSize; i++) {
      this.slotX[i] = (i * this.width) / this.windowSize;
    }

    // Pre-emphasis: +6 dB/oct relative to 1000 Hz per row
    this.preemphasis = new Float32Array(this.height);
    for (let row = 0; row < this.height; row++) {
      const freq =
        this.maxFreq - (row / this.height) * (this.maxFreq - this.minFreq);
      this.preemphasis[row] = 6 * Math.log2(Math.max(freq, 1) / 1000);
    }

    this.hoverCallback = null;

    this.renderNFrames = 0;
    this.renderFloor = 0;
    this.renderScale = 0;
    this.renderOrigFormantsHistory = [];
    this.renderFormantsHistory = [];
    this.renderValidityHistory = [];
    this.renderOtherHistories = [];
    this.renderDrawFilteredFormants = false;

    this.boundOnMouseMove = this.onMouseMove.bind(this);
    this.boundOnMouseLeave = this.onMouseLeave.bind(this);
    this.canvas.addEventListener("mousemove", this.boundOnMouseMove);
    this.canvas.addEventListener("mouseleave", this.boundOnMouseLeave);
  }

  onHover(callback: SpectrogramHoverCallback | null): void {
    this.hoverCallback = callback;
  }

  destroy(): void {
    this.canvas.removeEventListener("mousemove", this.boundOnMouseMove);
    this.canvas.removeEventListener("mouseleave", this.boundOnMouseLeave);
  }

  private onMouseMove(e: MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect();

    // Convert client coords → CSS pixels relative to canvas, then to canvas pixels
    const cssX = e.clientX - rect.left;
    const cssY = e.clientY - rect.top;
    const px = cssX * (this.width / rect.width);
    const py = cssY * (this.height / rect.height);

    // Frequency: linear interpolation between minFreq (bottom) and maxFreq (top)
    let freq =
      this.maxFreq - (py / this.height) * (this.maxFreq - this.minFreq);
    freq = Math.max(this.minFreq, Math.min(this.maxFreq, freq));

    // Time: px/width maps to [0, windowSize) slots; slot 0 = oldest visible frame
    const slotFrac = (px / this.width) * this.windowSize;
    // Slot index relative to the oldest visible frame → offset from newest (negative seconds)
    const secondsPerFrame = stftInterval / sampleRate;
    const time = (slotFrac - this.renderNFrames) * secondsPerFrame;

    this.hoveredPoint = { time, freq };
    this.draw();

    if (!this.hoverCallback) return;

    this.hoverCallback(time, freq);
  }

  private onMouseLeave(): void {
    this.hoveredPoint = null;
    this.draw();
    this.hoverCallback?.(null, null);
  }

  update(
    freqDataHistory: Float32Array[],
    origFormantsHistory: number[][],
    formantsHistory: number[][],
    validityHistory: number[],
    otherHistories: number[][],
    drawFilteredFormants: boolean,
  ): void {
    const beginIndex = Math.max(0, freqDataHistory.length - this.windowSize);
    const endIndex = freqDataHistory.length;
    const nFrames = endIndex - beginIndex;

    // --- Single pass: compute all dB values and find global max ---
    if (!this.dbBuffer || this.dbBuffer.length < nFrames * this.height) {
      this.dbBuffer = new Float32Array(nFrames * this.height);
    }
    const dbBuf = this.dbBuffer;

    let globalMax = -Infinity;
    let idx = 0;
    for (let i = beginIndex; i < endIndex; i++) {
      const spec = freqDataHistory[i];
      for (let row = 0; row < this.height; row++) {
        const bin = this.rowToBin[row];
        const binLow = bin | 0;
        const frac = bin - binLow;
        const power = spec[binLow] + (spec[binLow + 1] - spec[binLow]) * frac;
        const dB = 10 * Math.log10(power + 1e-20) + this.preemphasis[row];
        dbBuf[idx++] = dB;
        if (dB > globalMax) globalMax = dB;
      }
    }

    // --- Build grey LUT (256 entries mapping quantized dB to packed RGBA) ---
    if (!this.greyLUT) {
      this.greyLUT = new Uint32Array(256);
    }
    for (let i = 0; i < 256; i++) {
      const g = 255 - i;
      // Little-endian ABGR
      this.greyLUT[i] = (255 << 24) | (g << 16) | (g << 8) | g;
    }

    // Store derived render parameters
    this.renderNFrames = nFrames;
    this.renderFloor = globalMax - this.dynamicRange;
    this.renderScale = 255 / this.dynamicRange;
    this.renderOrigFormantsHistory = origFormantsHistory;
    this.renderFormantsHistory = formantsHistory;
    this.renderValidityHistory = validityHistory;
    this.renderOtherHistories = otherHistories;
    this.renderDrawFilteredFormants = drawFilteredFormants;
  }

  draw(): void {
    const nFrames = this.renderNFrames;
    const floor = this.renderFloor;
    const scale = this.renderScale;
    const origFormantsHistory = this.renderOrigFormantsHistory;
    const formantsHistory = this.renderFormantsHistory;
    const validityHistory = this.renderValidityHistory;
    const otherHistories = this.renderOtherHistories;
    const drawFilteredFormants = this.renderDrawFilteredFormants;

    const dbBuf = this.dbBuffer!;
    const greyLUT = this.greyLUT!;

    // --- Render via Uint32Array (one write per pixel) ---
    const pixels32 = new Uint32Array(this.imageData.data.buffer);
    const white = (255 << 24) | (255 << 16) | (255 << 8) | 255;
    pixels32.fill(white);

    let idx = 0;
    for (let col = 0; col < nFrames; col++) {
      const x0 = this.slotX[col] | 0;
      const x1 =
        col + 1 < this.windowSize ? this.slotX[col + 1] | 0 : this.width;
      const colWidth = x1 - x0;

      for (let row = 0; row < this.height; row++) {
        const dB = dbBuf[idx++];
        const gi = ((dB - floor) * scale) | 0;
        const grey = greyLUT[gi > 255 ? 255 : gi < 0 ? 0 : gi];
        const rowOffset = row * this.width + x0;

        for (let x = 0; x < colWidth; x++) {
          pixels32[rowOffset + x] = grey;
        }
      }
    }

    this.canvasCtx.putImageData(this.imageData, 0, 0);

    const dpr = window.devicePixelRatio;

    // --- Formant lines + dots ---
    const formantsToDraw: number[][][] = [origFormantsHistory];
    if (drawFilteredFormants) {
      formantsToDraw.push(formantsHistory);
    }

    for (const curFormantsHistory of formantsToDraw) {
      const formantBegin = Math.max(
        0,
        curFormantsHistory.length - this.windowSize,
      );
      const ctx = this.canvasCtx;

      for (let f = 0; f < 3; f++) {
        ctx.lineWidth =
          (curFormantsHistory === origFormantsHistory ? 2 : 3) * dpr;

        let prevX: number | null = null;
        let prevY: number | null = null;

        for (let i = formantBegin; i < curFormantsHistory.length; i++) {
          const validity = validityHistory[i];
          const opacity =
            curFormantsHistory === origFormantsHistory
              ? 0.5 * validity + 0.1
              : 1.0;
          const colors = [
            `rgba(255,50,50,${opacity})`,
            `rgba(50,255,50,${opacity})`,
            `rgba(50,100,255,${opacity})`,
          ];
          ctx.strokeStyle = colors[f];

          const formants = curFormantsHistory[i];

          const freq = formants[f];
          const x = ((i - formantBegin) * this.width) / this.windowSize;
          const y =
            this.height -
            ((freq - this.minFreq) / (this.maxFreq - this.minFreq)) *
              this.height;

          if (prevX !== null && prevY !== null) {
            ctx.beginPath();
            ctx.moveTo(prevX, prevY);
            ctx.lineTo(x, y);
            ctx.stroke();
          }

          prevX = x;
          prevY = y;
        }
      }
    }

    const colors = ["rgb(0,0,0)", "rgb(50,155,155)", "rgb(155,50,155)"];
    const ctx = this.canvasCtx;

    const drawLine = (
      history: number[],
      width: number,
      height: number,
      windowSize: number,
    ): void => {
      const beginIdx = Math.max(0, history.length - windowSize);
      const endIdx = history.length;
      const max = Math.max(1.0, ...history);
      const min = Math.min(0.0, ...history);
      const range = max - min;

      let prevX: number | null = null;
      let prevY: number | null = null;
      for (let i = beginIdx; i < endIdx; i++) {
        const val = history[i];
        const x = ((i - beginIdx) * width) / windowSize;
        const y = height - ((val - min) / range) * height;

        if (prevX !== null && prevY !== null) {
          ctx.beginPath();
          ctx.moveTo(prevX, prevY);
          ctx.lineTo(x, y);
          ctx.stroke();
        }

        prevX = x;
        prevY = y;
      }
    };

    for (let i = 0; i < otherHistories.length; i++) {
      ctx.strokeStyle = "white";
      ctx.fillStyle = "white";
      ctx.lineWidth = 6 * dpr;
      ctx.lineCap = "round";
      drawLine(otherHistories[i], this.width, this.height, this.windowSize);

      ctx.strokeStyle = colors[i];
      ctx.fillStyle = colors[i];
      ctx.lineWidth = 2 * dpr;
      ctx.lineCap = "round";
      drawLine(otherHistories[i], this.width, this.height, this.windowSize);
    }

    // draw crosshairs on hovered point
    if (this.hoveredPoint) {
      const { time, freq } = this.hoveredPoint;

      if (time < 0) {
        const secondsPerFrame = stftInterval / sampleRate;

        const slotFrac = time / secondsPerFrame + this.renderNFrames;
        const pointerX = (slotFrac / this.windowSize) * this.width;
        const pointerY =
          this.height -
          ((freq - this.minFreq) / (this.maxFreq - this.minFreq)) * this.height;

        const drawLines = () => {
          // draw horizontal line
          ctx.beginPath();
          ctx.moveTo(0, pointerY);
          ctx.lineTo(this.width, pointerY);
          ctx.stroke();

          // draw vertical line
          ctx.beginPath();
          ctx.moveTo(pointerX, 0);
          ctx.lineTo(pointerX, this.height);
          ctx.stroke();
        };

        ctx.save();
        ctx.globalCompositeOperation = "difference";
        ctx.strokeStyle = "rgba(255,255,0,1.0)";
        ctx.lineWidth = 2.5 * dpr;
        drawLines();
        ctx.restore();

        ctx.strokeStyle = "rgba(0,255,255,1.0)";
        ctx.lineWidth = 1.1 * dpr;
        drawLines();

        // draw background for time label
        const fontSize = 12 * dpr;
        ctx.font = `${fontSize}px sans-serif`;
        ctx.textBaseline = "bottom";
        ctx.textAlign = "left";
        ctx.fillStyle = "rgba(0,0,0,0.7)";

        const padding = 2 * dpr;
        const timeLabel = `${time.toFixed(3)}s`;
        const freqLabel = `${freq.toFixed(0)}Hz`;
        const timeLabelMetrics = ctx.measureText(timeLabel);
        const freqLabelMetrics = ctx.measureText(freqLabel);

        ctx.beginPath();
        ctx.rect(
          pointerX,
          this.height - timeLabelMetrics.fontBoundingBoxAscent,
          timeLabelMetrics.width + padding * 2,
          timeLabelMetrics.fontBoundingBoxAscent,
        );
        ctx.rect(
          0,
          pointerY - freqLabelMetrics.fontBoundingBoxAscent,
          freqLabelMetrics.width + padding * 2,
          freqLabelMetrics.fontBoundingBoxAscent,
        );
        ctx.fill();

        ctx.fillStyle = "rgba(255,255,255,1.0)";
        ctx.fillText(timeLabel, pointerX + padding, this.height);
        ctx.fillText(freqLabel, padding, pointerY);
      }
    }
  }
}
