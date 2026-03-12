"use client";
import eig from "eigen";

import { FormantGrid } from "./lib/formant_grid.mjs";
import { KalmanFilter } from "./lib/kalman.mjs";
import { pffft_simd } from "./lib/pffft.simd.mjs";
import { Spectrogram } from "./lib/spectrogram.mjs";
import { Spectrum } from "./lib/spectrum.mjs";
import TripleBuffer from "./lib/triplebuffer.mjs";

export default function Formant() {
  return (
    <div>
      <header className="flex items-center justify-between p-4">
        <h1>Vowel Tracer</h1>
      </header>
      <div className="flex justify-center items-center space-x-4">
        <button
          className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
          onClick={() => start()}
        >
          Start
        </button>
      </div>
      <div>
        <canvas
          id="vowelspace"
          width="640"
          height="480"
          className="border-blue-500 border-2"
        ></canvas>
        <canvas
          id="spectrogram"
          width="640"
          height="240"
          className="border-blue-500 border-2"
        ></canvas>
        <canvas
          id="spectrum"
          width="640"
          height="480"
          className="border-blue-500 border-2"
        ></canvas>
      </div>
    </div>
  );
}

async function start() {
  console.log("start");
  const fftModule = await pffft_simd();
  await eig.ready;
  console.log(fftModule);

  const sampleRate = 11000;
  const maxF0 = 500;
  const logNoiseFloor = -120;
  const windowSize = 512;
  const useMic = false;
  const audioCtx = new AudioContext({ sampleRate: sampleRate });
  const filePath = "little prince.mp3"; //'kawuy.mp3'; // 'problematic.wav';

  const nWindows = 64;
  const elemsPerWindow = 8;

  // Set up the different audio nodes we will use for the app

  // Pre-emphasis filter
  const iirfilter = audioCtx.createIIRFilter(
    [1.0, -0.97184404666301134449],
    [1.0, 0.0],
  );

  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = windowSize;
  analyser.smoothingTimeConstant = 0.9;

  await audioCtx.audioWorklet.addModule("processors/formant-processor.js");
  const formantNode = new AudioWorkletNode(audioCtx, "FormantProcessor");
  const tripleBuffer = new TripleBuffer(1 + nWindows * elemsPerWindow);
  formantNode.port.postMessage(tripleBuffer.tripleBuffer);

  // Main block for doing the audio recording
  const constraints = {
    audio: {
      autoGainControl: false,
      echoCancellation: false,
      noiseSuppression: false,
      sampleRate: sampleRate,
    },
  };

  if (useMic) {
    navigator.mediaDevices.getUserMedia(constraints).then((stream) => {
      const source = audioCtx.createMediaStreamSource(stream);
      //source.connect(audioCtx.destination);

      source.connect(iirfilter);
      iirfilter.connect(analyser);

      visualize();
    });
  } else {
    setupSample(audioCtx, filePath).then((sample) => {
      const source = playSourceNode(audioCtx, sample);
      source.connect(formantNode);
      formantNode.connect(iirfilter);
      iirfilter.connect(analyser);

      formantNode.connect(audioCtx.destination);

      visualize();
    });
  }

  // Setup vowel space canvas
  const vowelCanvas = document.getElementById("vowelspace");
  const specCanvas = document.getElementById("spectrum");
  const spectrogramCanvas = document.getElementById("spectrogram");

  function visualize(logScale = true) {
    const freqBinSize = analyser.frequencyBinCount; // half of windowSize

    // Buffers
    const freqData = new Float32Array(freqBinSize);

    const f1Min = 250;
    const f1Max = 1500;
    const f2Min = 500;
    const f2Max = 4000;
    const t = logScale ? Math.log : (x: number) => x;

    const vowelSpace = new FormantGrid(
      vowelCanvas,
      f1Min,
      f1Max,
      f2Min,
      f2Max,
      t,
    );
    const spectrum = new Spectrum(specCanvas, fftModule, freqBinSize);
    const spectrogram = new Spectrogram(spectrogramCanvas);
    const kalmanFilter = new KalmanFilter(eig);

    let curIdx = 0;
    let startTime: number | undefined = undefined;
    const formantsHistory: Float32Array[] = [];
    const drawRefresh = (timeStamp: number) => {
      requestAnimationFrame(drawRefresh);

      if (startTime === undefined) {
        startTime = timeStamp;
      }
      const elapsed = timeStamp - startTime;

      // Retrieve audio data
      analyser.getFloatFrequencyData(freqData); // -inf to 0.0

      const newAvgAmpls: number[] = [];
      const newFormants: Float32Array[] = [];
      tripleBuffer.consume((arr: Float32Array) => {
        // copy buffer content to timeData
        const numElems = arr[0];
        for (let i = 0; i < numElems / elemsPerWindow; ++i) {
          const offset = 1 + i * elemsPerWindow;
          const formantIdx = arr[offset];
          if (formantIdx === curIdx) {
            const avgAmpl = arr[offset + 1];
            const nFormants = arr[offset + 2];
            const formants = arr.slice(offset + 3, offset + 3 + nFormants);
            newAvgAmpls.push(avgAmpl);
            newFormants.push(formants);
            curIdx++;
          }
        }
      });

      for (let i = 0; i < newFormants.length; ++i) {
        formantsHistory.push(newFormants[i]);
      }

      for (let i = 0; i < newAvgAmpls.length; ++i) {
        const avgAmpl = newAvgAmpls[i];
        const formants = newFormants[i];

        // Kalman filter
        if (formants.length >= 2) {
          [formants[0], formants[1]] = kalmanFilter.add_and_predict(
            formants[0],
            formants[1],
          );
        }

        vowelSpace.draw(formants, avgAmpl, elapsed);
        spectrum.draw(freqData, maxF0, formants, logNoiseFloor, sampleRate);
      }

      spectrogram.draw(formantsHistory);
    };

    requestAnimationFrame(drawRefresh);
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
