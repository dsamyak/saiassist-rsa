import { useEffect, useRef, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { Alert, Button, Spinner } from './ui';

/** Renders a PDF into canvases with pdf.js so the preview looks identical on every device. */
export default function PdfViewer({ blob, className }: { blob: Blob | null; className?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');

  useEffect(() => {
    if (!blob) return;
    let cancelled = false;
    setState('loading');
    (async () => {
      try {
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
        const workerUrl = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default;
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
        const doc = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false }).promise;
        const el = host.current;
        if (!el || cancelled) return;
        el.replaceChildren();
        const width = el.clientWidth || 800;
        const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i);
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: (width / base.width) * dpr });
          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.style.width = '100%';
          canvas.className = 'block rounded-sm bg-white shadow ring-1 ring-slate-200';
          await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise;
          if (cancelled) return;
          el.appendChild(canvas);
        }
        setState('ready');
      } catch (e) {
        console.error(e);
        if (!cancelled) setState('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [blob]);

  const openRaw = () => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  return (
    <div className={className}>
      {state === 'loading' && (
        <div className="flex items-center justify-center gap-3 py-16 text-sm text-slate-500">
          <Spinner /> Rendering certificate…
        </div>
      )}
      {state === 'error' && (
        <Alert tone="warning" title="Preview could not be displayed in this browser">
          <Button size="sm" variant="secondary" icon={ExternalLink} onClick={openRaw} className="mt-2">
            Open PDF
          </Button>
        </Alert>
      )}
      <div ref={host} className="space-y-4" />
    </div>
  );
}
