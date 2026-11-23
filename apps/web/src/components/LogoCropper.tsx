import { Maximize, Minimize, Move } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { ErrorNote, Modal } from './ui';

/**
 * "Fit logo" (user request 2026-11-23): before a logo is saved, the admin places it in the exact
 * shape of the logo frame (160 × 52): zoom, drag, or start from Fit / Fill. What is inside the
 * frame is saved as a PNG three times the frame size, so it stays sharp; the rest is cut off.
 */
const OUT_W = 480;
const OUT_H = 156;

export function LogoCropper({ file, variant, onCancel, onDone }: {
  file: File; variant: 'light' | 'dark'; onCancel: () => void; onDone: (logo: File) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [zoom, setZoom] = useState(1); // 1 = the whole logo fits the frame
  const [offset, setOffset] = useState({ x: 0, y: 0 }); // in frame pixels
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    let live = true;
    image.onload = () => { if (live) { setError(null); setImg(image); } };
    image.onerror = () => { if (live) setError(new Error(t('This file could not be read as an image.'))); };
    image.src = url;
    return () => { live = false; URL.revokeObjectURL(url); };
  }, [file]);

  const iw = img?.naturalWidth || 300;
  const ih = img?.naturalHeight || 150;
  const fit = Math.min(OUT_W / iw, OUT_H / ih);
  const fill = Math.max(OUT_W / iw, OUT_H / ih);
  const scale = fit * zoom;

  useEffect(() => {
    const c = canvas.current?.getContext('2d');
    if (!c || !img) return;
    c.clearRect(0, 0, OUT_W, OUT_H);
    const w = iw * scale;
    const h = ih * scale;
    c.imageSmoothingQuality = 'high';
    c.drawImage(img, (OUT_W - w) / 2 + offset.x, (OUT_H - h) / 2 + offset.y, w, h);
  }, [img, scale, offset, iw, ih]);

  const ratio = () => { const r = canvas.current?.getBoundingClientRect(); return r ? OUT_W / r.width : 1; };
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d) return;
    const k = ratio();
    setOffset({ x: d.ox + (e.clientX - d.x) * k, y: d.oy + (e.clientY - d.y) * k });
  };
  const up = () => { drag.current = null; };
  const wheel = (e: React.WheelEvent) => setZoom((z) => Math.min(8, Math.max(0.2, z * (e.deltaY < 0 ? 1.08 : 1 / 1.08))));

  const save = () => canvas.current?.toBlob((blob) => {
    if (!blob) { setError(new Error(t('The logo could not be prepared.'))); return; }
    onDone(new File([blob], 'logo.png', { type: 'image/png' }));
  }, 'image/png');

  return (
    <Modal title={t('Fit logo')} onClose={onCancel} wide
      footer={<><button onClick={onCancel}>{t('Cancel')}</button><button className="primary" disabled={!img} onClick={save}>{t('Save logo')}</button></>}>
      <div className="stack">
        <ErrorNote error={error} />
        <p className="small secondary" style={{ margin: 0 }}>
          {t('Drag the logo to move it, and zoom with the slider or the mouse wheel. Only what is inside the frame is kept.')}
        </p>
        <div className={`crop-stage ${variant}`}>
          <canvas ref={canvas} width={OUT_W} height={OUT_H} className="crop-canvas" aria-label={t('Logo in its frame')}
            onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onWheel={wheel} />
        </div>
        <div className="row crop-tools">
          <label className="grow crop-zoom">{t('Zoom')}
            <input type="range" min={0.2} max={8} step={0.01} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
            <span className="small muted">{Math.round(zoom * 100)}%</span>
          </label>
          <button type="button" className="sm" onClick={() => { setZoom(1); setOffset({ x: 0, y: 0 }); }}><Minimize className="ico" aria-hidden /> {t('Fit')}</button>
          <button type="button" className="sm" onClick={() => { setZoom(fill / fit); setOffset({ x: 0, y: 0 }); }}><Maximize className="ico" aria-hidden /> {t('Fill')}</button>
          <button type="button" className="sm ghost" onClick={() => setOffset({ x: 0, y: 0 })}><Move className="ico" aria-hidden /> {t('Centre')}</button>
        </div>
      </div>
    </Modal>
  );
}
