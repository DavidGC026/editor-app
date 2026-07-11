import { useEffect, useRef, useState } from 'react';
import { Image as ImageIcon } from 'lucide-react';

interface ImageViewerProps {
  /** Display name (file basename). */
  fileName: string;
  /** `data:<mime>;base64,...` URL produced by the main process. */
  dataUrl: string;
  /** Bytes on disk (used for the info bar). */
  fileSize?: number;
}

/**
 * Renders an image preview inside the editor area.
 *
 * Layout
 * ──────
 *  ┌───────────────────────────────────────────────────────────┐
 *  │                                                           │
 *  │                     [centered image]                      │
 *  │                                                           │
 *  ├───────────────────────────────────────────────────────────┤
 *  │  📷 filename.png   ·   640 × 480 px   ·   12.3 KB         │
 *  └───────────────────────────────────────────────────────────┘
 *
 * Behaviour
 * ─────────
 *  • The image is scaled to fit within the available area (`max-w-full
 *    max-h-full object-contain`) so the user can always see the whole picture.
 *  • Natural dimensions are read once the image decodes, and shown in the
 *    info bar alongside the file size.
 *  • On decode failure we show a friendly fallback ("No se puede mostrar la
 *    imagen") instead of a broken-image icon.
 *  • A subtle checkerboard background helps reveal transparency.
 */
export default function ImageViewer({ fileName, dataUrl, fileSize }: ImageViewerProps) {
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
  const [errored, setErrored] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);

  // Reset state when the data URL changes (switching between image tabs).
  useEffect(() => {
    setDimensions(null);
    setErrored(false);
  }, [dataUrl]);

  const handleLoad = () => {
    const img = imgRef.current;
    if (img) {
      setDimensions({ width: img.naturalWidth, height: img.naturalHeight });
    }
  };

  const handleError = () => {
    setErrored(true);
  };

  const formatBytes = (bytes: number | undefined): string => {
    if (bytes === undefined || bytes === null) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  // Subtle checkerboard background for transparent images. Encoded as a
  // data URL so we don't have to ship a separate asset file.
  const checkerboard =
    'repeating-conic-gradient(rgba(255,255,255,0.025) 0% 25%, transparent 0% 50%) 50% / 20px 20px';

  return (
    <div className="w-full h-full flex flex-col bg-forge-editor select-none">
      {/* Image surface */}
      <div
        className="flex-1 flex items-center justify-center overflow-auto p-6"
        style={{ background: `#2D2F38 ${checkerboard}` }}
      >
        {errored ? (
          <div className="flex flex-col items-center gap-2 text-forge-text/60">
            <ImageIcon size={48} className="opacity-50" />
            <p className="text-sm">No se puede mostrar la imagen.</p>
            <p className="text-xs opacity-70">{fileName}</p>
          </div>
        ) : (
          <img
            ref={imgRef}
            src={dataUrl}
            alt={fileName}
            onLoad={handleLoad}
            onError={handleError}
            className="max-w-full max-h-full object-contain shadow-lg"
            // Image rendering crisp-edges helps pixel art / icons stay sharp
            // when scaled — but only when the natural size is small (< 64px).
            style={{
              imageRendering:
                dimensions && dimensions.width < 64 && dimensions.height < 64
                  ? 'pixelated'
                  : 'auto',
            }}
            draggable={false}
          />
        )}
      </div>

      {/* Info bar */}
      <div
        className="h-[28px] flex items-center px-3 gap-3 text-[12px] border-t border-forge-border/40 flex-shrink-0"
        style={{ backgroundColor: '#27272F', color: '#A1A3AF' }}
      >
        <span className="flex items-center gap-1.5 text-forge-text">
          <ImageIcon size={12} className="text-forge-accent" />
          <span className="truncate max-w-[260px]" title={fileName}>
            {fileName}
          </span>
        </span>

        {dimensions && !errored && (
          <>
            <span className="text-forge-text/40">·</span>
            <span>
              {dimensions.width} × {dimensions.height} px
            </span>
          </>
        )}

        {fileSize !== undefined && (
          <>
            <span className="text-forge-text/40">·</span>
            <span>{formatBytes(fileSize)}</span>
          </>
        )}
      </div>
    </div>
  );
}
