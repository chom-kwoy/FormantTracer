export type DeblurredCanvas = HTMLCanvasElement & {
  origWidth: number;
  origHeight: number;
};

export function deblurCanvas(origCanvas: HTMLCanvasElement): DeblurredCanvas {
  const canvas = origCanvas as DeblurredCanvas;
  // Get the DPR and size of the canvas
  const dpr = window.devicePixelRatio;
  const rect = canvas.getBoundingClientRect();
  const width = rect.width;
  const height = rect.height;

  // Set the "actual" size of the canvas
  canvas.width = width * dpr;
  canvas.height = height * dpr;

  canvas.origWidth = width;
  canvas.origHeight = height;

  console.log(
    `Canvas size set to ${canvas.width}x${canvas.height} (DPR: ${dpr})`,
  );

  // Set the "drawn" size of the canvas
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  return canvas;
}
