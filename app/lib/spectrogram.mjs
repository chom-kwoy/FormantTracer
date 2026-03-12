export class Spectrogram {
  constructor(canvas) {
    this.canvas = canvas;
    this.canvasCtx = canvas.getContext("2d");
  }

  draw(formantsHistory) {
    // Clear spectrum canvas
    this.canvasCtx.fillStyle = "rgb(0, 0, 0)";
    this.canvasCtx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    const windowSize = 300;
    const minFreq = 200; // Hz
    const maxFreq = 5000; // Hz

    let beginIndex = Math.max(0, formantsHistory.length - windowSize);
    let endIndex = formantsHistory.length;

    let lastF1 = null;
    let lastF2 = null;
    let lastF3 = null;
    for (let i = beginIndex; i < endIndex; ++i) {
      let formants = formantsHistory[i];

      if (formants.length >= 1) {
        let f1 = formants[0];

        let x = ((i - beginIndex) * this.canvas.width) / windowSize;
        let y =
          this.canvas.height -
          ((f1 - minFreq) / (maxFreq - minFreq)) * this.canvas.height;

        if (lastF1 === null) {
          lastF1 = f1;
        }

        // draw line from lastF1 to f1
        this.canvasCtx.beginPath();
        this.canvasCtx.moveTo(
          ((i - 1 - beginIndex) * this.canvas.width) / windowSize,
          this.canvas.height -
            ((lastF1 - minFreq) / (maxFreq - minFreq)) * this.canvas.height,
        );
        this.canvasCtx.lineTo(x, y);
        this.canvasCtx.lineWidth = 3;
        this.canvasCtx.strokeStyle = "rgb(255,50,50)";
        this.canvasCtx.stroke();

        lastF1 = f1;
      }

      if (formants.length >= 2) {
        let f2 = formants[1];

        let x = ((i - beginIndex) * this.canvas.width) / windowSize;
        let y =
          this.canvas.height -
          ((f2 - minFreq) / (maxFreq - minFreq)) * this.canvas.height;

        if (lastF2 === null) {
          lastF2 = f2;
        }

        // draw line from lastF2 to f2
        this.canvasCtx.beginPath();
        this.canvasCtx.moveTo(
          ((i - 1 - beginIndex) * this.canvas.width) / windowSize,
          this.canvas.height -
            ((lastF2 - minFreq) / (maxFreq - minFreq)) * this.canvas.height,
        );
        this.canvasCtx.lineTo(x, y);
        this.canvasCtx.lineWidth = 3;
        this.canvasCtx.strokeStyle = "rgb(50,255,50)";
        this.canvasCtx.stroke();

        lastF2 = f2;
      }

      if (formants.length >= 3) {
        let f3 = formants[2];

        let x = ((i - beginIndex) * this.canvas.width) / windowSize;
        let y =
          this.canvas.height -
          ((f3 - minFreq) / (maxFreq - minFreq)) * this.canvas.height;

        if (lastF3 === null) {
          lastF3 = f3;
        }

        // draw line from lastF3 to f3
        this.canvasCtx.beginPath();
        this.canvasCtx.moveTo(
          ((i - 1 - beginIndex) * this.canvas.width) / windowSize,
          this.canvas.height -
            ((lastF3 - minFreq) / (maxFreq - minFreq)) * this.canvas.height,
        );
        this.canvasCtx.lineTo(x, y);
        this.canvasCtx.lineWidth = 3;
        this.canvasCtx.strokeStyle = "rgb(50,50,255)";
        this.canvasCtx.stroke();

        lastF3 = f3;
      }
    }
  }
}
