import { useRef, useState } from 'react';
import { loadImageFile, type LoadedImage } from '../core/imageMeta.ts';

export function Dropzone({ onLoad }: { onLoad: (img: LoadedImage) => void }) {
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const take = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      onLoad(await loadImageFile(file));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that file.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`dropzone${over ? ' over' : ''}`}
      onClick={() => input.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        void take(e.dataTransfer.files);
      }}
    >
      <div>
        <div className="glyph" aria-hidden>
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
        </div>
        <h2>{busy ? 'Decoding…' : 'Drop an image to tile it'}</h2>
        <p>
          PNG, JPEG, WEBP or AVIF. Upscale it first if you are going big — TileCraft slices and
          places pixels, it cannot invent them.
        </p>
        <ul>
          <li>Runs entirely in this tab</li>
          <li>Nothing is uploaded anywhere</li>
          <li>Export PNG · ZIP · print-ready PDF</li>
        </ul>
        {error && <div className="err">{error}</div>}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/avif"
        hidden
        onChange={(e) => void take(e.target.files)}
      />
    </div>
  );
}
