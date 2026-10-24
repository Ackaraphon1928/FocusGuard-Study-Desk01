import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { CheckCircle2, AlertCircle, X } from 'lucide-react';

type ToastTone = 'success' | 'error';
interface ToastContextValue { notify: (message: string, tone?: ToastTone) => void }
const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: {children: ReactNode}) {
  const [toast, setToast] = useState<{message: string; tone: ToastTone} | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notify = useCallback((message: string, tone: ToastTone = 'success') => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ message, tone });
    timer.current = setTimeout(() => setToast(null), 5000);
  }, []);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return <ToastContext.Provider value={{ notify }}>{children}
    {toast && <div role={toast.tone === 'error' ? 'alert' : 'status'} className={`fixed right-5 bottom-5 left-5 z-100 mx-auto flex max-w-xl items-start gap-3 rounded-xl px-5 py-4 text-sm text-white shadow-lg sm:left-auto ${toast.tone === 'error' ? 'bg-rose-800' : 'bg-pine'}`}>
      {toast.tone === 'error' ? <AlertCircle className="mt-0.5 size-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 size-4 shrink-0" />}<span className="leading-6">{toast.message}</span><button aria-label="Dismiss notification" onClick={() => setToast(null)} className="ml-auto p-1"><X className="size-4" /></button>
    </div>}
  </ToastContext.Provider>;
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used within ToastProvider');
  return context;
}
