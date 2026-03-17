import eig from "eigen";

import { FormantTracker } from "@/app/lib/formant_tracker";
import { DeblurredCanvas, deblurCanvas } from "@/app/lib/types";

import {
  elemsPerWindow,
  formantElemsPerWindow,
  logNoiseFloor,
  maxF0,
  nWindows,
  sampleRate,
  stftInterval,
  windowSize,
} from "./constants.js";
import { FormantGrid } from "./lib/formant_grid";
import { Spectrogram } from "./lib/spectrogram";
import { Spectrum } from "./lib/spectrum";
import { pffft_simd } from "./lib/third_party/pffft.simd.mjs";
import TripleBuffer from "./lib/triplebuffer.mjs";

export class FormantApp {
  private audioCtx: AudioContext | null = null;
  private animFrameId: number | null = null;
  private isPlaying = false;
  private drawRefreshFn: ((ts: number) => void) | null = null;
  private isMale: boolean;
  private readonly vowelCanvas: DeblurredCanvas;
  private readonly spectrumCanvas: DeblurredCanvas;
  private readonly spectrogramCanvas: DeblurredCanvas;
  private readonly spectrogram2Canvas: DeblurredCanvas;

  constructor(isMale: boolean) {
    this.isMale = isMale;
    this.vowelCanvas = deblurCanvas(
      document.getElementById("vowelspace") as HTMLCanvasElement,
    );
    this.spectrumCanvas = deblurCanvas(
      document.getElementById("spectrum") as HTMLCanvasElement,
    );
    this.spectrogramCanvas = deblurCanvas(
      document.getElementById("spectrogram") as HTMLCanvasElement,
    );
    this.spectrogram2Canvas = deblurCanvas(
      document.getElementById("spectrogram2") as HTMLCanvasElement,
    );
  }

  setIsMale(isMale: boolean) {
    this.isMale = isMale;
  }

  async toggle(useMic: boolean, filePath: string | null) {
    const btn = document.getElementById("startBtn") as HTMLButtonElement;

    if (!this.isPlaying) {
      if (!this.audioCtx) {
        await this.start(useMic, filePath);
      } else {
        await this.audioCtx.resume();
        if (this.drawRefreshFn)
          this.animFrameId = requestAnimationFrame(this.drawRefreshFn);
      }
      this.isPlaying = true;
      btn.textContent = "Pause";
    } else {
      if (this.audioCtx) await this.audioCtx.suspend();
      if (this.animFrameId !== null) cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
      this.isPlaying = false;
      btn.textContent = "Resume";
    }
  }

