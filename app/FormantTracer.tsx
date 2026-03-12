"use client";
import eig from "eigen";
import { useRef, useState } from "react";

import { FormantTracker } from "@/app/lib/formant_tracker";

import {
  elemsPerWindow,
  formantElemsPerWindow,
  interval,
  nWindows,
  sampleRate,
  windowSize,
} from "./constants.js";
import { FormantGrid } from "./lib/formant_grid.mjs";
import { Spectrogram } from "./lib/spectrogram.mjs";
import { Spectrum } from "./lib/spectrum.mjs";
import { pffft_simd } from "./lib/third_party/pffft.simd.mjs";
import TripleBuffer from "./lib/triplebuffer.mjs";

export default function FormantTracer() {
  const appRef = useRef<FormantApp | null>(null);
  const [isMale, setIsMale] = useState<boolean>(true);

  const handleClick = () => {
    if (!appRef.current) {
      appRef.current = new FormantApp(isMale);
    }
    appRef.current.toggle();
  };

  return (
    <div className="bg-gray-100">
      <header className="flex items-center justify-between p-4 bg-blue-500 text-white mb-2">
        <h1 className="text-xl font-bold">Vowel Tracer</h1>
      </header>
      <div className="flex justify-center items-center space-x-4 m-1">
        <button
          className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
          onClick={() => {
            setIsMale(!isMale);
            if (appRef.current) {
              appRef.current.setIsMale(!isMale);
            }
          }}
        >
          {isMale ? "Male" : "Female"}
        </button>
        <button className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded">
          Open File...
        </button>
        <button
          id="startBtn"
          className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
          onClick={handleClick}
        >
          Start
        </button>
      </div>
      <div className="flex flex-col items-center">
        <div>
          <span>Formant Space</span>
          <canvas
            id="vowelspace"
            width="640"
            height="480"
            className="border-blue-500 border-2"
          />
        </div>
        <div>
          <span>Spectrogram</span>
          <canvas
            id="spectrogram2"
            width="640"
            height="240"
            className="border-blue-500 border-2"
          />
        </div>
        <div>
          <span>Spectrogram (Raw)</span>
          <canvas
            id="spectrogram"
            width="640"
            height="240"
            className="border-blue-500 border-2"
          />
        </div>
        <div>
          <span>Spectrum (filtered / cepstrum / log spectrum)</span>
          <canvas
            id="spectrum"
            width="640"
            height="480"
            className="border-blue-500 border-2"
          />
        </div>
      </div>
    </div>
  );
}

class FormantApp {
  private audioCtx: AudioContext | null = null;
  private animFrameId: number | null = null;
  private isPlaying = false;
  private drawRefreshFn: ((ts: number) => void) | null = null;
  private isMale: boolean;

  constructor(isMale: boolean) {
    this.isMale = isMale;
  }

  setIsMale(isMale: boolean) {
    this.isMale = isMale;
  }

