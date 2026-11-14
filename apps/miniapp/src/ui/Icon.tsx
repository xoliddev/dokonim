/**
 * Icon set (§12.4): 24px grid, 1.75px stroke, rounded joins; `filled` for active tabs.
 *   <Icon name="cart" />  <Icon name="home" filled size={22} />
 */
const P: Record<string, string> = {
  home: 'M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  search: 'M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zM15.5 15.5 20 20',
  cart: 'M3 4h2.2l2.1 10.2a1.5 1.5 0 0 0 1.5 1.2h8.4a1.5 1.5 0 0 0 1.5-1.1L20.5 8H6.1M9.5 20a1 1 0 1 0 0-.01M17 20a1 1 0 1 0 0-.01',
  heart: 'M12 19.5s-7.5-4.4-7.5-10A4.3 4.3 0 0 1 12 6.8a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10-7.5 10z',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20a7.5 7.5 0 0 1 15 0z',
  back: 'M14.5 5 7.5 12l7 7',
  close: 'M6 6l12 12M18 6 6 18',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  check: 'M5 12.5 10 17l9-10',
  'chevron-right': 'M9.5 5.5 16 12l-6.5 6.5',
  'chevron-down': 'M5.5 9.5 12 16l6.5-6.5',
  store: 'M4 9.5 5.5 4h13L20 9.5M4 9.5h16M4 9.5a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0M5.5 12v8h13v-8M10 20v-4.5h4V20',
  box: 'M4 7.5 12 4l8 3.5v9L12 20l-8-3.5zM4 7.5 12 11l8-3.5M12 11v9',
  receipt: 'M6 3.5h12v17l-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3-2 1.3zM9 8h6M9 11.5h6M9 15h3.5',
  chart: 'M4 20h16M7 16.5V11M12 16.5V6.5M17 16.5v-3.5',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 13.5l1.3 1-1.8 3.1-1.6-.5a7 7 0 0 1-2 1.2L15 20h-3.6l-.3-1.7a7 7 0 0 1-2-1.2l-1.6.5-1.8-3.1 1.3-1a7 7 0 0 1 0-2.3l-1.3-1 1.8-3.1 1.6.5a7 7 0 0 1 2-1.2L11.4 4H15l.3 1.7a7 7 0 0 1 2 1.2l1.6-.5 1.8 3.1-1.3 1a7 7 0 0 1 0 2.3z',
  tag: 'M4 12.2V4.5h7.7l8.3 8.3-7.7 7.7zM8.2 8.3h.01',
  truck: 'M3 6.5h11v9.5H3zM14 9.5h3.8l3.2 3.4V16h-7M7 18.5a1.5 1.5 0 1 0 0-.01M17.5 18.5a1.5 1.5 0 1 0 0-.01',
  more: 'M5.5 12h.01M12 12h.01M18.5 12h.01',
  filter: 'M4 6h16M7 12h10M10 18h4',
  star: 'M12 4.5l2.3 4.7 5.2.8-3.8 3.6.9 5.1L12 16.3l-4.6 2.4.9-5.1-3.8-3.6 5.2-.8z',
  share: 'M12 15V4M7.5 8.5 12 4l4.5 4.5M5 13v6h14v-6',
  trash: 'M5 7h14M10 7V4.5h4V7M6.5 7l.8 12.5h9.4L17.5 7M10 11v5M14 11v5',
  edit: 'M5 19l1-4L15.5 5.5a2.1 2.1 0 0 1 3 3L9 18zM13.5 7.5l3 3',
  phone: 'M8 3.5h8a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1zM11 17.5h2',
  moon: 'M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4',
  refresh: 'M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4',
  globe: 'M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17zM3.5 12h17M12 3.5c2.2 2.3 3.3 5.1 3.3 8.5s-1.1 6.2-3.3 8.5c-2.2-2.3-3.3-5.1-3.3-8.5s1.1-6.2 3.3-8.5z',
  sparkle: 'M12 3.5l1.8 5.2 5.2 1.8-5.2 1.8L12 17.5l-1.8-5.2L5 10.5l5.2-1.8zM18.5 16l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z',
} as const satisfies Record<string, string>;

export type IconName = keyof typeof P;
export const ICON_NAMES = Object.keys(P) as IconName[];

export function Icon({ name, size = 24, filled, className, label }: { name: IconName; size?: number; filled?: boolean; className?: string; label?: string }) {
  return (
    <svg
      className={`icon ${className ?? ''}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      fillOpacity={filled ? 0.18 : undefined}
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <path d={P[name]} />
    </svg>
  );
}
