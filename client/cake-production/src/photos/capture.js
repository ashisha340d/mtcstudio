// Camera capture: getUserMedia + canvas snapshot is the primary path (works
// on installed desktop/tablet/mobile PWAs); <input capture> is the fallback
// for browsers/contexts where getUserMedia is unavailable or denied.
const MAX_DIM = 1600;
const JPEG_QUALITY = 0.8;

export function isCameraSupported() {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}

export async function openCameraStream() {
  return navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
}

export function stopCameraStream(stream) {
  stream?.getTracks().forEach(t => t.stop());
}

export async function captureVideoFrame(videoEl) {
  return resizeToBlob(videoEl, videoEl.videoWidth, videoEl.videoHeight);
}

// Used for the <input capture> fallback path — same resize/compress pipeline
// so both capture methods produce equivalent output.
export async function resizeFileToBlob(file) {
  const bitmap = await createImageBitmap(file);
  return resizeToBlob(bitmap, bitmap.width, bitmap.height);
}

function resizeToBlob(source, srcW, srcH) {
  const scale = Math.min(1, MAX_DIM / Math.max(srcW, srcH));
  const w = Math.round(srcW * scale);
  const h = Math.round(srcH * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(source, 0, 0, w, h);
  return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
}
