// Short dialogue excerpts from Mean Girls (2004).
// https://www.imdb.com/title/tt0377092/quotes/
export const QUOTES = Object.freeze([
  'On Wednesdays, we wear pink.',
  'You can’t sit with us!',
  'That is so fetch!',
  'Get in, loser. We’re going shopping.',
  'The limit does not exist.'
]);

export const STRIP = Object.freeze({ width: 600, height: 1800, x: 42, y: 180, photoWidth: 516, photoHeight: 387, gap: 22, count: 3 });

export const FONTS = Object.freeze({
  editorial: '"Booth Editorial", Georgia, serif',
  ui: 'Jost, Arial, sans-serif'
});

export function drawMovieWordmark(ctx, artwork) {
  if (!artwork) return;
  const width = STRIP.photoWidth;
  const height = width * artwork.height / artwork.width;
  ctx.drawImage(artwork, (STRIP.width - width) / 2, 30, width, height);
}

export function createQuotePicker(random = Math.random) {
  let bag = [];
  let last;
  return () => {
    if (!bag.length) {
      bag = [...QUOTES];
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [bag[i], bag[j]] = [bag[j], bag[i]];
      }
      if (bag[bag.length - 1] === last) [bag[0], bag[bag.length - 1]] = [bag[bag.length - 1], bag[0]];
    }
    last = bag.pop();
    return last;
  };
}

export function coverCrop(sourceWidth, sourceHeight, targetWidth, targetHeight) {
  if (Math.min(sourceWidth, sourceHeight, targetWidth, targetHeight) <= 0) throw new Error('The camera is not ready yet.');
  const scale = Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const width = targetWidth / scale;
  const height = targetHeight / scale;
  return { x: (sourceWidth - width) / 2, y: (sourceHeight - height) / 2, width, height };
}

function centeredText(ctx, text, y, font, color) {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.fillText(text, STRIP.width / 2, y);
}

export function wrapText(ctx, text, maxWidth) {
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    const test = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(test).width > maxWidth) { lines.push(line); line = word; }
    else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

export function drawStrip(canvas, photos = [], quote = '', date = null, artwork = null) {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Your browser could not create the photo strip.');
  ctx.clearRect(0, 0, STRIP.width, STRIP.height);
  ctx.fillStyle = '#f6a9cb';
  ctx.fillRect(0, 0, STRIP.width, STRIP.height);
  ctx.strokeStyle = '#b92965';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(19, 19, 562, 1762);
  drawMovieWordmark(ctx, artwork);
  centeredText(ctx, 'P H O T O B O O T H', 139, `500 18px ${FONTS.ui}`, '#67213e');

  for (let index = 0; index < STRIP.count; index++) {
    const y = STRIP.y + index * (STRIP.photoHeight + STRIP.gap);
    ctx.fillStyle = '#fff7fa';
    ctx.fillRect(STRIP.x - 5, y - 5, STRIP.photoWidth + 10, STRIP.photoHeight + 10);
    if (photos[index]) {
      ctx.drawImage(photos[index], STRIP.x, y, STRIP.photoWidth, STRIP.photoHeight);
    } else {
      ctx.fillStyle = '#e5b9cc';
      ctx.fillRect(STRIP.x, y, STRIP.photoWidth, STRIP.photoHeight);
      centeredText(ctx, `0${index + 1}`, y + 198, `italic 500 74px ${FONTS.editorial}`, '#88536b');
      centeredText(ctx, 'YOUR MOMENT HERE', y + 244, `500 17px ${FONTS.ui}`, '#88536b');
    }
  }

  ctx.strokeStyle = '#b92965';
  ctx.beginPath();
  ctx.moveTo(242, 1446); ctx.lineTo(358, 1446); ctx.stroke();
  const text = quote ? `“${quote}”` : 'One iconic line.\nJust for you.';
  ctx.font = `italic 600 46px ${FONTS.editorial}`;
  let lines = quote ? wrapText(ctx, text, 464) : text.split('\n');
  let fontSize = 46;
  while (lines.length > 3 && fontSize > 26) {
    fontSize -= 2;
    ctx.font = `italic 600 ${fontSize}px ${FONTS.editorial}`;
    lines = wrapText(ctx, text, 464);
  }
  const lineHeight = fontSize * 1.22;
  const firstBaseline = 1557 - (lines.length - 1) * lineHeight / 2;
  lines.forEach((line, index) => centeredText(ctx, line, firstBaseline + index * lineHeight, `italic 600 ${fontSize}px ${FONTS.editorial}`, '#2c1020'));
  if (date) {
    const label = new Intl.DateTimeFormat('en', { month: 'short', day: '2-digit', year: 'numeric' }).format(date).toUpperCase();
    centeredText(ctx, label, 1698, `500 18px ${FONTS.ui}`, '#67213e');
  }
}
