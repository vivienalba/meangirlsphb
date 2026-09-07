import { STRIP, createQuotePicker, coverCrop, drawStrip } from './core.js';
import { FILTERS, findFilter, applyPhotoFilter } from './filters.js';
import { loadReferenceWordmark, loadFetchReferenceLogo } from './wordmark.js';
import { VIDEO_LIMIT_MS, drawVideoFrame, supportsVideoRecording, startCanvasRecording } from './video.js';

const $ = id => document.getElementById(id);
const video = $('camera');
const canvas = $('strip');
const liveCanvas = $('live-preview');
const liveContext = liveCanvas.getContext('2d', { willReadFrequently: true });
const captureButton = $('capture-button');
const videoCanvas = $('video-frame');
const videoPlayer = $('video-result');
const nextQuote = createQuotePicker();
let stream = null;
let busy = false;
let connecting = false;
let operation = 0;
let photos = [];
let quote = '';
let capturedAt = null;
let exportData = '';
let filterId = 'original';
let processedPhotos = [];
let processedFilter = filterId;
let previewRequest = 0;
let lastPreviewTime = 0;
let exporting = false;
let exportRevision = 0;
let movieArtwork = null;
let mode = 'photo';
let videoPhase = 'idle';
let recording = null;
let videoDraft = null;
let videoResult = null;
let microphoneStream = null;

const announce = message => { $('announcer').textContent = message; };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const isLive = () => Boolean(stream?.getVideoTracks().some(track => track.readyState === 'live'));

const fontsReady = document.fonts ? Promise.allSettled([
  document.fonts.load('400 58px Jost', 'GIRLS'),
  document.fonts.load('700 58px Jost', 'MEAN'),
  document.fonts.load('italic 600 46px "Booth Editorial"')
]) : Promise.resolve();

const wordmarkReady = loadReferenceWordmark().then(artwork => {
  movieArtwork = artwork;
  const heading = $('movie-wordmark');
  heading.getContext('2d').drawImage(artwork, 0, 0);
  if (!busy && !exporting && !exportData) render();
});
// Keep a failed asset request handled while preserving the export-time error.
wordmarkReady.catch(error => announce(error.message));

loadFetchReferenceLogo().then(artwork => {
  $('so-fetch-logo').getContext('2d').drawImage(artwork, 0, 0);
}).catch(error => announce(error.message));

function drawMirroredVideo(target, ctx) {
  const crop = coverCrop(video.videoWidth, video.videoHeight, target.width, target.height);
  ctx.save();
  ctx.translate(target.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, crop.x, crop.y, crop.width, crop.height, 0, 0, target.width, target.height);
  ctx.restore();
}

function paintPreview(time = 0) {
  if (!isLive()) return;
  if (!document.hidden && video.readyState >= 2 && time - lastPreviewTime >= 40) {
    recording?.checkTime();
    drawMirroredVideo(liveCanvas, liveContext);
    applyPhotoFilter(liveContext, liveCanvas.width, liveCanvas.height, filterId);
    if (mode === 'video' && (!videoResult || busy) && videoPhase !== 'saving' && (!recording || recording.active)) renderVideo(liveCanvas);
    lastPreviewTime = time;
  }
  previewRequest = requestAnimationFrame(paintPreview);
}

function startPreview() {
  cancelAnimationFrame(previewRequest);
  lastPreviewTime = -Infinity;
  paintPreview();
}

function displayedPhotos() {
  if (processedFilter !== filterId) { processedPhotos = []; processedFilter = filterId; }
  return photos.map((photo, index) => {
    if (filterId === 'original') return photo;
    if (processedPhotos[index]?.source === photo) return processedPhotos[index].image;
    const image = document.createElement('canvas');
    image.width = photo.width;
    image.height = photo.height;
    const ctx = image.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(photo, 0, 0);
    applyPhotoFilter(ctx, image.width, image.height, filterId);
    processedPhotos[index] = { source: photo, image };
    return image;
  });
}

