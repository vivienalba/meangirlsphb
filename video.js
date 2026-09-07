import { FONTS, wrapText } from './core.js';

export const VIDEO_LIMIT_MS = 30_000;
export const VIDEO_FRAME = Object.freeze({ width: 720, height: 870, x: 42, y: 174, photoWidth: 636, photoHeight: 477 });

export function drawVideoFrame(canvas, photo = null, quote = '', date = null, artwork = null) {
  const ctx = canvas.getContext('2d');
  const frame = VIDEO_FRAME;
  ctx.fillStyle = '#f6a9cb';
  ctx.fillRect(0, 0, frame.width, frame.height);
  ctx.strokeStyle = '#b92965';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(19, 19, frame.width - 38, frame.height - 38);
  if (artwork) ctx.drawImage(artwork, frame.x, 30, frame.photoWidth, frame.photoWidth * artwork.height / artwork.width);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#67213e';
  ctx.font = `500 18px ${FONTS.ui}`;
  ctx.fillText('P H O T O B O O T H', frame.width / 2, 150);
  ctx.fillStyle = '#fff7fa';
  ctx.fillRect(frame.x - 5, frame.y - 5, frame.photoWidth + 10, frame.photoHeight + 10);
  if (photo) ctx.drawImage(photo, frame.x, frame.y, frame.photoWidth, frame.photoHeight);
  else {
    ctx.fillStyle = '#e5b9cc';
    ctx.fillRect(frame.x, frame.y, frame.photoWidth, frame.photoHeight);
    ctx.fillStyle = '#88536b';
    ctx.font = `italic 500 58px ${FONTS.editorial}`;
    ctx.fillText('Your little movie', frame.width / 2, 411);
    ctx.font = `500 18px ${FONTS.ui}`;
    ctx.fillText('ONE FRAME. UP TO 30 SECONDS.', frame.width / 2, 455);
  }
  ctx.beginPath();
  ctx.moveTo(302, 686);
  ctx.lineTo(418, 686);
  ctx.stroke();
  const text = quote ? `“${quote}”` : 'One iconic line. Just for you.';
  let size = 39;
  ctx.font = `italic 600 ${size}px ${FONTS.editorial}`;
  let lines = wrapText(ctx, text, 584);
  while (lines.length > 2 && size > 25) {
    size -= 2;
    ctx.font = `italic 600 ${size}px ${FONTS.editorial}`;
    lines = wrapText(ctx, text, 584);
  }
  ctx.fillStyle = '#2c1020';
  const lineHeight = size * 1.2;
  const firstBaseline = 753 - (lines.length - 1) * lineHeight / 2;
  lines.forEach((line, index) => ctx.fillText(line, frame.width / 2, firstBaseline + index * lineHeight));
  if (date) {
    ctx.fillStyle = '#67213e';
    ctx.font = `500 17px ${FONTS.ui}`;
    ctx.fillText(new Intl.DateTimeFormat('en', { month: 'short', day: '2-digit', year: 'numeric' }).format(date).toUpperCase(), frame.width / 2, 828);
  }
}

export function supportsVideoRecording(canvas, Recorder = globalThis.MediaRecorder) {
  return typeof Recorder === 'function' && typeof canvas.captureStream === 'function';
}

export function recordingMimeType(withAudio, Recorder = globalThis.MediaRecorder) {
  const opus = withAudio ? ',opus' : '';
  return [
    'video/mp4',
    `video/webm;codecs=vp9${opus}`,
    `video/webm;codecs=vp8${opus}`,
    'video/webm'
  ].find(type => Recorder.isTypeSupported(type)) || '';
}

// Record the composed canvas so the downloaded file includes the filter,
// single pink frame and movie line. The raw camera stream is never recorded.
export function startCanvasRecording(canvas, { audioTracks = [], onProgress = () => {} } = {}) {
  if (!supportsVideoRecording(canvas)) throw new Error('Video recording isn’t available in this browser. Try the booth in Safari, Chrome or Edge.');
  const output = canvas.captureStream(25);
  let recorder;
  try {
    audioTracks.forEach(track => output.addTrack(track.clone()));
    const mimeType = recordingMimeType(audioTracks.length > 0);
    recorder = new MediaRecorder(output, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: 4_000_000 });
  } catch (error) {
    output.getTracks().forEach(track => track.stop());
    throw error;
  }
  const chunks = [];
  let startedAt = 0;
  let stoppedAt = null;
  let stopping = false;
  let settled = false;
  let reason = 'manual';
  let failure = null;
  let deadline;
  let ticker;
  let resolveResult;
  let rejectResult;
  const result = new Promise((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
  const elapsed = () => Math.min(VIDEO_LIMIT_MS, Math.max(0, (stoppedAt ?? performance.now()) - startedAt));
  const clearTimers = () => { clearTimeout(deadline); clearInterval(ticker); };
  const cleanup = () => { clearTimers(); output.getTracks().forEach(track => track.stop()); };
  const stop = (why = 'manual') => {
    if (stopping || settled) return;
    reason = why;
    stoppedAt = performance.now();
    stopping = true;
    clearTimers();
    if (recorder.state !== 'inactive') recorder.stop();
  };
  const checkTime = () => {
    if (stopping || settled) return;
    onProgress(elapsed());
    if (performance.now() - startedAt >= VIDEO_LIMIT_MS) stop('limit');
  };
  recorder.addEventListener('dataavailable', event => { if (event.data.size) chunks.push(event.data); });
  recorder.addEventListener('error', event => {
    failure = event.error || new Error('The video couldn’t be saved. Please try recording again.');
    stop('error');
    if (!settled) { settled = true; cleanup(); rejectResult(failure); }
  });
  recorder.addEventListener('stop', () => {
    if (settled) return;
    settled = true;
    stoppedAt ??= performance.now();
    cleanup();
    const mimeType = recorder.mimeType || chunks[0]?.type || 'video/webm';
    const blob = new Blob(chunks, { type: mimeType });
    if (failure || !blob.size) rejectResult(failure || new Error('No video was captured. Please record again.'));
    else resolveResult({ blob, extension: mimeType.includes('mp4') ? 'mp4' : 'webm', durationMs: elapsed(), reason });
  }, { once: true });
  try {
    startedAt = performance.now();
    recorder.start(250);
    deadline = setTimeout(() => stop('limit'), VIDEO_LIMIT_MS);
    ticker = setInterval(checkTime, 100);
    onProgress(0);
  } catch (error) {
    cleanup();
    throw error;
  }
  return { result, stop, checkTime, get active() { return !stopping && !settled; } };
}
