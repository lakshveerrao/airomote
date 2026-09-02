import { type ButtonHTMLAttributes, type ReactNode, useEffect } from 'react';
import { Link } from 'react-router-dom';
import type { ActivityDefinition } from '@aero/activity-engine';
import './ui.css';

// ---------- Icons (inline, 24px grid, stroke) ----------
type IconProps = { size?: number; className?: string; strokeWidth?: number };
const I = ({ size = 24, className, strokeWidth = 1.8, children }: IconProps & { children: ReactNode }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden
  >
    {children}
  </svg>
);
export const Icon = {
  Back: (p: IconProps) => (
    <I {...p}>
      <path d="M15 18l-6-6 6-6" />
    </I>
  ),
  Chevron: (p: IconProps) => (
    <I {...p}>
      <path d="M9 6l6 6-6 6" />
    </I>
  ),
  Settings: (p: IconProps) => (
    <I {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </I>
  ),
  Play: (p: IconProps) => (
    <I {...p}>
      <path d="M7 5v14l11-7z" fill="currentColor" stroke="none" />
    </I>
  ),
  Pause: (p: IconProps) => (
    <I {...p}>
      <rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" />
      <rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" />
    </I>
  ),
  Restart: (p: IconProps) => (
    <I {...p}>
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v5h5" />
    </I>
  ),
  Check: (p: IconProps) => (
    <I {...p} strokeWidth={2.4}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </I>
  ),
  Close: (p: IconProps) => (
    <I {...p}>
      <path d="M6 6l12 12M18 6L6 18" />
    </I>
  ),
  Bluetooth: (p: IconProps) => (
    <I {...p}>
      <path d="M7 7l10 10-5 5V2l5 5L7 17" />
    </I>
  ),
  Usb: (p: IconProps) => (
    <I {...p}>
      <path d="M12 2v20M12 22l-4-4M12 22l4-4M8 8h8M8 8v5l4 3M16 8v5l-4 3" />
    </I>
  ),
  Controller: (p: IconProps) => (
    <I {...p}>
      <rect x="8" y="2.5" width="8" height="19" rx="3.5" />
      <circle cx="12" cy="8" r="1.2" fill="currentColor" stroke="none" />
      <path d="M10.5 13h3M10.5 16h3" />
    </I>
  ),
  Wave: (p: IconProps) => (
    <I {...p}>
      <path d="M2 12h3l2-6 3 12 3-9 2 6 2-3h5" />
    </I>
  ),
  Flag: (p: IconProps) => (
    <I {...p}>
      <path d="M5 21V4M5 4h13l-2 4 2 4H5" />
    </I>
  ),
  Battery: (p: IconProps & { level?: number | null }) => (
    <I {...p}>
      <rect x="2" y="7" width="18" height="10" rx="2.5" />
      <path d="M22 10.5v3" />
      {p.level != null && <rect x="4" y="9" width={Math.max(0.5, (14 * p.level) / 100)} height="6" rx="1" fill="currentColor" stroke="none" />}
    </I>
  ),
  Games: (p: IconProps) => (
    <I {...p}>
      <path d="M6 9h4M8 7v4M15 8h.01M18 10h.01" />
      <path d="M17.3 5H6.7a4.7 4.7 0 0 0-4.6 5.5l1 6A3 3 0 0 0 6 19c1.2 0 2-.6 2.6-1.4L9.8 16h4.4l1.2 1.6c.6.8 1.4 1.4 2.6 1.4a3 3 0 0 0 2.9-2.5l1-6A4.7 4.7 0 0 0 17.3 5z" />
    </I>
  ),
  Music: (p: IconProps) => (
    <I {...p}>
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </I>
  ),
  Workout: (p: IconProps) => (
    <I {...p}>
      <path d="M6.5 6.5v11M17.5 6.5v11M3 9v6M21 9v6M6.5 12h11" />
    </I>
  ),
  Sliders: (p: IconProps) => (
    <I {...p}>
      <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" />
      <circle cx="16" cy="6" r="2" />
      <circle cx="10" cy="12" r="2" />
      <circle cx="18" cy="18" r="2" />
    </I>
  ),
  Home: (p: IconProps) => (
    <I {...p}>
      <path d="M3 11l9-8 9 8v9a2 2 0 0 1-2 2h-4v-7H9v7H5a2 2 0 0 1-2-2z" />
    </I>
  ),
  Swap: (p: IconProps) => (
    <I {...p}>
      <path d="M7 4v13M7 17l-3-3M7 17l3-3M17 20V7M17 7l-3 3M17 7l3 3" />
    </I>
  ),
  Warn: (p: IconProps) => (
    <I {...p}>
      <path d="M12 3l10 18H2z" />
      <path d="M12 10v5M12 18h.01" />
    </I>
  ),
};

// ---------- Button ----------
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'accent' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  icon?: boolean;
  accent?: string;
};
export function Button({ variant = 'default', size = 'md', icon, accent, className = '', style, ...rest }: ButtonProps) {
  const cls = ['btn', variant !== 'default' && `btn--${variant}`, size !== 'md' && `btn--${size}`, icon && 'btn--icon', className]
    .filter(Boolean)
    .join(' ');
  return <button className={cls} style={accent ? ({ ...style, '--btn-accent': accent } as React.CSSProperties) : style} {...rest} />;
}

