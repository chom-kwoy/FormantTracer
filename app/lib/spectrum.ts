import { pffft_simd } from "@/app/lib/third_party/pffft.simd.mjs";
import { DeblurredCanvas } from "@/app/lib/types";

type FFTModule = Awaited<ReturnType<typeof pffft_simd>>;

export class Spectrum {
  private readonly canvas: DeblurredCanvas;
  private readonly canvasCtx: CanvasRenderingContext2D;
  private readonly fftModule: FFTModule;
  private readonly freqBinSize: number;

  private readonly pffft_runner: ReturnType<FFTModule["_pffft_runner_new"]>;
  private readonly dataPtr: ReturnType<FFTModule["_malloc"]>;
  private readonly dataHeap: Uint8Array;

  constructor(
    specCanvas: DeblurredCanvas,
    fftModule: FFTModule,
    freqBinSize: number,
  ) {
    this.canvas = specCanvas;
    this.canvasCtx = specCanvas.getContext("2d")!;

    const dpr = window.devicePixelRatio;
    this.canvasCtx.scale(dpr, dpr);

    this.fftModule = fftModule;
    this.freqBinSize = freqBinSize;

    this.pffft_runner = fftModule._pffft_runner_new(this.freqBinSize, 8);
    this.dataPtr = fftModule._malloc(this.freqBinSize * 8);
    this.dataHeap = new Uint8Array(
      fftModule.HEAPU8.buffer,
      this.dataPtr,
      this.freqBinSize * 8,
    );
  }

  draw(
    freqData: Float32Array,
    maxF0: number,
    F_filtered: number[],
    logNoiseFloor: number,
    sampleRate: number,
  ) {
    const w = this.canvas.origWidth;
    const h = this.canvas.origHeight;

    // Clear spectrum canvas
    this.canvasCtx.fillStyle = "rgb(0, 0, 0)";
    this.canvasCtx.fillRect(0, 0, w, h);

    // Compute log spectrum
    const logSpectrum = new Float32Array(this.freqBinSize * 2);
    for (let i = 0; i < this.freqBinSize; ++i) {
      const value = Math.max(logNoiseFloor, freqData[i]);
      logSpectrum[i * 2] = -(value - logNoiseFloor) / logNoiseFloor;
      logSpectrum[i * 2 + 1] = 0;
    }

    // Draw log spectrum
    {
      const barWidth = w / this.freqBinSize;
      let x = 0;

      for (let i = 0; i < this.freqBinSize; i++) {
        const barHeight = logSpectrum[i * 2] * h;

        this.canvasCtx.fillStyle = "rgb(255,50,50)";
        this.canvasCtx.fillRect(x, h - barHeight / 3, barWidth, barHeight / 3);

        x += barWidth;
      }

      for (let i = 0; i < sampleRate / 2; i += 500) {
        this.canvasCtx.fillStyle = "rgb(255,50,255)";
        this.canvasCtx.fillRect(
          (i / (sampleRate / 2)) * w,
          h - h / 3,
          barWidth,
          h / 3,
        );
      }
    }

    // Compute cepstrum
    this.dataHeap.set(new Uint8Array(logSpectrum.buffer));

    this.fftModule._pffft_runner_transform(
      this.pffft_runner,
      this.dataHeap.byteOffset,
    );
    let fft_result = new Float32Array(
      this.dataHeap.buffer,
      this.dataHeap.byteOffset,
      this.freqBinSize * 2,
    );

    for (
      let i = Math.round(sampleRate / maxF0);
      i < this.freqBinSize / 2;
      ++i
    ) {
      fft_result[i * 2] = fft_result[i * 2 + 1] = 0;
      fft_result[this.freqBinSize * 2 - i * 2 - 1] = fft_result[
        this.freqBinSize * 2 - i * 2 - 2
      ] = 0;
    }

    let magnitudes = new Array(this.freqBinSize);
    for (let i = 0; i < this.freqBinSize * 2; i += 2) {
      magnitudes[Math.floor(i / 2)] =
        fft_result[i] * fft_result[i] + fft_result[i + 1] * fft_result[i + 1];
    }

    // Draw cepstrum
    {
      const barWidth = w / magnitudes.length;
      let x = 0;

      for (let i = 0; i < magnitudes.length; i++) {
        const barHeight = Math.min(magnitudes[i] * 0.05 * h, h);

        this.canvasCtx.fillStyle = "rgb(50,50,255)";
        this.canvasCtx.fillRect(
          x,
          (h * 2) / 3 - barHeight / 3,
          barWidth,
          barHeight / 3,
        );

        x += barWidth;
      }

      this.canvasCtx.fillStyle = "rgb(255,50,255)";
      this.canvasCtx.fillRect(
        (barWidth * sampleRate) / maxF0,
        h / 3,
        barWidth,
        h / 3,
      );
    }

    // Inverse fft
    fft_result = Float32Array.from(fft_result);
    this.dataHeap.set(new Uint8Array(fft_result.buffer));

    this.fftModule._pffft_runner_inv_transform(
      this.pffft_runner,
      this.dataHeap.byteOffset,
    );
    const ifft_result = new Float32Array(
      this.dataHeap.buffer,
      this.dataHeap.byteOffset,
      this.freqBinSize * 2,
    );

    magnitudes = new Array(this.freqBinSize);
    for (let i = 0; i < this.freqBinSize * 2; i += 2) {
      const a = ifft_result[i] / this.freqBinSize;
      const b = ifft_result[i + 1] / this.freqBinSize;
      magnitudes[Math.floor(i / 2)] = 2 * (a * a + b * b);
    }

    // Draw filtered spectrum
    {
      const barWidth = w / magnitudes.length;
      let x = 0;

      for (let i = 0; i < magnitudes.length; i++) {
        const barHeight = magnitudes[i] * 2 * h;

        this.canvasCtx.fillStyle = "rgb(200,200,50)";
        this.canvasCtx.fillRect(
          x,
          h / 3 - barHeight / 3,
          barWidth,
          barHeight / 3,
        );

        x += barWidth;
      }

      for (let i = 0; i <= 2500; i += 500) {
        this.canvasCtx.fillStyle = "rgba(255,255,255,0.8)";
        this.canvasCtx.fillRect(
          (i / (sampleRate / 2)) * w,
          h / 3 - h / 3,
          barWidth,
          h / 3,
        );
      }

      for (let i = 0; i <= F_filtered.length; ++i) {
        this.canvasCtx.fillStyle = [
          "rgb(255,50,50)",
          "rgb(50,255,50)",
          "rgb(50,100,255)",
        ][i];
        this.canvasCtx.fillRect(
          (F_filtered[i] / (sampleRate / 2)) * w,
          h / 3 - h / 3,
          5,
          h / 3,
        );
      }
    }
  }
}