async function refreshExport() {
  const revision = ++exportRevision;
  const token = operation;
  exporting = true;
  exportData = '';
  updateControls();
  try {
    await Promise.all([fontsReady, wordmarkReady]);
    if (token !== operation || revision !== exportRevision) return false;
    render();
    const data = canvas.toDataURL('image/png');
    $('print-image').src = data;
    if ($('print-image').decode) await $('print-image').decode();
    if (token !== operation || revision !== exportRevision) return false;
    exportData = data;
    return true;
  } finally {
    if (revision === exportRevision) { exporting = false; updateControls(); }
  }
}

function mountFilters() {
  FILTERS.forEach((filter, index) => {
    const label = document.createElement('label');
    label.className = 'filter-option-label';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'photo-filter';
    input.value = filter.id;
    input.checked = filter.id === filterId;
    const option = document.createElement('span');
    option.className = 'filter-option';
    option.dataset.filter = filter.id;
    const swatch = document.createElement('span');
    swatch.className = 'filter-swatch';
    swatch.textContent = String(index + 1).padStart(2, '0');
    swatch.setAttribute('aria-hidden', 'true');
    const name = document.createElement('span');
    name.textContent = filter.name;
    option.append(swatch, name);
    label.append(input, option);
    $('filter-options').append(label);
  });
}

async function selectFilter(nextId) {
  if (busy || exporting || nextId === filterId) return;
  filterId = findFilter(nextId).id;
  const filter = findFilter(filterId);
  $('filter-description').textContent = filter.description;
  liveCanvas.setAttribute('aria-label', `Live mirrored camera preview with the ${filter.name} filter`);
  lastPreviewTime = -Infinity;
  try {
    render();
    if (quote && photos.length === STRIP.count) {
      if (!await refreshExport()) return;
    }
    if (mode === 'video') {
      $('capture-note').textContent = videoResult ? `${filter.name} selected for your next video. Your saved clip keeps its original filter.` : 'Your chosen filter will be included in the saved video.';
    } else if (exportData) $('capture-note').textContent = `${filter.name} applied. Your download and print are ready.`;
    announce(mode === 'video' ? $('capture-note').textContent : `${filter.name} filter applied${exportData ? ' to all three photos and your download' : ''}.`);
  } catch {
    exportData = '';
    $('capture-note').textContent = 'The filter couldn’t be saved. Choose a filter again to retry.';
    announce($('capture-note').textContent);
    updateControls();
  }
}

function updateControls() {
  const live = isLive();
  const isVideo = mode === 'video';
  const isRecording = isVideo && videoPhase === 'recording';
  const hasResult = isVideo ? Boolean(videoResult) : Boolean(exportData);
  captureButton.disabled = (busy && !isRecording) || connecting || exporting;
  captureButton.querySelector('span').textContent = connecting ? 'Opening camera…' : isRecording ? 'Stop recording' : busy ? (isVideo ? (videoPhase === 'saving' ? 'Saving your video…' : 'Getting ready…') : 'Making your strip…') : live ? (isVideo ? (videoResult ? 'Record another video' : 'Record video') : (exportData ? 'Take another strip' : 'Take 3 photos')) : 'Enable camera';
  captureButton.classList.toggle('is-recording', isRecording);
  $('stop-button').hidden = !live || busy || exporting;
  $('cancel-button').hidden = !busy || (isVideo && (videoPhase === 'recording' || videoPhase === 'saving'));
  $('download-button').disabled = !hasResult || busy || exporting;
  $('download-label').textContent = isVideo ? 'Download video' : 'Download strip';
  $('print-button').hidden = isVideo;
  $('print-button').disabled = !exportData || busy || exporting;
  $('filter-controls').disabled = busy || exporting;
  $('mode-controls').disabled = busy || connecting || exporting;
  $('microphone-option').hidden = !isVideo;
  $('microphone').disabled = busy || connecting || exporting;
  $('camera-status').textContent = connecting ? 'Connecting…' : isRecording ? 'Recording' : busy ? (isVideo ? 'Preparing video' : 'Capturing') : live ? 'Camera on' : 'Camera off';
  $('camera-status').classList.toggle('live', live);
  $('frame-label').textContent = isVideo ? 'ONE FRAME · 30 SEC MAX' : '3 × YOU';
  $('strip-stage').classList.toggle('video-mode', isVideo);
  canvas.hidden = isVideo;
  videoCanvas.hidden = !isVideo || (Boolean(videoResult) && !busy);
  videoPlayer.hidden = !isVideo || !videoResult || busy;
  $('result-details').textContent = isVideo ? (videoResult && !busy ? `${Math.max(1, Math.round(videoResult.durationMs / 1000))} sec · ${findFilter(videoResult.filterId).name} · ${videoResult.withAudio ? 'With sound' : 'No sound'}` : 'One frame · Up to 30 seconds · One line') : '2 × 6 in · Three photos · One line';
}

