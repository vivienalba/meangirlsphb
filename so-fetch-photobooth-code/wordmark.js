// Display the supplied reference lettering, preserving its actual glyph shapes.
// The original attachment stays unchanged; the booth renders its lettering
// against the page and strip backgrounds at runtime.
export const WORDMARK_CROP = Object.freeze({ x: 28, y: 302, width: 1116, height: 184 });

export function renderReferenceWordmark(source, makeCanvas) {
  const crop = WORDMARK_CROP;
  const canvas = makeCanvas(crop.width, crop.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
  const pixels = ctx.getImageData(0, 0, crop.width, crop.height);
  const data = pixels.data;
  const background = Array.from(data.slice(0, 3));
  // A solid area inside the E in MEAN, away from antialiased edges.
  const inkOffset = ((326 - crop.y) * crop.width + (280 - crop.x)) * 4;
  const ink = Array.from(data.slice(inkOffset, inkOffset + 3));
  const difference = background.map((channel, index) => channel - ink[index]);
  const magnitude = difference.reduce((sum, channel) => sum + channel * channel, 0);
  if (magnitude < 100) throw new Error('The title artwork could not be read. Please reload the booth.');
  for (let offset = 0; offset < data.length; offset += 4) {
    let alpha = 0;
    for (let channel = 0; channel < 3; channel++) alpha += (background[channel] - data[offset + channel]) * difference[channel];
    alpha = Math.max(0, Math.min(1, (alpha / magnitude - 0.025) / 0.975));
    data[offset] = ink[0];
    data[offset + 1] = ink[1];
    data[offset + 2] = ink[2];
    data[offset + 3] = Math.round(alpha * 255);
  }
  ctx.putImageData(pixels, 0, 0);
  return canvas;
}

export async function loadReferenceWordmark() {
  const image = new Image();
  const loaded = new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error('The title artwork could not load. Please reload the booth.'));
  });
  image.src = new URL('./assets/mean-girls-reference.png', import.meta.url).href;
  await loaded;
  return renderReferenceWordmark(image, (width, height) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  });
}

export const FETCH_LOGO_CROP = Object.freeze({ x: 500, y: 34, width: 532, height: 364 });

// Preserve the paper faces and lettering from the supplied artwork. Only the
// surrounding white matte is cleared; the source image is never rewritten.
const PAPER_TILES = Object.freeze([
  [[512,63],[606,51],[615,201],[525,193]],
  [[527,222],[595,220],[595,379],[527,388]],
  [[614,229],[710,221],[710,360],[613,361]],
  [[724,231],[814,227],[813,351],[724,354]],
  [[835,219],[931,219],[921,356],[826,351]],
  [[950,259],[1021,268],[1008,366],[935,361]]
]);

export function renderFetchReferenceLogo(source, makeCanvas) {
  const crop = FETCH_LOGO_CROP;
  const canvas = makeCanvas(crop.width, crop.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
  const paper = makeCanvas(crop.width, crop.height);
  const paperCtx = paper.getContext('2d', { willReadFrequently: true });
  paperCtx.fillStyle = '#fff';
  for (const polygon of PAPER_TILES) {
    paperCtx.beginPath();
    polygon.forEach(([x, y], index) => {
      if (index) paperCtx.lineTo(x - crop.x, y - crop.y);
      else paperCtx.moveTo(x - crop.x, y - crop.y);
    });
    paperCtx.closePath();
    paperCtx.fill();
  }
  const coverage = paperCtx.getImageData(0, 0, crop.width, crop.height).data;
  const image = ctx.getImageData(0, 0, crop.width, crop.height);
  const data = image.data;
  for (let offset = 0; offset < data.length; offset += 4) {
    const matteCoverage = Math.min(1, (255 - Math.min(data[offset], data[offset + 1], data[offset + 2])) / 36);
    const alpha = Math.max(coverage[offset + 3] / 255, matteCoverage);
    if (alpha > 0 && alpha < 1) {
      for (let channel = 0; channel < 3; channel++) {
        data[offset + channel] = Math.max(0, Math.min(255, (data[offset + channel] - 255 * (1 - alpha)) / alpha));
      }
    }
    data[offset + 3] = Math.round(alpha * 255);
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

export async function loadFetchReferenceLogo() {
  const image = new Image();
  const loaded = new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error('The So Fetch logo could not load. Please reload the booth.'));
  });
  image.src = new URL('./assets/so-fetch-reference.png', import.meta.url).href;
  await loaded;
  return renderFetchReferenceLogo(image, (width, height) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  });
}
