import { useEffect, useId, useRef, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from 'react';
import { AlertCircle, LoaderCircle, X, type LucideIcon } from 'lucide-react';
import { errorMessage } from '../lib/format';

export function Card({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`rounded-2xl border border-line bg-white ${className}`} {...props} />;
}

export function Button({ className = '', variant = 'primary', type = 'button', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' }) {
  const variants = {
    primary: 'border-pine bg-pine text-white hover:bg-pine-dark',
    secondary: 'border-line bg-white text-ink hover:bg-sage-light',
    ghost: 'border-transparent bg-transparent text-pine hover:bg-sage-light',
    danger: 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100',
  };
  return <button type={type} className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border px-3.5 py-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:size-4 ${variants[variant]} ${className}`} {...props} />;
}

export function Badge({ children, tone = 'good', className = '' }: {children: ReactNode; tone?: 'good' | 'muted' | 'warning' | 'danger'; className?: string}) {
  const tones = { good: 'bg-sage-light text-pine', muted: 'bg-stone-100 text-stone-500', warning: 'bg-amber-50 text-amber-700', danger: 'bg-rose-50 text-rose-700' };
  return <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-medium ${tones[tone]} ${className}`}>{children}</span>;
}

export function LoadingState({ message = 'Connecting to your study space…' }: {message?: string}) {
  return <div className="flex min-h-52 flex-col items-center justify-center gap-4 p-8 text-sm text-muted" role="status"><LoaderCircle className="size-6 animate-spin text-pine motion-reduce:animate-none" />{message}</div>;
}

export function EmptyState({ title, description }: {title: string; description?: string}) {
  return <div className="px-6 py-14 text-center"><h3 className="text-base font-semibold text-ink">{title}</h3>{description && <p className="mx-auto mt-3 max-w-md text-sm leading-7 text-muted">{description}</p>}</div>;
}

export function ErrorNotice({ error }: {error: unknown}) {
  if (!error) return null;
  return <div role="alert" className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-6 text-amber-800"><AlertCircle className="mt-0.5 size-4 shrink-0" /><span>{errorMessage(error)}</span></div>;
}

export function StatCard({ label, value, caption, icon: Icon }: {label: string; value: ReactNode; caption?: string; icon?: LucideIcon}) {
  return <Card className="p-5"><div className="flex items-center gap-2 text-xs text-muted">{Icon && <Icon className="size-4 text-sage" />}{label}</div><div className="mt-4 text-3xl font-semibold tracking-tight text-ink">{value}</div>{caption && <p className="mt-2 text-xs leading-5 text-muted">{caption}</p>}</Card>;
}

export function Modal({ open, onClose, title, description, children, className = '', drawer = false }: {open: boolean; onClose: () => void; title: string; description?: string; children: ReactNode; className?: string; drawer?: boolean}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [open]);

  return <dialog ref={dialogRef} aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined}
    onCancel={onClose} onClose={onClose}
    onClick={(event) => {
      if (event.target !== event.currentTarget) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
    }}
    className={`${drawer ? 'fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-dvh w-lg max-w-full rounded-l-2xl' : 'm-auto max-h-[90dvh] w-2xl max-w-[calc(100%-2rem)] rounded-2xl'} overflow-y-auto border border-line bg-white p-6 text-ink shadow-2xl backdrop:bg-pine-dark/30 backdrop:backdrop-blur-xs sm:p-8 ${className}`}>
    <div className="mb-5 flex items-start justify-between gap-4"><div><h2 id={titleId} className="text-xl font-semibold tracking-tight">{title}</h2>{description && <p id={descriptionId} className="mt-3 text-sm leading-7 text-muted">{description}</p>}</div><button type="button" aria-label={`Close ${title}`} onClick={onClose} className="-mt-1 rounded-lg p-2 text-muted hover:bg-sage-light"><X className="size-5" /></button></div>
    {open ? children : null}
  </dialog>;
}
