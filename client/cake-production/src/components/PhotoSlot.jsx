import { useRef, useState } from 'react';
import { isCameraSupported, openCameraStream, stopCameraStream, captureVideoFrame, resizeFileToBlob } from '../photos/capture';
import { enqueuePhoto } from '../photos/photoQueue';
import { mutations } from '../sync/syncEngine';

export default function PhotoSlot({ orderId, slot, photo, pendingCount, locked }) {
  const [streaming, setStreaming] = useState(false);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const fileInputRef = useRef(null);

  async function startCamera() {
    if (locked) return;
    if (!isCameraSupported()) {
      fileInputRef.current?.click();
      return;
    }
    try {
      const stream = await openCameraStream();
      streamRef.current = stream;
      setStreaming(true);
      // videoRef isn't mounted yet on this render; attach on next tick
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
        }
      });
    } catch {
      fileInputRef.current?.click(); // permission denied / no camera — fall back
    }
  }

  function closeCamera() {
    stopCameraStream(streamRef.current);
    streamRef.current = null;
    setStreaming(false);
  }

  async function shutter() {
    const blob = await captureVideoFrame(videoRef.current);
    closeCamera();
    if (blob) await enqueuePhoto({ cake_order_id: orderId, slot, blob, fileName: `slot${slot}.jpg` });
  }

  async function onFileSelected(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const blob = await resizeFileToBlob(file);
    if (blob) await enqueuePhoto({ cake_order_id: orderId, slot, blob, fileName: `slot${slot}.jpg` });
  }

  function removePhoto(e) {
    e.stopPropagation();
    if (locked) return;
    mutations.photoDelete(orderId, slot);
  }

  return (
    <>
      <div className={`cp-photo-slot ${locked ? 'locked' : ''}`} onClick={startCamera}>
        {photo ? (
          <>
            <img src={photo.image_url} alt={`Slot ${slot}`} />
            {!locked && <button className="cp-photo-slot-remove" onClick={removePhoto}>×</button>}
          </>
        ) : !locked ? (
          <div className="cp-photo-slot-label">📷<br />Slot {slot}</div>
        ) : null}
        {pendingCount > 0 && <span className="cp-photo-slot-badge">uploading…</span>}
      </div>

      <input ref={fileInputRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={onFileSelected} />

      {streaming && (
        <div className="cp-camera-overlay">
          <video ref={videoRef} playsInline muted />
          <div className="cp-camera-controls">
            <button className="cp-camera-shutter" onClick={shutter} aria-label="Capture" />
            <button className="cp-btn cp-btn--ghost" style={{ background: '#fff' }} onClick={closeCamera}>Cancel</button>
          </div>
        </div>
      )}
    </>
  );
}
