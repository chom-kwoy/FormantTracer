export class FormantGrid {
  constructor(vowelCanvas, f1Min, f1Max, f2Min, f2Max, transformFunction) {
    this.vowelCanvas = vowelCanvas;
    this.vowelCanvasCtx = vowelCanvas.getContext("2d");

    const [layer, context] = newContext(vowelCanvas);
    this.vowelLayer = layer;
    this.vowelLayerCtx = context;

    const [layer2, context2] = newContext(vowelCanvas);
    this.vowelLayer2 = layer2;
    this.vowelLayer2Ctx = context2;

    this.transformFunction = transformFunction;
    this.f1Min = f1Min;
    this.f1Max = f1Max;
    this.f2Min = f2Min;
    this.f2Max = f2Max;

    this.isLastValid = false;
    this.lastX = null;
    this.lastY = null;
    this.lastR = null;
  }

  draw(F_filtered, avgAmpl, elapsed) {
    // Draw formant gridlines
    this.vowelCanvasCtx.fillStyle = "rgb(240,240,240)";
    this.vowelCanvasCtx.fillRect(
      0,
      0,
      this.vowelCanvas.width,
      this.vowelCanvas.height,
    );

    const t = this.transformFunction;
    const f1YCoord = (i) =>
      ((t(i) - t(this.f1Min)) / (t(this.f1Max) - t(this.f1Min))) *
      this.vowelCanvas.height;
    const f2XCoord = (i) =>
      ((-t(i) + t(this.f2Max)) / (t(this.f2Max) - t(this.f2Min))) *
      this.vowelCanvas.width;

    // Grey out the invalid area (F1 > F2)
    this.vowelCanvasCtx.fillStyle = "rgb(230,230,230)";
    this.vowelCanvasCtx.beginPath();
    this.vowelCanvasCtx.moveTo(f2XCoord(this.f1Max), f1YCoord(this.f1Max));
    this.vowelCanvasCtx.lineTo(f2XCoord(this.f2Min), f1YCoord(this.f2Min));
    this.vowelCanvasCtx.lineTo(f2XCoord(this.f2Min), f1YCoord(this.f1Max));
    this.vowelCanvasCtx.fill();
    this.vowelCanvasCtx.closePath();

    for (let i = this.f1Min; i < this.f1Max; i += 100) {
      let y = f1YCoord(i);

      let th;
      if (i % 500 === 0) {
        this.vowelCanvasCtx.fillStyle = "rgb(60,60,60)";
        this.vowelCanvasCtx.font = "bold 11px sans-serif";
        th = 2;
      } else {
        this.vowelCanvasCtx.fillStyle = "rgb(100,100,100)";
        this.vowelCanvasCtx.font = "10px sans-serif";
        th = 1;
      }
      this.vowelCanvasCtx.fillRect(0, y - th / 2, this.vowelCanvas.width, th);
      this.vowelCanvasCtx.fillText(i === this.f1Min ? `F1` : `${i}`, 1, y + 10);
    }
    for (let i = this.f2Min; i <= this.f2Max; i += 100) {
      let x = f2XCoord(i);

      let th;
      let doLabel = true;
      if (i % 500 === 0) {
        this.vowelCanvasCtx.fillStyle = "rgb(60,60,60)";
        this.vowelCanvasCtx.font = "bold 11px sans-serif";
        th = 2;
      } else if (i < 1500) {
        this.vowelCanvasCtx.fillStyle = "rgb(100,100,100)";
        this.vowelCanvasCtx.font = "10px sans-serif";
        th = 1;
      } else {
        doLabel = false;
      }
      if (doLabel) {
        this.vowelCanvasCtx.fillRect(
          x - th / 2,
          0,
          th,
          this.vowelCanvas.height,
        );
        this.vowelCanvasCtx.fillText(
          i === this.f2Min + 100 ? `F2` : `${i}`,
          x + 1,
          this.vowelCanvas.height - 3,
        );
      }
    }

    // Draw vowel space
    if (F_filtered.length >= 2) {
      let x_coord =
        (-t(F_filtered[1]) + t(this.f2Max)) / (t(this.f2Max) - t(this.f2Min));
      x_coord *= this.vowelCanvas.width;
      let y_coord =
        (t(F_filtered[0]) - t(this.f1Min)) / (t(this.f1Max) - t(this.f1Min));
      y_coord *= this.vowelCanvas.height;
      let r = Math.sqrt(Math.max(1, 20 * (3 + Math.log10(avgAmpl))));

      // Render new dot on buffer#1
      this.vowelLayerCtx.fillStyle = `hsl(${elapsed * 0.2}deg 80% 50%)`;
      this.vowelLayerCtx.beginPath();
      this.vowelLayerCtx.ellipse(x_coord, y_coord, r, r, 0, 0, 2 * Math.PI);
      this.vowelLayerCtx.fill();
      this.vowelLayerCtx.closePath();

      if (this.isLastValid && r > 3) {
        let dx = x_coord - this.lastX;
        let dy = y_coord - this.lastY;
        let rd = r - this.lastR;

        let d_sq = dx * dx + dy * dy;
        let t = Math.sqrt(rd * rd * dx * dx - d_sq * (rd * rd - dy * dy));

        let a1x = (rd * dx + t) / d_sq;
        let a1y = (rd - dx * a1x) / dy;

        let a2x = (rd * dx - t) / d_sq;
        let a2y = (rd - dx * a2x) / dy;

        this.vowelLayerCtx.beginPath();
        this.vowelLayerCtx.moveTo(x_coord - r * a1x, y_coord - r * a1y);
        this.vowelLayerCtx.lineTo(
          this.lastX - this.lastR * a1x,
          this.lastY - this.lastR * a1y,
        );
        this.vowelLayerCtx.lineTo(
          this.lastX - this.lastR * a2x,
          this.lastY - this.lastR * a2y,
        );
        this.vowelLayerCtx.lineTo(x_coord - r * a2x, y_coord - r * a2y);
        this.vowelLayerCtx.fill();
        this.vowelLayerCtx.closePath();
      }

      // Render on buffer#2 with slightly lowered opacity
      this.vowelLayer2Ctx.globalAlpha = 1.0;
      this.vowelLayer2Ctx.clearRect(
        0,
        0,
        this.vowelCanvas.width,
        this.vowelCanvas.height,
      );
      this.vowelLayer2Ctx.globalAlpha = 0.99;
      this.vowelLayer2Ctx.drawImage(this.vowelLayer, 0, 0);

      // Overwrite buffer#1
      this.vowelLayerCtx.clearRect(
        0,
        0,
        this.vowelCanvas.width,
        this.vowelCanvas.height,
      );
      this.vowelLayerCtx.drawImage(this.vowelLayer2, 0, 0);

      // Draw buffer#1 on top of grid onto screen
      this.vowelCanvasCtx.drawImage(this.vowelLayer, 0, 0);

      this.lastX = x_coord;
      this.lastY = y_coord;
      this.lastR = r;
      this.isLastValid = true;
    }
  }
}

// Make new virtual canvasCtx with identical size
function newContext({ width, height }, contextType = "2d") {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return [canvas, canvas.getContext(contextType)];
}