  async toggle() {
    const btn = document.getElementById("startBtn") as HTMLButtonElement;

    if (!this.isPlaying) {
      if (!this.audioCtx) {
        await this.start();
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

  private async start() {
    const fftModule = await pffft_simd();
    await eig.ready;
    console.log("FFT window length (s): ", windowSize / sampleRate, "s");
    console.log("FFT interval (s): ", interval / sampleRate, "s");

    const maxF0 = 500;
    const logNoiseFloor = -120;
    this.audioCtx = new AudioContext({ sampleRate: sampleRate });
    const filePath = "kawuy_male.mp3";
    // const filePath = "problematic.wav";

    const iirfilter = this.audioCtx.createIIRFilter(
      [1.0, -0.97184404666301134449],
      [1.0, 0.0],
    );

    const analyser = this.audioCtx.createAnalyser();
    analyser.fftSize = windowSize;
    analyser.smoothingTimeConstant = 0.9;

    await this.audioCtx.audioWorklet.addModule(
      "processors/formant-processor.js",
    );
    const formantNode = new AudioWorkletNode(this.audioCtx, "FormantProcessor");
    const tripleBuffer = new TripleBuffer(1 + nWindows * elemsPerWindow);
    formantNode.port.postMessage(tripleBuffer.tripleBuffer);

    const useMic = false;
    if (useMic) {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: false,
          echoCancellation: false,
          noiseSuppression: false,
          sampleRate: sampleRate,
        },
      });
      const source = this.audioCtx.createMediaStreamSource(stream);
      source.connect(iirfilter);
      iirfilter.connect(analyser);
    } else {
      const sample = await setupSample(this.audioCtx, filePath);
      const source = playSourceNode(this.audioCtx, sample);
      source.connect(iirfilter);
      iirfilter.connect(formantNode);
      iirfilter.connect(analyser);
      source.connect(this.audioCtx.destination);
    }

    const vowelCanvas = document.getElementById(
      "vowelspace",
    ) as HTMLCanvasElement;
    const specCanvas = document.getElementById("spectrum") as HTMLCanvasElement;
    const spectrogramCanvas = document.getElementById(
      "spectrogram",
    ) as HTMLCanvasElement;
    const spectrogram2Canvas = document.getElementById(
      "spectrogram2",
    ) as HTMLCanvasElement;

    const freqBinSize = analyser.frequencyBinCount;
    const freqData = new Float32Array(freqBinSize);

    const vowelSpace = new FormantGrid(
      vowelCanvas,
      200, // f1Min
      1100, // f1Max
      500, // f2Min
      2700, // f2Max
      Math.log, // f1 scale
      (x: number) => x, // f2 scale
    );
    const spectrum = new Spectrum(specCanvas, fftModule, freqBinSize);
    const spectrogram = new Spectrogram(spectrogramCanvas);
    const spectrogram2 = new Spectrogram(spectrogram2Canvas);
    const tracker = new FormantTracker();

    let curIdx = 0;
    let startTime: number | undefined = undefined;
    const formantsHistory: number[][] = [];
    const origFormantsHistory: number[][] = [];
    const confidenceHistory: number[][] = [];
    const formantErrorsHistory: number[] = [];
    const voicingCoeffsHistory: number[] = [];
    const f0sHistory: number[] = [];
    const freqDataHistory: Float32Array[] = [];

    const drawRefresh = (timeStamp: number) => {
      this.animFrameId = requestAnimationFrame(drawRefresh);

      if (startTime === undefined) startTime = timeStamp;
      const elapsed = timeStamp - startTime;

      analyser.getFloatFrequencyData(freqData);

      const newAvgAmpls: number[] = [];
      const newFormants: number[][] = [];

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
            // extract values from the buffer
            const avgAmpl = curPart.shift()!;
            newAvgAmpls.push(avgAmpl);

            const formantError = curPart.shift()!;
            formantErrorsHistory.push(formantError);

            const voicing = curPart.shift()!;
            voicingCoeffsHistory.push(voicing);

            const f0 = curPart.shift()!;
            f0sHistory.push(f0);

            const nFormants = curPart.shift()!;
            const formants = curPart.slice(0, nFormants);
            newFormants.push(formants);

            const freqDataSlice = arr.slice(
              offset + formantElemsPerWindow,
              offset + elemsPerWindow,
            );
            freqDataHistory.push(freqDataSlice);
            curIdx++;
          }
        }
      });

      for (let i = 0; i < newAvgAmpls.length; ++i) {
        const origFormants = newFormants[i];
        origFormantsHistory.push(origFormants);

        const filterResults = tracker.update(origFormants);
        const filteredFormants = filterResults.formants;
        const filterConfidence = filterResults.confidence;
        formantsHistory.push(filteredFormants);
        confidenceHistory.push(filterConfidence);

        // console.log("orig", Array.from(formants));
        // console.log("filtered", filteredFormants);

        vowelSpace.draw(filteredFormants, newAvgAmpls[i], elapsed, this.isMale);
        spectrum.draw(
          freqData,
          maxF0,
          filteredFormants,
          logNoiseFloor,
          sampleRate,
        );
      }

      spectrogram.draw(
        freqDataHistory,
        origFormantsHistory,
        formantsHistory,
        confidenceHistory,
        formantErrorsHistory,
        voicingCoeffsHistory,
        f0sHistory,
        false,
        true,
      );
      spectrogram2.draw(
        freqDataHistory,
        origFormantsHistory,
        formantsHistory,
        confidenceHistory,
        formantErrorsHistory,
        voicingCoeffsHistory,
        f0sHistory,
        true,
        false,
      );
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