function render() {
  drawStrip(canvas, displayedPhotos(), quote, capturedAt, movieArtwork);
  canvas.setAttribute('aria-label', `${photos.length} of 3 photos captured. Filter: ${findFilter(filterId).name}.${quote ? ` Movie line: ${quote}` : ' One movie line will be added when your strip is complete.'}`);
  if (!recording) renderVideo();
}

function renderVideo(frame = null) {
  drawVideoFrame(videoCanvas, frame, videoDraft?.quote || '', videoDraft?.date || null, movieArtwork);
}

function restingNote() {
  return mode === 'video' ? (videoResult ? 'Your video is ready to play and save. Choose a filter for your next take.' : 'A 3-second countdown, then up to 30 seconds. Stop whenever you like.') : (exportData ? 'Your finished strip is ready to save.' : 'A 3-second countdown before each photo.');
}

function selectMode(nextMode) {
  if (busy || connecting || exporting || !['photo', 'video'].includes(nextMode)) return;
  mode = nextMode;
  videoPlayer.pause();
  $('strip-caption').textContent = mode === 'video' ? (videoResult ? 'A little movie. A very big mood.' : 'Your movie line is a surprise.') : (exportData ? 'Three photos. One perfect keepsake.' : 'Your line is a surprise.');
  $('capture-note').textContent = restingNote();
  render();
  updateControls();
  announce(mode === 'video' ? 'Video mode. One frame, up to 30 seconds. Your filter and movie line are saved in the video.' : 'Photo strip mode. Three photos and one movie line.');
}

function resetStrip() {
  photos = [];
  processedPhotos = [];
  quote = '';
  capturedAt = null;
  exportData = '';
  exportRevision++;
  exporting = false;
  $('print-image').removeAttribute('src');
  $('strip-stage').classList.remove('complete');
  $('strip-caption').textContent = 'Your line is a surprise.';
  render();
}

function stopCamera() {
  if (recording) finishRecording('camera');
  else {
    if (busy) cancelCapture('Camera turned off. Start again whenever you’re ready.');
    operation++;
  }
  cancelAnimationFrame(previewRequest);
  if (stream) stream.getTracks().forEach(track => track.stop());
  stream = null;
  video.srcObject = null;
  connecting = false;
  $('viewfinder').classList.remove('has-camera');
  $('camera-empty').hidden = false;
  $('countdown').hidden = true;
  $('shot-prompt').hidden = true;
  $('empty-title').textContent = 'Ready for your close-up?';
  $('empty-description').textContent = 'Enable your camera to take photos or record a little movie.';
  $('new-tab').hidden = true;
  if (mode === 'photo' && photos.length < STRIP.count) resetStrip();
  if (!busy) $('capture-note').textContent = restingNote();
  updateControls();
}