// ---------- ActivityCard ----------
export function ActivityCard({
  def,
  to,
  eyebrow,
  hero,
  className = '',
}: {
  def: ActivityDefinition;
  to?: string;
  eyebrow?: string;
  hero?: boolean;
  className?: string;
}) {
  const soon = def.status === 'coming-soon';
  const style = { '--card-accent': def.accent } as React.CSSProperties;
  const inner = (
    <>
      <div className="activity-card__orb" />
      {soon && <span className="activity-card__badge">Coming soon</span>}
      <div>
        {eyebrow && <div className="activity-card__eyebrow">{eyebrow}</div>}
        <div className="activity-card__title">{def.name}</div>
        <div className="activity-card__tagline">{def.tagline}</div>
        {!soon && (
          <div className="activity-card__meta">
            <Icon.Controller size={16} />
            {def.controllers.min === def.controllers.max
              ? `${def.controllers.min} controller${def.controllers.min > 1 ? 's' : ''}`
              : `${def.controllers.min}–${def.controllers.max} controllers`}
          </div>
        )}
      </div>
    </>
  );
  const cls = ['activity-card', !soon && to && 'activity-card--interactive', soon && 'activity-card--soon', hero && 'activity-card--hero', className]
    .filter(Boolean)
    .join(' ');
  if (soon || !to)
    return (
      <div className={cls} style={style} aria-disabled={soon}>
        {inner}
      </div>
    );
  return (
    <Link to={to} className={cls} style={style}>
      {inner}
    </Link>
  );
}

// ---------- Status ----------
export function StatusDot({ state }: { state: 'on' | 'off' | 'busy' | 'error' }) {
  return <span className={`status-dot ${state !== 'off' ? `status-dot--${state}` : ''}`} />;
}

// ---------- Segmented ----------
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={o.value === value}
          className={`segmented__item ${o.value === value ? 'segmented__item--on' : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------- Toggle ----------
export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button role="switch" aria-checked={checked} aria-label={label} className={`toggle ${checked ? 'toggle--on' : ''}`} onClick={() => onChange(!checked)}>
      <span className="toggle__knob" />
    </button>
  );
}

// ---------- Settings row ----------
export function SettingRow({ label, hint, children }: { label: string; hint?: string; children?: ReactNode }) {
  return (
    <div className="setting-row">
      <div>
        <div className="setting-row__label">{label}</div>
        {hint && <div className="setting-row__hint">{hint}</div>}
      </div>
      <div className="row">{children}</div>
    </div>
  );
}

export function Section({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="section">
      {title && <div className="section__title">{title}</div>}
      {children}
    </div>
  );
}

// ---------- Back link ----------
export function BackLink({ to, label = 'Back' }: { to: string; label?: string }) {
  return (
    <Link to={to} className="back-link">
      <Icon.Back /> {label}
    </Link>
  );
}

// ---------- Overlay ----------
export function Overlay({ children, onEscape }: { children: ReactNode; onEscape?: () => void }) {
  useEffect(() => {
    if (!onEscape) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onEscape();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onEscape]);
  return (
    <div className="overlay">
      <div className="overlay-card">{children}</div>
    </div>
  );
}

export function Spinner() {
  return <span className="spinner" aria-label="Loading" />;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <span className="kbd">{children}</span>;
}

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const mm = (m % 60).toString().padStart(h ? 2 : 1, '0');
  const ss = (s % 60).toString().padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
