import type { ReactNode } from 'react';

export type Tone = 'info' | 'error' | 'warn' | 'success' | 'neutral';

export function Banner({
  tone = 'info',
  title,
  children,
  action,
}: {
  tone?: Tone;
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={`banner banner-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <div className="banner-body">
        {title ? <strong>{title}</strong> : null}
        {children ? <div>{children}</div> : null}
      </div>
      {action ? <div className="banner-action">{action}</div> : null}
    </div>
  );
}

export function SectionCard({
  title,
  aside,
  actions,
  children,
}: {
  title: string;
  aside?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="card">
      <header className="card-head">
        <div>
          <h2>{title}</h2>
          {aside ? <p className="muted small">{aside}</p> : null}
        </div>
        {actions ? <div className="card-actions">{actions}</div> : null}
      </header>
      {children}
    </section>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children ? <p className="muted small">{children}</p> : null}
    </div>
  );
}

export function SkeletonRows({ count = 2 }: { count?: number }) {
  return (
    <div className="skeleton" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="skeleton-row" />
      ))}
    </div>
  );
}

export function Pill({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

export function Note({ children }: { children: ReactNode }) {
  return <p className="note small">{children}</p>;
}

export function DataRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="data-row">
      <span className="muted small">{label}</span>
      <span>{value}</span>
    </div>
  );
}