async function enableCamera() {
  if (connecting || isLive()) return;
  connecting = true;
  const token = ++operation;
  $('viewfinder').classList.remove('camera-error');
  $('new-tab').hidden = true;
  $('empty-title').textContent = 'One little permission…';
  $('empty-description').textContent = 'Allow camera access in your browser to step into the booth.';
  updateControls();
  try {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('Camera unavailable'), { name: 'UnsupportedError' });
    const openedStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 }, aspectRatio: { ideal: 4 / 3 } } });
    if (token !== operation) { openedStream.getTracks().forEach(track => track.stop()); return; }
    stream = openedStream;
    video.srcObject = stream;
    await video.play();
    const deadline = Date.now() + 10000;
    while ((!video.videoWidth || video.readyState < 2) && Date.now() < deadline) {
      if (token !== operation) return;
      await wait(80);
    }
    if (token !== operation) return;
    if (!video.videoWidth || video.readyState < 2) throw new Error('No camera frames received');
    for (const track of stream.getVideoTracks()) track.addEventListener('ended', () => {
      if (stream !== openedStream) return;
      stopCamera();
      $('empty-title').textContent = 'Your camera disconnected.';
      $('empty-description').textContent = 'Reconnect your camera, then try again.';
      announce('Camera disconnected. Enable the camera to try again.');
    }, { once: true });
    $('camera-empty').hidden = true;
    startPreview();
    $('viewfinder').classList.add('has-camera');
    $('capture-note').textContent = restingNote();
    announce(mode === 'video' ? 'Camera ready. Select Record video when you are ready.' : 'Camera ready. Select Take 3 photos when you are ready.');
  } catch (error) {
    if (token !== operation) return;
    if (stream) stream.getTracks().forEach(track => track.stop());
    cancelAnimationFrame(previewRequest);
    stream = null;
    video.srcObject = null;
    $('viewfinder').classList.remove('has-camera');
    $('viewfinder').classList.add('camera-error');
    $('camera-empty').hidden = false;
    $('empty-title').textContent = 'Let’s get your camera working.';
    const messages = {
      NotAllowedError: 'Camera access is blocked. Allow it in your browser’s site settings, then try again.',
      SecurityError: 'Open the booth in a new tab and allow camera access in your browser.',
      NotFoundError: 'No camera was found. Connect a webcam, or open the booth on your phone.',
      NotReadableError: 'Another app may be using your camera. Close it, then try again.',
      OverconstrainedError: 'This camera could not start. Try another camera or open the booth on your phone.',
      UnsupportedError: 'Open this booth in a new tab using Safari, Chrome or Edge to use your camera.'
    };
    const message = messages[error.name] || 'The camera couldn’t start. Check your camera connection and try again.';
    $('empty-description').textContent = message;
    $('new-tab').hidden = false;
    announce(message);
  } finally {
    if (token === operation) { connecting = false; updateControls(); }
  }
}

function takeFrame() {
  if (!isLive() || video.readyState < 2) throw new Error('The camera paused. Please try again.');
  const frame = document.createElement('canvas');
  frame.width = STRIP.photoWidth * 2;
  frame.height = STRIP.photoHeight * 2;
  const ctx = frame.getContext('2d');
  if (!ctx) throw new Error('Your browser could not capture a photo.');
  drawMirroredVideo(frame, ctx);
  return frame;
}

async function captureStrip() {
  if (!isLive() || busy || connecting || exporting) return;
  const token = ++operation;
  resetStrip();
  busy = true;
  updateControls();
  $('shot-prompt').hidden = false;
  $('capture-note').textContent = 'Keep this tab open while the camera counts down.';
  try {
    for (let shot = 0; shot < STRIP.count; shot++) {
      if (token !== operation) return;
      $('shot-prompt').textContent = `Photo ${shot + 1} of 3`;
      for (let count = 3; count >= 1; count--) {
        if (token !== operation) return;
        const counter = $('countdown');
        counter.hidden = false;
        counter.textContent = count;
        counter.classList.remove('pulse');
        void counter.offsetWidth;
        counter.classList.add('pulse');
        announce(`Photo ${shot + 1} of 3 in ${count}.`);
        await wait(1000);
      }
      if (token !== operation) return;
      $('countdown').hidden = true;
      photos.push(takeFrame());
      $('camera-flash').classList.remove('flash');
      void $('camera-flash').offsetWidth;
      $('camera-flash').classList.add('flash');
      render();
      if (shot < STRIP.count - 1) {
        $('shot-prompt').textContent = 'Switch up your pose';
        await wait(800);
      }
    }
    if (token !== operation) return;
    quote = nextQuote();
    capturedAt = new Date();
    if (!await refreshExport()) return;
    if (token !== operation) return;
    $('strip-stage').classList.add('complete');
    $('strip-caption').textContent = 'Three photos. One perfect keepsake.';
    $('capture-note').textContent = 'Your strip is ready. Try a filter, then save before taking another.';
    announce(`Your three-photo strip is ready. Your line is: ${quote} Download or print your strip.`);
  } catch (error) {
    if (token !== operation) return;
    resetStrip();
    $('capture-note').textContent = error.message || 'Something interrupted the photos. Please try again.';
    announce($('capture-note').textContent);
  } finally {
    if (token === operation) {
      busy = false;
      $('countdown').hidden = true;
      $('shot-prompt').hidden = true;
      updateControls();
    }
  }
}

