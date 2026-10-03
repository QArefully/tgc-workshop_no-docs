import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useLocalisation } from '@/i18n/LocaleContext';
import { identityAccountMessages } from '@shop/localisation/messages/identityAccount';

/**
 * Small presentational parts shared by the trade profile sections.
 * Keeps label/error/status markup identical between delivery sites and billing details.
 */

interface TradeTextFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  error?: string;
  maxLength: number;
  optional?: boolean;
  autoComplete?: string;
  inputMode?: 'text' | 'tel';
}

export function TradeTextField({
  id,
  label,
  value,
  onChange,
  error,
  maxLength,
  optional,
  autoComplete,
  inputMode,
}: TradeTextFieldProps) {
  const { translate } = useLocalisation();
  const errorId = `${id}-error`;
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
        {optional && (
          <span className="ml-1 font-normal text-muted-foreground">
            {translate(identityAccountMessages, 'account.address.optional')}
          </span>
        )}
      </label>
      <Input
        id={id}
        value={value}
        maxLength={maxLength}
        autoComplete={autoComplete}
        inputMode={inputMode}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1"
      />
      {error && (
        <p id={errorId} role="alert" className="mt-1 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

interface TradeCheckboxProps {
  id: string;
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}

export function TradeCheckbox({ id, label, checked, onChange }: TradeCheckboxProps) {
  return (
    <div className="flex items-center gap-2">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 rounded border-input accent-primary"
      />
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
    </div>
  );
}

interface TradeListStatusProps {
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  isEmpty: boolean;
  loadingLabel: string;
  emptyLabel: string;
}

/** Explicit loading, error+retry, and empty states for a trade collection. */
export function TradeListStatus({
  loading,
  error,
  onRetry,
  isEmpty,
  loadingLabel,
  emptyLabel,
}: TradeListStatusProps): ReactNode {
  const { translate } = useLocalisation();
  if (loading) {
    return (
      <p role="status" className="py-4 text-sm text-muted-foreground">
        {loadingLabel}
      </p>
    );
  }
  if (error) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-lg bg-destructive/10 p-3">
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          {translate(identityAccountMessages, 'account.common.tryAgain')}
        </Button>
      </div>
    );
  }
  if (isEmpty) {
    return <p className="py-4 text-sm text-muted-foreground">{emptyLabel}</p>;
  }
  return null;
}
