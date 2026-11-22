import { useEffect, useRef, type ReactNode } from 'react';
import { X, LoaderCircle, Orbit, AlertCircle } from 'lucide-react';
export function Planet({ mini = false }: { mini?: boolean }) {
  return (
    <div className={mini ? 'cosmic-planet mini' : 'cosmic-planet'} aria-hidden="true">
      <div className="planet-halo" />
      <div className="planet-orbit" />
      <div className="planet-body" />
      <div className="planet-sheen" />
    </div>
  );
}
export function Space() {
  return (
    <div className="space" aria-hidden="true">
      <div className="nebula nebula-one" />
      <div className="nebula nebula-two" />
      <div className="stars stars-one" />
      <div className="stars stars-two" />
    </div>
  );
}
export function Loading({ text = 'Загрузка…' }: { text?: string }) {
  return (
    <div className="loading" role="status">
      <Orbit className="spin" size={27} />
      <span>{text}</span>
    </div>
  );
}
export function ErrorBox({ message }: { message: string }) {
  return message ? (
    <div className="error-box" role="alert">
      <AlertCircle size={18} />
      <span>{message}</span>
    </div>
  ) : null;
}
export function Empty({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <Planet mini />
      <h2>{title}</h2>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function Button({
  children,
  busy = false,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean }) {
  return (
    <button
      {...props}
      className={'btn ' + (props.className || '')}
      disabled={props.disabled || busy}
    >
      {busy ? <LoaderCircle className="spin" size={18} /> : null}
      {children}
    </button>
  );
}
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const old = document.activeElement as HTMLElement;
    ref.current?.querySelector<HTMLElement>('button,input')?.focus();
    return () => old?.focus();
  }, []);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={ref}
        className="glass modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
          if (e.key === 'Tab') {
            const items = Array.from(
              e.currentTarget.querySelectorAll<HTMLElement>(
                'button:not(:disabled),input,select,textarea,a[href]',
              ),
            );
            const a = items[0],
              b = items.at(-1);
            if (e.shiftKey && document.activeElement === a) {
              e.preventDefault();
              b?.focus();
            }
            if (!e.shiftKey && document.activeElement === b) {
              e.preventDefault();
              a?.focus();
            }
          }
        }}
      >
        <button className="icon-btn close" aria-label="Закрыть окно" onClick={onClose}>
          <X size={21} />
        </button>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}
