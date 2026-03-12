import eig from "eigen";

import {
  bandwidthThreshold,
  fftSize,
  formantCeiling,
  formantFloor,
  freqBinSize,
  sampleRate,
} from "../constants";
import { detectF0, fft_mag, formantAnalysis } from "../lib/formant_utils.mjs";

export function analyze(timeData, fftModule) {
  // Check voicing first
  const [voicing, f0] = detectF0(timeData, sampleRate);

  let [spectrum, N, M] = fft_mag(
    Array.from(timeData), // expects a regular array
    fftModule,
    fftSize,
  );

  // Run formant analysis
  const getFormants = (numPoles) => {
    let [F, formantError] = formantAnalysis(
      spectrum,
      freqBinSize * 2,
      freqBinSize * 2,
      numPoles,
      sampleRate,
      bandwidthThreshold,
      eig,
      fftModule,
    );

    // Filter out extreme values and only take F1, F2, and F3
    let F_filtered = [];
    for (let i = 0; i < F.length && F_filtered.length < 3; ++i) {
      if (F[i] < formantFloor || F[i] > formantCeiling) {
        continue;
      }
      F_filtered.push(F[i]);
    }

    return [F_filtered, formantError];
  };

  const [formants11, formantError11] = getFormants(11);
  const [formants13, formantError13] = getFormants(13);

  // Compute RMS amplitude
  let avgAmpl = 0;
  for (let i = 0; i < timeData.length; ++i) {
    avgAmpl += (timeData[i] * timeData[i]) / timeData.length;
  }
  avgAmpl = Math.sqrt(avgAmpl);

  return {
    spectrum: spectrum,
    voicing: voicing,
    f0: f0,
    formants11: formants11,
    formantError11: formantError11,
    formants13: formants13,
    formantError13: formantError13,
    avgAmpl: avgAmpl,
  };
}
