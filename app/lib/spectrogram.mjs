import { freqBinSize, sampleRate } from "../constants.js";

export class Spectrogram {
  constructor(canvas) {
    this.canvas = canvas;
    this.canvasCtx = canvas.getContext("2d");
    this.width = canvas.width;
    this.height = canvas.height;
    this.imageData = this.canvasCtx.createImageData(this.width, this.height);
    this.pixels = this.imageData.data; // Uint8ClampedArray RGBA

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
    confidencesHistory,
    drawFilteredFormants,
  ) {
    const beginIndex = Math.max(0, freqDataHistory.length - this.windowSize);
    const endIndex = freqDataHistory.length;
    const nFrames = endIndex - beginIndex;

    // --- Spectrogram via ImageData ---
    const pixels = this.pixels;
    pixels.fill(255); // white background

    // Find global max for dynamic range clamping
    let globalMax = -Infinity;
    for (let i = beginIndex; i < endIndex; i++) {
      const spec = freqDataHistory[i];
      for (let row = 0; row < this.height; row++) {
        const bin = this.rowToBin[row];
        const binLow = bin | 0;
        const binHigh = Math.min(binLow + 1, freqBinSize - 1);
        const frac = bin - binLow;
        const power = spec[binLow] * (1 - frac) + spec[binHigh] * frac;
        const dB = 10 * Math.log10(power + 1e-20) + this.preemphasis[row];
        if (dB > globalMax) globalMax = dB;
      }
    }

    const floor = globalMax - this.dynamicRange;

    // Render each column
    for (let i = beginIndex; i < endIndex; i++) {
      const spec = freqDataHistory[i];
      const col = i - beginIndex;
      const x0 = this.slotX[col] | 0;
      const x1 =
        col + 1 < this.windowSize ? this.slotX[col + 1] | 0 : this.width;

      for (let row = 0; row < this.height; row++) {
        const bin = this.rowToBin[row];
        const binLow = bin | 0;
        const binHigh = Math.min(binLow + 1, freqBinSize - 1);
        const frac = bin - binLow;
        const power = spec[binLow] * (1 - frac) + spec[binHigh] * frac;
        const dB = 10 * Math.log10(power + 1e-20) + this.preemphasis[row];

        // Normalize: 1 = black (at globalMax), 0 = white (at floor)
        const normalized = (dB - floor) / this.dynamicRange;
        const grey = (255 - Math.max(0, Math.min(1, normalized)) * 255) | 0;

        // Fill all pixels in this column span
        const rowOffset = row * this.width * 4;
        for (let x = x0; x < x1; x++) {
          const idx = rowOffset + x * 4;
          pixels[idx] = grey;
          pixels[idx + 1] = grey;
          pixels[idx + 2] = grey;
          pixels[idx + 3] = 255;
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
      const colors =
        curFormantsHistory === origFormantsHistory
          ? [
              "rgba(255,50,50,0.5)",
              "rgba(50,255,50,0.5)",
              "rgba(50,100,255,0.5)",
            ]
          : ["rgb(255,50,50)", "rgb(50,255,50)", "rgb(50,100,255)"];
      const formantBegin = Math.max(
        0,
        curFormantsHistory.length - this.windowSize,
      );
      const ctx = this.canvasCtx;

      for (let f = 0; f < 3; f++) {
        ctx.strokeStyle = colors[f];
        ctx.fillStyle = colors[f];
        ctx.lineWidth = curFormantsHistory === origFormantsHistory ? 2 : 3;

        let prevX = null,
          prevY = null;

        for (let i = formantBegin; i < curFormantsHistory.length; i++) {
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
  }
}
