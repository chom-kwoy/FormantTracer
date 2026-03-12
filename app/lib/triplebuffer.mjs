// Lock-free triple buffer
export default class TripleBuffer {
  constructor(N) {
    this.tripleBuffer = {
      tripleBuffers: [
        new SharedArrayBuffer(N * 4),
        new SharedArrayBuffer(N * 4),
        new SharedArrayBuffer(N * 4),
      ],
      presentIdx: new SharedArrayBuffer(4),
      readyIdx: new SharedArrayBuffer(4),
      inprogressIdx: new SharedArrayBuffer(4),
      stale: new SharedArrayBuffer(1),
    };

    this.tripleBuffers = [
      new Float32Array(this.tripleBuffer.tripleBuffers[0]),
      new Float32Array(this.tripleBuffer.tripleBuffers[1]),
      new Float32Array(this.tripleBuffer.tripleBuffers[2]),
    ];
    this.presentIdx = new Int32Array(this.tripleBuffer.presentIdx);
    this.readyIdx = new Int32Array(this.tripleBuffer.readyIdx);
    this.inprogressIdx = new Int32Array(this.tripleBuffer.inprogressIdx);
    this.stale = new Uint8Array(this.tripleBuffer.stale);

    this.presentIdx[0] = 0;
    this.readyIdx[0] = 1;
    this.inprogressIdx[0] = 2;
  }

  consume(callback) {
    let curPresentIdx = Atomics.load(this.presentIdx, 0);

    callback(this.tripleBuffers[curPresentIdx]);

    while (Atomics.exchange(this.stale, 0, 1)); // wait untile stale flag clears
    let origReadyIdx = Atomics.exchange(this.readyIdx, 0, curPresentIdx); // point ready idx to most recently read buffer
    Atomics.store(this.presentIdx, 0, origReadyIdx); // point present idx to old ready buffer
  }
}
