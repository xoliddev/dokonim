/**
 * Seller-only icons on the same 24px grid / 1.75px stroke as `ui/Icon` (kept here so the shared set stays small).
 * Falls back to the shared icon for any name it does not know.
 */
import { Icon } from '../../ui';

const P: Record<string, string> = {
  grip: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
  folder: 'M3.5 7.5a2 2 0 0 1 2-2h4l2 2.2h7a2 2 0 0 1 2 2v7.8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z',
  'folder-plus': 'M3.5 7.5a2 2 0 0 1 2-2h4l2 2.2h7a2 2 0 0 1 2 2v7.8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2zM12 11v5M9.5 13.5h5',
  copy: 'M8.5 8.5h10v11h-10zM5.5 15.5v-11h10',
  qr: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2M14 18h2v2M18 18h2v2h-2z',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  'eye-off': 'M4 4l16 16M10 6a9.7 9.7 0 0 1 2-.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3 3.6M6.5 7.6A16.6 16.6 0 0 0 2.5 12S6 18.5 12 18.5a9 9 0 0 0 4-.9M9.9 9.9a3 3 0 0 0 4.2 4.2',
  image: 'M4 5.5h16v13H4zM4 15.5l4.5-4.5 4 4 2.5-2.5 5 5M15.5 9.5h.01',
  upload: 'M12 15.5V4.5M7.5 9 12 4.5 16.5 9M4.5 15v4.5h15V15',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  up: 'M12 19V5M6 11l6-6 6 6',
  down: 'M12 5v14M6 13l6 6 6-6',
  move: 'M12 3.5v17M3.5 12h17M12 3.5 9.5 6M12 3.5 14.5 6M12 20.5 9.5 18M12 20.5l2.5-2.5M3.5 12 6 9.5M3.5 12 6 14.5M20.5 12 18 9.5M20.5 12 18 14.5',
  palette: 'M12 3.5a8.5 8.5 0 1 0 0 17c1.2 0 1.8-.8 1.8-1.7 0-1.3-1.1-1.6-1.1-2.7 0-.9.7-1.6 1.6-1.6h2.2a3.9 3.9 0 0 0 3.9-3.9c0-4-3.8-7.1-8.4-7.1zM7.5 12h.01M9.5 8h.01M14.5 8h.01',
  percent: 'M18.5 5.5l-13 13M7 9.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM17 19.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  layers: 'M12 4 3.5 8.5 12 13l8.5-4.5zM3.5 12.5 12 17l8.5-4.5M3.5 16.5 12 21l8.5-4.5',
  wallet: 'M4 7.5h14.5a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18zM4 7.5 15 4.5v3M16 13.5h.01',
  users: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.3a3.5 3.5 0 0 1 0 6.4M18 14.2a6.5 6.5 0 0 1 3.5 5.8',
  zap: 'M13 3.5 5 13.5h6l-1 7 8-10h-6z',
  external: 'M14 4.5h5.5V10M19.5 4.5 11 13M17 14v5.5H4.5V7H10',
  alert: 'M12 4 2.8 19.5h18.4zM12 10v4.5M12 17h.01',
  dots: 'M12 5.5h.01M12 12h.01M12 18.5h.01',
  'arrow-right': 'M5 12h14M13 6l6 6-6 6',
  undo: 'M9 14 4.5 9.5 9 5M4.5 9.5H15a4.5 4.5 0 0 1 0 9h-3',
  bolt: 'M13 3.5 5 13.5h6l-1 7 8-10h-6z',
  flag: 'M5 21V4.5M5 4.5h11l-2 4 2 4H5',
  lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  font: 'M4.5 19 10 5h1l5.5 14M7 14h7M18 19v-6.5M15.5 15.5h5',
  layout: 'M4 4.5h16v15H4zM4 9.5h16M10 9.5v10',
  map: 'M3.5 6.5 9 4l6 2.5 5.5-2.5v13.5L15 20l-6-2.5-5.5 2.5zM9 4v13.5M15 6.5V20',
  play: 'M7.5 5v14l11-7z',
};

export function SIcon({ name, size = 22, className, label }: { name: string; size?: number; className?: string; label?: string }) {
  const d = P[name];
  if (!d) return <Icon name={name} size={size} className={className} label={label} />;
  return (
    <svg
      className={`icon ${className ?? ''}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <path d={d} />
    </svg>
  );
}