function stopMicrophone() {
  microphoneStream?.getTracks().forEach(track => track.stop());
  microphoneStream = null;
}

function finishRecording(reason = 'manual') {
  if (!recording) return;
  videoPhase = 'saving';
  recording.stop(reason);
  $('recording-clock').hidden = true;
  $('capture-note').textContent = 'Saving your video with its filter, frame and movie line…';
  updateControls();
}

async function captureVideo() {
  if (!isLive() || busy || connecting || exporting) return;
  if (!supportsVideoRecording(videoCanvas)) {
    $('capture-note').textContent = 'Video recording isn’t available in this browser. Open the booth in Safari, Chrome or Edge.';
    announce($('capture-note').textContent);
    return;
  }
  const token = ++operation;
  busy = true;
  videoPhase = 'preparing';
  videoPlayer.pause();
  $('strip-stage').classList.remove('complete');
  updateControls();
  try {
    await Promise.all([fontsReady, wordmarkReady]);
    if (token !== operation) return;
    if ($('microphone').checked) {
      $('capture-note').textContent = 'Allow microphone access to include sound in your video.';
      const openedMicrophone = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      if (token !== operation) { openedMicrophone.getTracks().forEach(track => track.stop()); return; }
      microphoneStream = openedMicrophone;
    }
    videoPhase = 'countdown';
    $('shot-prompt').hidden = false;
    $('shot-prompt').textContent = 'Your little movie';
    $('capture-note').textContent = 'Keep this tab open. Your recording will stop at 30 seconds.';
    for (let count = 3; count >= 1; count--) {
      if (token !== operation) return;
      $('countdown').hidden = false;
      $('countdown').textContent = count;
      $('countdown').classList.remove('pulse');
      void $('countdown').offsetWidth;
      $('countdown').classList.add('pulse');
      announce(`Video starts in ${count}.`);
      await wait(1000);
    }
    if (token !== operation) return;
    if (!isLive() || video.readyState < 2) throw new Error('The camera paused. Please try recording again.');
    videoDraft = { quote: nextQuote(), date: new Date(), filterId };
    drawMirroredVideo(liveCanvas, liveContext);
    applyPhotoFilter(liveContext, liveCanvas.width, liveCanvas.height, filterId);
    renderVideo(liveCanvas);
    recording = startCanvasRecording(videoCanvas, {
      audioTracks: microphoneStream?.getAudioTracks() || [],
      onProgress: elapsed => {
        const seconds = String(Math.floor(elapsed / 1000)).padStart(2, '0');
        $('recording-time').textContent = `00:${seconds} / 00:${VIDEO_LIMIT_MS / 1000}`;
      }
    });
    videoPhase = 'recording';
    $('countdown').hidden = true;
    $('shot-prompt').hidden = true;
    $('recording-clock').hidden = false;
    $('capture-note').textContent = 'Recording. Stop whenever you like — 30 seconds is the maximum.';
    updateControls();
    announce('Recording started. Select Stop recording to finish early. Recording stops automatically at 30 seconds.');
    const result = await recording.result;
    if (token !== operation) return;
    const previousUrl = videoResult?.url;
    videoResult = { ...result, url: URL.createObjectURL(result.blob), filterId: videoDraft.filterId, date: videoDraft.date, quote: videoDraft.quote, withAudio: Boolean(microphoneStream?.getAudioTracks().length) };
    videoPlayer.poster = videoCanvas.toDataURL('image/png');
    videoPlayer.src = videoResult.url;
    videoPlayer.load();
    if (previousUrl) URL.revokeObjectURL(previousUrl);
    $('strip-stage').classList.add('complete');
    $('strip-caption').textContent = 'A little movie. A very big mood.';
    const finish = result.reason === 'limit' ? '30 seconds — that’s a wrap.' : result.reason === 'hidden' ? 'Recording stopped when you left the tab.' : result.reason === 'camera' ? 'The camera disconnected, so your recording ended.' : 'That’s a wrap.';
    $('capture-note').textContent = `${finish} Your video is ready to play and save.`;
    announce(`${finish} Your single-frame video is ready. Filter: ${findFilter(videoResult.filterId).name}. Your line is: ${videoResult.quote}`);
  } catch (error) {
    if (token !== operation) return;
    $('capture-note').textContent = error.name === 'NotAllowedError' ? 'Microphone access is blocked. Allow it in your browser settings, or uncheck Include sound and record again.' : error.name === 'NotFoundError' ? 'No microphone was found. Uncheck Include sound to record without it.' : (error.message || 'The video couldn’t be saved. Please try recording again.');
    announce($('capture-note').textContent);
  } finally {
    if (token === operation) {
      recording = null;
      videoDraft = null;
      stopMicrophone();
      videoPhase = 'idle';
      busy = false;
      $('countdown').hidden = true;
      $('shot-prompt').hidden = true;
      $('recording-clock').hidden = true;
      updateControls();
    }
  }
}

