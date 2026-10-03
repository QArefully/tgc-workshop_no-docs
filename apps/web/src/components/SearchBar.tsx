import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useLocalisation } from '@/i18n/LocaleContext';
import { webMessages } from '@shop/localisation/messages/webShell';

/** Functional catalog search with 300ms debounce and explicit submit support. */
export function SearchBar({ className = '' }: { className?: string }) {
  const [searchParams] = useSearchParams();
  const currentQ = searchParams.get('q') ?? '';
  const [localValue, setLocalValue] = useState(currentQ);
  const navigate = useNavigate();
  const { translate } = useLocalisation();
  const searchLabel = translate(webMessages, 'shell.searchProducts');
  const searchPlaceholder = translate(webMessages, 'shell.searchPlaceholder');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    setLocalValue(currentQ);
  }, [currentQ]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const navigateToCatalog = useCallback(
    (q: string) => {
      const params = new URLSearchParams();
      const normalizedQuery = q.trim();
      if (normalizedQuery) params.set('q', normalizedQuery);

      const category = searchParams.get('category');
      if (category) params.set('category', category);

      const queryString = params.toString();
      navigate(queryString ? `/catalog?${queryString}` : '/catalog');
    },
    [navigate, searchParams],
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setLocalValue(value);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        if (mountedRef.current) navigateToCatalog(value);
      }, 300);
    },
    [navigateToCatalog],
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (timerRef.current) clearTimeout(timerRef.current);
      navigateToCatalog(localValue);
    },
    [navigateToCatalog, localValue],
  );

  return (
    <form className={`relative w-full ${className}`} role="search" onSubmit={handleSubmit}>
      <Search className="pointer-events-none absolute top-1/2 left-4 z-10 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        aria-label={searchLabel}
        placeholder={searchPlaceholder}
        className="h-11 rounded-full border-border bg-surface-raised pl-11 pr-12 text-base shadow-sm transition-[border-color,box-shadow] placeholder:text-muted-foreground/80 hover:border-primary/40 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring"
        value={localValue}
        onChange={handleChange}
      />
      <button
        type="submit"
        aria-label={searchLabel}
        className="absolute top-1/2 right-1.5 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <Search aria-hidden="true" className="size-4" />
      </button>
    </form>
  );
}
