import {
  bandwidthThreshold,
  elemsPerWindow,
  fftSize,
  formantCeiling,
  formantElemsPerWindow,
  formantFloor,
  freqBinSize,
  interval,
  lpcNumPoles,
  nWindows,
  sampleRate,
  windowSize,
} from "../constants.js";
import { detectF0, fft_mag, formantAnalysis } from "../lib/formant.mjs";
import eig from "../lib/third_party/eigen.js";
import { pffft_simd } from "../lib/third_party/pffft.simd.mjs";

class FormantProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new RingBuffer(windowSize);
    this.formatsBuffer = new RingBuffer(nWindows * elemsPerWindow);
    this.popCount = 0;
    this.bufferFull = false;
    this.intervalIndex = 0;

    this.gaussianWindow = new Float32Array(windowSize);
    const sigma = 0.4;
    for (let i = 0; i < windowSize; ++i) {
      const n = i - windowSize / 2;
      this.gaussianWindow[i] = Math.exp(
        -0.5 * (n / ((sigma * windowSize) / 2)) ** 2,
      );
    }

    this.tripleBufferInitialized = false;
    this.port.onmessage = (e) => {
      this.tripleBuffers = [
        new Float32Array(e.data.tripleBuffers[0]),
        new Float32Array(e.data.tripleBuffers[1]),
        new Float32Array(e.data.tripleBuffers[2]),
      ];
      this.presentIdx = new Uint32Array(e.data.presentIdx);
      this.readyIdx = new Uint32Array(e.data.readyIdx);
      this.inprogressIdx = new Uint32Array(e.data.inprogressIdx);
      this.stale = new Uint8Array(e.data.stale);
      this.tripleBufferInitialized = true;

      console.log("AudioWorklet: triple buffer initialized");
    };

    this.librariesInitialized = false;
    Promise.all([pffft_simd(), eig.ready]).then(([fftModule, _]) => {
      this.fftModule = fftModule;
      this.librariesInitialized = true;

      this.dataPtr = fftModule._malloc(freqBinSize * 8);
      this.dataHeap = new Uint8Array(
        fftModule.HEAPU8.buffer,
        this.dataPtr,
        freqBinSize * 8,
      );

      console.log("AudioWorklet: libraries initialized");
    });

    this.timeData = new Float32Array(windowSize);
  }

  process(inputs, outputs, parameters) {
    if (inputs[0].length === 0) {
      return true;
    }

    const input = inputs[0][0];
    const output = outputs[0][0];
    for (let i = 0; i < input.length; ++i) {
      output[i] = input[i];
    }
    for (let i = 0; i < input.length; ++i) {
      if (this.buffer.num_items() === windowSize) {
        this.bufferFull = true;
        this.buffer.pop();
        this.popCount++;
      }
      this.buffer.put(input[i]);
      if (
        this.tripleBufferInitialized &&
        this.librariesInitialized &&
        this.bufferFull &&
        this.popCount % interval === 0
      ) {
        this.processBuffer();
      }
    }

    return true;
  }

  processBuffer() {
    // Copy values from ring buffer into timeData
    for (let i = 0; i < windowSize; ++i) {
      // apply gaussian window
      this.timeData[i] = this.buffer.get(i) * this.gaussianWindow[i];
    }

    // Check voicing first
    const [voicing, f0] = detectF0(this.timeData, sampleRate);

    // Run formant analysis
    let [spectrum, N, M] = fft_mag(
      Array.from(this.timeData), // expects a regular array
      this.fftModule,
      fftSize,
    );
    let [F, formantError] = formantAnalysis(
      spectrum,
      freqBinSize * 2,
      freqBinSize * 2,
      lpcNumPoles,
      sampleRate,
      bandwidthThreshold,
      eig,
      this.fftModule,
    );

    // Filter out extreme values and only take F1, F2, and F3
    let F_filtered = [];
    let nFormants = 0;
    for (let i = 0; i < F.length && nFormants < 3; ++i) {
      if (F[i] < formantFloor || F[i] > formantCeiling) {
        continue;
      }
      F_filtered.push(F[i]);
      nFormants += 1;
    }

    // Compute RMS amplitude
    let avgAmpl = 0;
    for (let i = 0; i < this.timeData.length; ++i) {
      avgAmpl += (this.timeData[i] * this.timeData[i]) / this.timeData.length;
    }
    avgAmpl = Math.sqrt(avgAmpl);

    // Push values into buffer
    if (this.formatsBuffer.num_items() === nWindows * elemsPerWindow) {
      // pop elemsPerWindow elements
      for (let i = 0; i < elemsPerWindow; ++i) {
        this.formatsBuffer.pop();
      }
    }
    // push [avgAmpl, formantError, voicing, f0,
    //       nFormants, F_filtered[0], F_filtered[1], F_filtered[2]]
    this.formatsBuffer.put(this.intervalIndex);
    this.formatsBuffer.put(avgAmpl);
    this.formatsBuffer.put(formantError);
    this.formatsBuffer.put(voicing);
    this.formatsBuffer.put(f0);
    this.formatsBuffer.put(nFormants);
    for (let i = 0; i < nFormants; ++i) {
      this.formatsBuffer.put(F_filtered[i]);
    }
    for (let i = 0; i < formantElemsPerWindow - (nFormants + 6); ++i) {
      this.formatsBuffer.put(0);
    }
    // Push spectrum into buffer
    for (let i = 0; i < freqBinSize; ++i) {
      this.formatsBuffer.put(spectrum[i]);
    }

    // copy values into in-progress buffer
    this.produce((out) => {
      out[0] = this.formatsBuffer.num_items();
      for (let i = 0; i < this.formatsBuffer.num_items(); ++i) {
        out[i + 1] = this.formatsBuffer.get(i);
      }
    });

    // delete allocated memory
    // eig.GC.flush();

    this.intervalIndex++;
  }

  produce(callback) {
    let inprogressIdx = Atomics.load(this.inprogressIdx, 0);
    let out = this.tripleBuffers[inprogressIdx];

    callback(out);

    let origReadyIdx = Atomics.exchange(this.readyIdx, 0, inprogressIdx); // point ready idx to newly loaded buffer
    Atomics.store(this.inprogressIdx, 0, origReadyIdx); // point in-progress index to old ready buffer
    Atomics.store(this.stale, 0, 0); // clear stale flag
  }
}