function cancelCapture(message = 'Paused. Start again whenever you’re ready.') {
  if (!busy) return;
  operation++;
  busy = false;
  $('countdown').hidden = true;
  $('shot-prompt').hidden = true;
  if (mode === 'video') {
    recording?.stop('discard');
    recording = null;
    videoPhase = 'idle';
    videoDraft = null;
    stopMicrophone();
    $('recording-clock').hidden = true;
    renderVideo();
  } else resetStrip();
  $('capture-note').textContent = message;
  announce(message);
  updateControls();
}

captureButton.addEventListener('click', () => {
  if (recording) finishRecording();
  else if (!isLive()) enableCamera();
  else if (mode === 'video') captureVideo();
  else captureStrip();
});
$('stop-button').addEventListener('click', () => { stopCamera(); announce('Camera turned off.'); });
$('cancel-button').addEventListener('click', () => cancelCapture());
$('mode-controls').addEventListener('change', event => {
  if (event.target.matches('input[name="booth-mode"]')) selectMode(event.target.value);
});
$('filter-options').addEventListener('change', event => {
  if (event.target.matches('input[name="photo-filter"]')) selectFilter(event.target.value);
});
$('download-button').addEventListener('click', () => {
  if (mode === 'video') {
    if (!videoResult || busy || exporting) return;
    const link = document.createElement('a');
    link.href = videoResult.url;
    link.download = `so-fetch-video-${videoResult.filterId}-${videoResult.date.toISOString().replace(/[:.]/g, '-')}.${videoResult.extension}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    $('capture-note').textContent = 'Your video includes the filter, pink frame and movie line. On a phone, save it from the download or video preview.';
    announce('Your video is ready to save.');
    return;
  }
  if (!exportData || busy || exporting) return;
  const link = document.createElement('a');
  link.href = exportData;
  link.download = `so-fetch-${filterId}-${capturedAt.toISOString().replace(/[:.]/g, '-')}.png`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  $('capture-note').textContent = 'Save the PNG to keep your strip. On a phone, you may need to save it from the image preview.';
  announce('Your photo strip is ready to save as a PNG.');
});
$('print-button').addEventListener('click', () => {
  if (mode !== 'photo' || !exportData || busy || exporting || photos.length !== STRIP.count) return;
  $('capture-note').textContent = 'Print at 100% / actual size for a 2 × 6 in strip. Turn off page headers and footers.';
  window.print();
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden || !busy) return;
  if (recording) finishRecording('hidden');
  else cancelCapture('The countdown paused when you left the tab. Start again when you’re ready.');
});
window.addEventListener('pagehide', () => {
  if (busy) cancelCapture();
  stopCamera();
  videoPlayer.pause();
});
mountFilters();
render();
updateControls();
fontsReady.then(() => { if (!busy && !exporting && !exportData) render(); });
