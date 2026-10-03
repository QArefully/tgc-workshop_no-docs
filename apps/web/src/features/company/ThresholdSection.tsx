import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { useLocalisation } from '@/i18n/LocaleContext';
import {
  tradeAsyncMessages,
  type TradeAsyncMessageKey,
} from '@shop/localisation/messages/tradeAsync';

type Props = {
  thresholdCents: number | null;
  isOwner: boolean;
  onSave: (cents: number | null) => Promise<void>;
};

function parseThresholdCents(value: string): number | null | undefined {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(trimmed);
  if (!match) return undefined;
  const wholePounds = match[1];
  if (!wholePounds) return undefined;

  const fractionalPence = BigInt((match[2] ?? '').padEnd(2, '0'));
  const cents = BigInt(wholePounds) * 100n + fractionalPence;
  return cents <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(cents) : undefined;
}

export function ThresholdSection({ thresholdCents, isOwner, onSave }: Props) {
  const { translate, formatSettlementMoney } = useLocalisation();
  const t = <K extends TradeAsyncMessageKey>(
    key: K,
    params?: Record<string, string | number | bigint>,
  ) => translate(tradeAsyncMessages, key, params);
  const [value, setValue] = useState(
    thresholdCents === null ? '' : (thresholdCents / 100).toFixed(2),
  );
  const [busy, setBusy] = useState(false);
  useEffect(
    () => setValue(thresholdCents === null ? '' : (thresholdCents / 100).toFixed(2)),
    [thresholdCents],
  );
  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = parseThresholdCents(value);
    if (parsed === undefined) return;
    setBusy(true);
    try {
      await onSave(parsed);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="mt-6 rounded-lg border p-5">
      <h2 className="font-semibold">{t('company.threshold.heading')}</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {thresholdCents === null
          ? t('company.threshold.none')
          : t('company.threshold.requires', { amount: formatSettlementMoney(thresholdCents) })}
      </p>
      {isOwner && (
        <form onSubmit={(event) => void submit(event)} className="mt-3 flex items-center gap-2">
          <label htmlFor="approval-threshold" className="text-sm">
            {t('company.threshold.label')}
          </label>
          <input
            id="approval-threshold"
            inputMode="decimal"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={t('company.threshold.placeholder')}
            className="w-32 rounded-md border px-3 py-2 text-sm"
          />
          <Button type="submit" disabled={busy}>
            {busy ? t('company.threshold.saving') : t('company.threshold.save')}
          </Button>
        </form>
      )}
    </section>
  );
}
