import {
  createContext,
  useCallback,
  useContext,
  useState,
  useEffect,
  useRef,
  type ReactNode,
} from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLocalisation } from '@/i18n/LocaleContext';
import { webMessages } from '@shop/localisation/messages/webShell';

export interface Toast {
  id: string;
  message: string;
  variant: 'default' | 'success' | 'error';
}

interface ToastContextValue {
  toast: (message: string, variant?: Toast['variant']) => void;
}

const ToastContext = createContext<ToastContextValue>({
  toast: () => {},
});

let toastId = 0;

/**
 * Toast provider — manages toast notifications.
 * Wrap the app to enable toast() calls from anywhere via the hook.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const { translate } = useLocalisation();

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const toast = useCallback(
    (message: string, variant: Toast['variant'] = 'default') => {
      const id = `toast-${++toastId}`;
      const resolvedVariant: Toast['variant'] = variant ?? 'default';
      setToasts((prev) => [...prev, { id, message, variant: resolvedVariant }]);
      const timer = setTimeout(() => {
        removeToast(id);
      }, 4000);
      timersRef.current.set(id, timer);
    },
    [removeToast],
  );

  useEffect(() => {
    return () => {
      timersRef.current.forEach((t) => clearTimeout(t));
      timersRef.current.clear();
    };
  }, []);

  const variantClasses: Record<'default' | 'success' | 'error', string> = {
    default: 'bg-foreground text-background',
    success: 'bg-green-600 text-white',
    error: 'bg-destructive text-destructive-foreground',
  };

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {/* Toast container */}
      <div
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 right-4 z-[100] flex flex-col gap-2"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={cn(
              'pointer-events-auto flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium shadow-lg transition-all animate-in fade-in slide-in-from-right-4',
              variantClasses[t.variant],
            )}
          >
            <span>{t.message}</span>
            <button
              type="button"
              onClick={() => removeToast(t.id)}
              className="ml-2 rounded-full p-0.5 opacity-70 hover:opacity-100"
              aria-label={translate(webMessages, 'shell.dismiss')}
            >
              <X className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/**
 * Hook to trigger toasts from any component inside a ToastProvider.
 *
 * @example
 * const { toast } = useToast();
 * toast('Added to cart', 'success');
 */
export function useToast(): ToastContextValue {
  return useContext(ToastContext);
}
