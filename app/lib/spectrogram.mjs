import { freqBinSize, sampleRate } from "../constants.js";

export class Spectrogram {
  constructor(canvas) {
    this.canvas = canvas;
    this.canvasCtx = canvas.getContext("2d");
    this.width = canvas.width;
    this.height = canvas.height;
    this.imageData = this.canvasCtx.createImageData(this.width, this.height);
    this.dbBuffer = null;
    this.greyLUT = null;

    this.windowSize = 300;
    this.minFreq = 200;
    this.maxFreq = 5000;
    this.dynamicRange = 70; // dB
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
  }

  draw(
    freqDataHistory,
    origFormantsHistory,
    formantsHistory,
    validityHistory,
    otherHistories,
    drawFilteredFormants,
  ) {
    const beginIndex = Math.max(0, freqDataHistory.length - this.windowSize);
    const endIndex = freqDataHistory.length;
    const nFrames = endIndex - beginIndex;

    // --- Single pass: compute all dB values and find global max ---
    // Lazily allocate reusable buffer
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

    const floor = globalMax - this.dynamicRange;
    const scale = 255 / this.dynamicRange;

    // --- Build grey LUT (256 entries mapping quantized dB to packed RGBA) ---
    if (!this.greyLUT) {
      this.greyLUT = new Uint32Array(256);
    }
    for (let i = 0; i < 256; i++) {
      const g = 255 - i;
      // Little-endian ABGR
      this.greyLUT[i] = (255 << 24) | (g << 16) | (g << 8) | g;
    }

    // --- Render via Uint32Array (one write per pixel) ---
    const pixels32 = new Uint32Array(this.imageData.data.buffer);
    // Fill white
    const white = (255 << 24) | (255 << 16) | (255 << 8) | 255;
    pixels32.fill(white);

    idx = 0;
    for (let col = 0; col < nFrames; col++) {
      const x0 = this.slotX[col] | 0;
      const x1 =
        col + 1 < this.windowSize ? this.slotX[col + 1] | 0 : this.width;
      const colWidth = x1 - x0;

      for (let row = 0; row < this.height; row++) {
        const dB = dbBuf[idx++];
        const gi = ((dB - floor) * scale) | 0;
        const grey = this.greyLUT[gi > 255 ? 255 : gi < 0 ? 0 : gi];
        const rowOffset = row * this.width + x0;

        for (let x = 0; x < colWidth; x++) {
          pixels32[rowOffset + x] = grey;
        }
      }
    }

    this.canvasCtx.putImageData(this.imageData, 0, 0);

    // --- Formant lines + dots ---
    const formantsToDraw = [origFormantsHistory];
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
        ctx.lineWidth = curFormantsHistory === origFormantsHistory ? 2 : 3;

        let prevX = null,
          prevY = null;

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

          if (prevX !== null) {
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

    function draw(history, width, height, windowSize) {
      const beginIndex = Math.max(0, history.length - windowSize);
      const endIndex = history.length;
      const max = Math.max(1.0, ...history);
      const min = Math.min(0.0, ...history);
      const range = max - min;

      let prevX = null,
        prevY = null;
      for (let i = beginIndex; i < endIndex; i++) {
        const val = history[i];
        const x = ((i - beginIndex) * width) / windowSize;
        const y = height - ((val - min) / range) * height;

        if (prevX !== null) {
          ctx.beginPath();
          ctx.moveTo(prevX, prevY);
          ctx.lineTo(x, y);
          ctx.stroke();
        }

        prevX = x;
        prevY = y;
      }
    }

    for (let i = 0; i < otherHistories.length; i++) {
      ctx.strokeStyle = "white";
      ctx.fillStyle = "white";
      ctx.lineWidth = 6;
      ctx.lineCap = "round";
      draw(otherHistories[i], this.width, this.height, this.windowSize);

      ctx.strokeStyle = colors[i];
      ctx.fillStyle = colors[i];
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      draw(otherHistories[i], this.width, this.height, this.windowSize);
    }
  }
}
