function xcorr_mag(spec_magnitudes, maxlag, N, M, fftModule) {
  // Make fft contextt
  const pffft_runner = fftModule._pffft_runner_new(M, 8);

  // Get data byte size, allocate memory on Emscripten heap, and get pointer
  const nDataBytes = M * 8;
  const dataPtr = fftModule._malloc(nDataBytes);

  let fft_result = new Float32Array(M * 2);
  for (let i = 0; i < M; ++i) {
    fft_result[i * 2] = spec_magnitudes[i];
  }

  // Copy data to Emscripten heap (directly accessed from fftModule.HEAPU8)
  const dataHeap = new Uint8Array(fftModule.HEAPU8.buffer, dataPtr, nDataBytes);
  dataHeap.set(new Uint8Array(Float32Array.from(fft_result).buffer));

  fftModule._pffft_runner_inv_transform(pffft_runner, dataHeap.byteOffset);
  let cor = new Float32Array(dataHeap.buffer, dataHeap.byteOffset, M * 2);

  // Rescale
  for (let i = 0; i < M; ++i) {
    cor[i * 2] /= M;
    cor[i * 2 + 1] /= M;
  }

  let R = new Float32Array(maxlag * 2 + 1);
  for (let i = 0; i < maxlag; ++i) {
    R[i] = cor[(maxlag - i) * 2];
  }
  for (let i = 0; i < maxlag + 1; ++i) {
    R[maxlag + i] = cor[i * 2];
  }

  // correct for bias
  for (let i = 0; i < R.length; ++i) {
    R[i] /= N;
  }

  fftModule._free(dataPtr);
  fftModule._pffft_runner_destroy(pffft_runner);

  return R;
}

function levinson(acf, nPoles) {
  let ref = new Float32Array(nPoles);
  let g = -acf[1] / acf[0];
  let a = Float32Array.from([g]);
  let v = (1 - g * g) * acf[0];
  ref[0] = g;

  for (let t = 1; t < nPoles; ++t) {
    // g = -(acf(t+1) + a * acf(t:-1:2)) / v;
    let f = 0;
    for (let i = 0; i < t; ++i) {
      f += a[i] * acf[t - i];
    }
    g = -(acf[t + 1] + f) / v;

    // a = [ a+g*conj(a(t-1:-1:1)), g ];
    let new_a = new Float32Array(t + 1);
    for (let i = 0; i < t; ++i) {
      new_a[i] = a[i] + g * a[t - 1 - i];
    }
    new_a[t] = g;
    a = new_a;

    // v = v * ( 1 - real(g*conj(g)) );
    v = v * (1 - g * g);

    // ref(t) = g;
    ref[t] = g;
  }

  a = Float32Array.from([1.0, ...a]);

  return [a, v];
}

export function formantAnalysis(
  magnitudes,
  N,
  M,
  nPoles,
  sampleRate,
  eig,
  fftModule,
) {
  // autocorrelation
  let r = xcorr_mag(magnitudes, nPoles + 1, N, M, fftModule);
  r = r.slice(nPoles + 1);

  let [a, error] = levinson(r, nPoles);

  let A = new Array(nPoles);
  for (let i = 0; i < nPoles; ++i) {
    A[i] = new Array(nPoles).fill(0.0);
  }
  for (let i = 0; i < nPoles - 1; ++i) {
    A[i + 1][i] = 1.0;
  }

  for (let i = 0; i < nPoles; ++i) {
    A[0][i] = -a[i + 1] / a[0];
  }

  A = new eig.Matrix(A);
  const result = eig.Solvers.eigenSolve(A, true);
  delete result.info;

  let angles = new Float32Array(nPoles);
  for (let i = 0; i < nPoles; ++i) {
    let a = result.eigenvalues.get(i, 0).real();
    let b = result.eigenvalues.get(i, 0).imag();
    angles[i] = Math.abs(Math.atan2(b, a));
  }

  let uniqueAngles = Array.from(new Set(angles)).sort();

  let F = [];
  for (let i = 0; i < uniqueAngles.length; ++i) {
    F.push((uniqueAngles[i] * sampleRate) / (2 * Math.PI));
  }

  return [F, error];
}

export function fft_mag(x, fftModule) {
  let N = x.length;
  let M = Math.pow(2, Math.ceil(Math.log2(x.length)));

  // pad
  for (let i = N; i < M; ++i) {
    x.push(0);
  }

  // interleave
  let x_complex = new Float32Array(M * 2);
  for (let i = 0; i < M; ++i) {
    x_complex[i * 2] = x[i];
  }
  x = Float32Array.from(x_complex);

  // Make fft contextt
  const pffft_runner = fftModule._pffft_runner_new(M, 8);

  // Get data byte size, allocate memory on Emscripten heap, and get pointer
  const nDataBytes = M * 8;
  const dataPtr = fftModule._malloc(nDataBytes);

  // Copy data to Emscripten heap (directly accessed from fftModule.HEAPU8)
  const dataHeap = new Uint8Array(fftModule.HEAPU8.buffer, dataPtr, nDataBytes);
  dataHeap.set(new Uint8Array(x.buffer));

  fftModule._pffft_runner_transform(pffft_runner, dataHeap.byteOffset, 1);
  let fft_result = new Float32Array(
    dataHeap.buffer,
    dataHeap.byteOffset,
    M * 2,
  );

  // compute magnitude
  let magnitudes = new Float32Array(M);
  for (let i = 0; i < M; ++i) {
    let a = fft_result[i * 2],
      b = fft_result[i * 2 + 1];
    magnitudes[i] = a * a + b * b;
  }

  fftModule._free(dataPtr);
  fftModule._pffft_runner_destroy(pffft_runner);

  return [magnitudes, N, M];
}
