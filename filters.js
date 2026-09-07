// The live canvas and exported photos use these same pixel transformations.
// This avoids relying on CanvasRenderingContext2D.filter support in Safari.
function colorMatrix({ saturation = 1, contrast = 1, brightness = 1, red = 1, green = 1, blue = 1, lift = 0 }) {
  const luma = [0.2126, 0.7152, 0.0722];
  const channels = [red, green, blue];
  return Object.freeze(channels.flatMap((channel, row) => [
    ...luma.map((value, column) => (value * (1 - saturation) + (row === column ? saturation : 0)) * contrast * brightness * channel),
    (128 - 128 * contrast) * brightness * channel + lift
  ]));
}

export const FILTERS = Object.freeze([
  Object.freeze({ id: 'original', name: 'Original', description: 'True to you. No filter.', matrix: null }),
  Object.freeze({ id: 'pink-haze', name: 'Pink Haze', description: 'Soft contrast, a little rose, very pink.', matrix: colorMatrix({ saturation: 0.82, contrast: 0.92, brightness: 1.02, red: 1.09, green: 0.96, blue: 1.025, lift: 3 }) }),
  Object.freeze({ id: 'plastics', name: 'Plastics', description: 'Cool tones with a polished, glossy finish.', matrix: colorMatrix({ saturation: 0.9, contrast: 1.13, brightness: 1.02, red: 0.985, green: 0.995, blue: 1.055 }) }),
  Object.freeze({ id: 'flash-04', name: '’04 Flash', description: 'Bright highlights and crisp, throwback contrast.', matrix: colorMatrix({ saturation: 0.84, contrast: 1.18, brightness: 1.13, red: 1.03, green: 1.01, blue: 0.985 }) }),
  Object.freeze({ id: 'yearbook', name: 'Yearbook', description: 'Classic black-and-white with a little drama.', matrix: colorMatrix({ saturation: 0, contrast: 1.18, brightness: 1.025 }) }),
  Object.freeze({ id: 'vintage', name: 'Vintage', description: 'Warm, faded color. Straight out of a memory box.', matrix: colorMatrix({ saturation: 0.64, contrast: 0.86, brightness: 1.01, red: 1.055, green: 1.01, blue: 0.89, lift: 5 }) })
]);

export function findFilter(id) {
  return FILTERS.find(filter => filter.id === id) || FILTERS[0];
}

export function transformPixels(pixels, filterId) {
  const matrix = findFilter(filterId).matrix;
  if (!matrix) return pixels;
  const [a,b,c,d,e,f,g,h,i,j,k,l] = matrix;
  for (let offset = 0; offset < pixels.length; offset += 4) {
    const red = pixels[offset];
    const green = pixels[offset + 1];
    const blue = pixels[offset + 2];
    pixels[offset] = a * red + b * green + c * blue + d;
    pixels[offset + 1] = e * red + f * green + g * blue + h;
    pixels[offset + 2] = i * red + j * green + k * blue + l;
  }
  return pixels;
}

export function applyPhotoFilter(ctx, width, height, filterId) {
  if (!findFilter(filterId).matrix) return;
  const image = ctx.getImageData(0, 0, width, height);
  transformPixels(image.data, filterId);
  ctx.putImageData(image, 0, 0);
}
