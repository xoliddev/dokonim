/** Crisp vector QR (qrcode-generator → one SVG path, ink on paper, quiet zone included). */
import { useMemo } from 'react';
import qrcode from 'qrcode-generator';

export function QrCode({ text, size = 200, label }: { text: string; size?: number; label?: string }) {
  const { d, n } = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const count = qr.getModuleCount();
    let path = '';
    for (let r = 0; r < count; r++) {
      for (let c = 0; c < count; c++) {
        if (!qr.isDark(r, c)) continue;
        // merge horizontal runs into one rect for a smaller path
        let w = 1;
        while (c + w < count && qr.isDark(r, c + w)) w++;
        path += `M${c + 2} ${r + 2}h${w}v1h-${w}z`;
        c += w - 1;
      }
    }
    return { d: path, n: count + 4 };
  }, [text]);
  return (
    <svg className="sl-qr" width={size} height={size} viewBox={`0 0 ${n} ${n}`} role="img" aria-label={label ?? text} shapeRendering="crispEdges">
      <rect width={n} height={n} fill="#fff" />
      <path d={d} fill="#15120f" />
    </svg>
  );
}

/** Downloads the QR as a PNG (for printing on packaging / the shop window). */
export async function downloadQrPng(svg: SVGSVGElement | null, filename: string, px = 1024) {
  if (!svg) return;
  const xml = new XMLSerializer().serializeToString(svg);
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = px;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0, px, px);
  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/png');
  a.download = filename;
  a.click();
}
