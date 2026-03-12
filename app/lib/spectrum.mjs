export class Spectrum {
  constructor(specCanvas, fftModule, freqBinSize) {
    this.canvas = specCanvas;
    this.canvasCtx = specCanvas.getContext("2d");

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

  draw(freqData, maxF0, F_filtered, logNoiseFloor, sampleRate) {
    // Clear spectrum canvas
    this.canvasCtx.fillStyle = "rgb(0, 0, 0)";
    this.canvasCtx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // Compute log spectrum
    let logSpectrum = new Float32Array(this.freqBinSize * 2);
    for (let i = 0; i < this.freqBinSize; ++i) {
      let value = Math.max(logNoiseFloor, freqData[i]);
      logSpectrum[i * 2] = -(value - logNoiseFloor) / logNoiseFloor;
      logSpectrum[i * 2 + 1] = 0;
    }

    // Draw log spectrum
    {
      const barWidth = this.canvas.width / this.freqBinSize;
      let x = 0;

      for (let i = 0; i < this.freqBinSize; i++) {
        const barHeight = logSpectrum[i * 2] * this.canvas.height;

        this.canvasCtx.fillStyle = "rgb(255,50,50)";
        this.canvasCtx.fillRect(
          x,
          this.canvas.height - barHeight / 3,
          barWidth,
          barHeight / 3,
        );

        x += barWidth;
      }

      for (let i = 0; i < sampleRate / 2; i += 500) {
        this.canvasCtx.fillStyle = "rgb(255,50,255)";
        this.canvasCtx.fillRect(
          (i / (sampleRate / 2)) * this.canvas.width,
          this.canvas.height - this.canvas.height / 3,
          barWidth,
          this.canvas.height / 3,
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
      const barWidth = this.canvas.width / magnitudes.length;
      let x = 0;

      for (let i = 0; i < magnitudes.length; i++) {
        const barHeight = Math.min(magnitudes[i] * 50, this.canvas.height);

        this.canvasCtx.fillStyle = "rgb(50,50,255)";
        this.canvasCtx.fillRect(
          x,
          (this.canvas.height * 2) / 3 - barHeight / 3,
          barWidth,
          barHeight / 3,
        );

        x += barWidth;
      }

      this.canvasCtx.fillStyle = "rgb(255,50,255)";
      this.canvasCtx.fillRect(
        (barWidth * sampleRate) / maxF0,
        this.canvas.height / 3,
        barWidth,
        this.canvas.height / 3,
      );
    }

    // Inverse fft
    fft_result = Float32Array.from(fft_result);
    this.dataHeap.set(new Uint8Array(fft_result.buffer));

    this.fftModule._pffft_runner_inv_transform(
      this.pffft_runner,
      this.dataHeap.byteOffset,
    );
    let ifft_result = new Float32Array(
      this.dataHeap.buffer,
      this.dataHeap.byteOffset,
      this.freqBinSize * 2,
    );

    magnitudes = new Array(this.freqBinSize);
    for (let i = 0; i < this.freqBinSize * 2; i += 2) {
      let a = ifft_result[i] / this.freqBinSize;
      let b = ifft_result[i + 1] / this.freqBinSize;
      magnitudes[Math.floor(i / 2)] = 2 * (a * a + b * b);
    }

    // Draw filtered spectrum
    {
      const barWidth = this.canvas.width / magnitudes.length;
      let x = 0;

      for (let i = 0; i < magnitudes.length; i++) {
        const barHeight = magnitudes[i] * 2 * this.canvas.height;

        this.canvasCtx.fillStyle = "rgb(200,200,50)";
        this.canvasCtx.fillRect(
          x,
          this.canvas.height / 3 - barHeight / 3,
          barWidth,
          barHeight / 3,
        );

        x += barWidth;
      }

      for (let i = 0; i <= 2500; i += 500) {
        this.canvasCtx.fillStyle = "rgba(255,255,255,0.8)";
        this.canvasCtx.fillRect(
          (i / (sampleRate / 2)) * this.canvas.width,
          this.canvas.height / 3 - this.canvas.height / 3,
          barWidth,
          this.canvas.height / 3,
        );
      }

      for (let i = 0; i <= F_filtered.length; ++i) {
        this.canvasCtx.fillStyle = [
          "rgb(255,50,50)",
          "rgb(50,255,50)",
          "rgb(50,100,255)",
        ][i];
        this.canvasCtx.fillRect(
          (F_filtered[i] / (sampleRate / 2)) * this.canvas.width,
          this.canvas.height / 3 - this.canvas.height / 3,
          5,
          this.canvas.height / 3,
        );
      }
    }
  }
}