class RingBuffer {
  constructor(maxLength) {
    this.writeIdx = 0;
    this.readIdx = 0;
    this.buffer = new Float32Array(maxLength + 1);
  }

  put(item) {
    if ((this.writeIdx + 1) % this.buffer.length === this.readIdx) {
      // buffer is full, avoid overflow
      throw new Error("Buffer full");
    }
    this.buffer[this.writeIdx] = item;
    this.writeIdx = (this.writeIdx + 1) % this.buffer.length;
  }

  pop() {
    if (this.readIdx === this.writeIdx) {
      // buffer is empty
      throw new Error("Buffer empty");
    }
    let value = this.buffer[this.readIdx];
    this.readIdx = (this.readIdx + 1) % this.buffer.length;
    return value;
  }

  get(index) {
    let end = this.writeIdx;
    if (this.writeIdx < this.readIdx) {
      end = this.writeIdx + this.buffer.length;
    }
    if (index >= 0 && this.readIdx + index < end) {
      let i = (this.readIdx + index) % this.buffer.length;
      return this.buffer[i];
    } else {
      // index out of bounds
      throw new Error("Index out of bounds");
    }
  }

  num_items() {
    let end = this.writeIdx;
    if (this.writeIdx < this.readIdx) {
      end = this.writeIdx + this.buffer.length;
    }
    return end - this.readIdx;
  }
}

registerProcessor("FormantProcessor", FormantProcessor);