  private async start(useMic: boolean, filePath: string | null) {
    const fftModule = await pffft_simd();
    await eig.ready;
    console.log("FFT window length (s): ", windowSize / sampleRate, "s");
    console.log("FFT interval (s): ", stftInterval / sampleRate, "s");

    this.audioCtx = new AudioContext({ sampleRate: sampleRate });

    // Pre-emphasis filter
    const iirfilter = this.audioCtx.createIIRFilter([1.0, -0.9718], [1.0, 0.0]);

    const analyser = this.audioCtx.createAnalyser();
    analyser.fftSize = windowSize;
    analyser.smoothingTimeConstant = 0.9;

    await this.audioCtx.audioWorklet.addModule(
      "processors/formant-processor.js",
    );
    const formantNode = new AudioWorkletNode(this.audioCtx, "FormantProcessor");
    const tripleBuffer = new TripleBuffer(1 + nWindows * elemsPerWindow);
    formantNode.port.postMessage(tripleBuffer.tripleBuffer);

    if (useMic) {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: true,
          echoCancellation: false,
          noiseSuppression: false,
          sampleRate: sampleRate,
        },
      });
      const source = this.audioCtx.createMediaStreamSource(stream);
      source.connect(iirfilter);
      iirfilter.connect(analyser);
    } else {
      if (!filePath) {
        throw new Error("No file path provided");
      }
      const sample = await setupSample(this.audioCtx, filePath);
      const source = playSourceNode(this.audioCtx, sample);
      source.connect(iirfilter);
      iirfilter.connect(formantNode);
      iirfilter.connect(analyser);
      source.connect(this.audioCtx.destination);
    }

    const freqBinSize = analyser.frequencyBinCount;
    const freqData = new Float32Array(freqBinSize);

    const barkScale = (x: number) => {
      return (26.81 * x) / (1960 + x) - 0.53;
    };
    const vowelSpace = new FormantGrid(
      this.vowelCanvas,
      200, // f1Min
      1100, // f1Max
      500, // f2Min
      2700, // f2Max
      barkScale, // f1 scale
      barkScale, // f2 scale
    );
    const spectrum = new Spectrum(this.spectrumCanvas, fftModule, freqBinSize);
    const spectrogram = new Spectrogram(this.spectrogramCanvas);
    const spectrogram2 = new Spectrogram(this.spectrogram2Canvas);
    const tracker = new FormantTracker();

    let curIdx = 0;
    const formantsHistory: number[][] = [];
    const origFormantsHistory: number[][] = [];
    const confidenceHistory: number[][] = [];
    const voicingCoeffsHistory: number[] = [];
    const validityHistory: number[] = [];
    const f0sHistory: number[] = [];
    const freqDataHistory: Float32Array[] = [];

    let f0Sum = 0;
    let f0Count = 0;

    let pointerTime: number | null = null;
    spectrogram2.onHover((time, freq) => {
      // time: seconds relative to now (negative = in the past, e.g. -2.3s)
      // freq: Hz, clamped to [minFreq, maxFreq]
      pointerTime = time;
      vowelSpace.draw(this.isMale, pointerTime);
    });

    const drawRefresh = (timeStamp: number) => {
      this.animFrameId = requestAnimationFrame(drawRefresh);
      const t0 = performance.now();

      analyser.getFloatFrequencyData(freqData);

      const newIndices: number[] = [];
      const newAvgAmpls: number[] = [];
      const newFormants11: number[][] = [];
      const newFormantErrors11: number[] = [];
      const newFormants13: number[][] = [];
      const newFormantErrors13: number[] = [];
      const newVoicingCoeffs: number[] = [];
      const newF0s: number[] = [];

      // retrieve latest data from triple buffer
      tripleBuffer.consume((arr: Float32Array) => {
        const numElems = arr[0];
        for (let i = 0; i < numElems / elemsPerWindow; ++i) {
          const offset = 1 + i * elemsPerWindow;
          const curPart = Array.from(
            arr.slice(offset, offset + formantElemsPerWindow),
          );
          const formantIdx = curPart.shift()!;

          if (formantIdx > curIdx) {
            console.warn(
              `Skipped ${formantIdx - curIdx} frames (${curIdx} -> ${formantIdx})`,
            );
            curIdx = formantIdx;
          }

          if (formantIdx === curIdx) {
            newIndices.push(formantIdx);

            // extract values from the buffer
            const avgAmpl = curPart.shift()!;
            newAvgAmpls.push(avgAmpl);

            const voicing = curPart.shift()!;
            newVoicingCoeffs.push(voicing);

            const f0 = curPart.shift()!;
            newF0s.push(f0);

            const nFormants11 = curPart.shift()!;
            const formants11 = curPart.splice(0, nFormants11);
            newFormants11.push(formants11);
            const formantError11 = curPart.shift()!;
            newFormantErrors11.push(formantError11);

            const nFormants13 = curPart.shift()!;
            const formants13 = curPart.splice(0, nFormants13);
            newFormants13.push(formants13);
            const formantError13 = curPart.shift()!;
            newFormantErrors13.push(formantError13);

            const freqDataSlice = arr.slice(
              offset + formantElemsPerWindow,
              offset + elemsPerWindow,
            );
            freqDataHistory.push(freqDataSlice);
            curIdx++;
          }
        }
      });

      // Process the retrieved data and update visualizations
      for (let i = 0; i < newIndices.length; ++i) {
        const frameIdx = newIndices[i];
        // elapsed time from the beginning of the recording, in ms
        const elapsed = ((frameIdx * stftInterval) / sampleRate) * 1000;

        const voicingCoeff = newVoicingCoeffs[i];
        voicingCoeffsHistory.push(voicingCoeff);

        const f0 = newF0s[i];
        f0sHistory.push(f0);

        const formantData: { formants: number[]; validity: number }[] = [];
        for (const [formants, formantError] of [
          [newFormants11[i], newFormantErrors11[i]],
          [newFormants13[i], newFormantErrors13[i]],
        ] as [number[], number][]) {
          const formantErrorExponent = 2.0;
          const voicingCoeffExponent = 0.5;
          // Validity refers to how vowel-like the segment is
          const validityScore =
            Math.pow(Math.max(1e-6, 1 - formantError), formantErrorExponent) *
            Math.pow(Math.max(1e-6, voicingCoeff), voicingCoeffExponent);
          const validity = smoothstep(0.1, 0.6, validityScore);

          formantData.push({ formants, validity });
        }

        const avgValidity =
          formantData.map((d) => d.validity).reduce((a, b) => a + b, 0) /
          formantData.length;
        validityHistory.push(avgValidity);

        f0Sum += f0 * voicingCoeff;
        f0Count += voicingCoeff;
        const avgF0 = f0Sum / f0Count;

        origFormantsHistory.push(newFormants11[i]);

        const filterResults = tracker.updateMulti(formantData);
        const filteredFormants = filterResults.formants;
        const filterConfidence = filterResults.confidence;
        formantsHistory.push(filteredFormants);
        confidenceHistory.push(filterConfidence);

        vowelSpace.update(filteredFormants, newAvgAmpls[i], elapsed);
        if (i === newAvgAmpls.length - 1) {
          spectrum.draw(
            freqData,
            maxF0,
            filteredFormants,
            logNoiseFloor,
            sampleRate,
          );
        }
      }

      vowelSpace.draw(this.isMale, pointerTime);

      spectrogram.update(
        freqDataHistory,
        origFormantsHistory,
        formantsHistory,
        validityHistory,
        [],
        false,
      );
      spectrogram.draw();

      spectrogram2.update(
        freqDataHistory,
        origFormantsHistory,
        formantsHistory,
        validityHistory,
        [validityHistory],
        true,
      );
      spectrogram2.draw();

      console.debug("draw elapsed:", (performance.now() - t0).toFixed(2), "ms");
    };

    this.drawRefreshFn = drawRefresh;
    this.animFrameId = requestAnimationFrame(drawRefresh);
  }
}

// fetch the audio file and decode the data
async function getFile(audioContext: AudioContext, filepath: string) {
  const response = await fetch(filepath);
  const arrayBuffer = await response.arrayBuffer();
  return await audioContext.decodeAudioData(arrayBuffer);
}

// create a buffer, plop in data, connect and play -> modify graph here if required
function playSourceNode(audioContext: AudioContext, audioBuffer: AudioBuffer) {
  const soundSource = audioContext.createBufferSource();
  soundSource.buffer = audioBuffer;
  soundSource.loop = true;
  soundSource.start();
  return soundSource;
}

async function setupSample(audioCtx: AudioContext, filePath: string) {
  return await getFile(audioCtx, filePath);
}

function smoothstep(edge0: number, edge1: number, x: number) {
  // Scale, bias and saturate x to 0..1 range.
  x = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
  // Evaluate polynomial 3*x^2 - 2*x^3.
  return x * x * (3 - 2 * x);
}

function clamp(x: number, lowerlimit: number, upperlimit: number) {
  if (x < lowerlimit) {
    x = lowerlimit;
  }
  if (x > upperlimit) {
    x = upperlimit;
  }
  return x;
}
