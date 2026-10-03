import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import type {
  StandingOrder,
  StandingOrderCadence,
  StandingOrderRun,
} from '@shop/contracts/standing-orders';
import {
  createStandingOrder,
  deleteStandingOrder,
  getStandingOrderRuns,
  getStandingOrders,
  runStandingOrderNow,
  updateStandingOrder,
} from '@/api/standingOrders';
import { getOrders } from '@/api/orders';
import { getSavedLists } from '@/api/savedLists';
import { ErrorMessage } from '@/components/ErrorMessage';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { Button } from '@/components/ui/button';
import { useLocalisation } from '@/i18n/LocaleContext';
import { apiErrors } from '@shop/localisation/messages/apiErrors';
import { repeatBuyingMessages } from '@shop/localisation/messages/repeatBuying';
import {
  tradeAsyncMessages,
  type TradeAsyncMessageKey,
} from '@shop/localisation/messages/tradeAsync';
import {
  STANDING_ORDER_CADENCES,
  standingOrderCadenceLabel,
  standingOrderErrorMessage,
  standingOrderOutcomeLabel,
  standingOrderRunSummary,
  standingOrderSkipReasonLabel,
} from './standingOrdersPresentation';
type Kind = 'saved_list' | 'order';
type Data = {
  orders: StandingOrder[];
  lists: Awaited<ReturnType<typeof getSavedLists>>;
  sourceOrders: Awaited<ReturnType<typeof getOrders>>['items'];
};
function History({ id, runs }: { id: string; runs?: StandingOrderRun[] }) {
  const { translate, formatInstant } = useLocalisation();
  const t = <K extends TradeAsyncMessageKey>(
    key: K,
    params?: Readonly<Record<string, string | number | bigint>>,
  ) => translate(tradeAsyncMessages, key, params);
  const repeatT = (
    key: keyof typeof repeatBuyingMessages,
    params?: Readonly<Record<string, string | number | bigint>>,
  ) => translate(repeatBuyingMessages, key, params);
  return !runs ? null : (
    <section className="mt-4" aria-label={t('standing.historyAria', { id })}>
      <h3 className="font-medium">{t('standing.history')}</h3>
      {runs.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('standing.noRuns')}</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {runs.map((run) => (
            <li className="rounded border p-3 text-sm" key={run.id}>
              <p className="font-medium">
                {formatInstant(run.runAt)} ·{' '}
                {t(`standing.status.${run.status}` as TradeAsyncMessageKey)}
              </p>
              <p className="text-muted-foreground">{standingOrderRunSummary(run, t)}</p>
              {run.outcomes?.map((x) => (
                <p key={x.orderLineItemId}>
                  <span className="font-medium">{standingOrderOutcomeLabel(x, repeatT)}</span>{' '}
                  {x.status === 'skipped' && (
                    <span className="text-muted-foreground">
                      {standingOrderSkipReasonLabel(x, repeatT)}
                    </span>
                  )}
                </p>
              ))}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
/** Buyer schedules show server-provided timestamps; browser never calculates next runs. */
export function StandingOrdersPage() {
  const { translate, formatInstant } = useLocalisation();
  const t = <K extends TradeAsyncMessageKey>(
    key: K,
    params?: Readonly<Record<string, string | number | bigint>>,
  ) => translate(tradeAsyncMessages, key, params);
  const apiT = (key: string, params?: Readonly<Record<string, string | number | bigint>>) =>
    translate(apiErrors, key, params);
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<Kind>('saved_list');
  const [sourceId, setSourceId] = useState('');
  const [cadence, setCadence] = useState<StandingOrderCadence>('weekly');
  const [creating, setCreating] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [runs, setRuns] = useState<Record<string, StandingOrderRun[]>>({});
  const generation = useRef(0);
  const actionGeneration = useRef<Record<string, number>>({});
  const startAction = (key: string) => {
    const current = (actionGeneration.current[key] ?? 0) + 1;
    actionGeneration.current[key] = current;
    return () => actionGeneration.current[key] === current;
  };
  const invalidateLoad = () => {
    generation.current += 1;
  };
  const load = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    setError(null);
    try {
      const [orders, lists, source] = await Promise.all([
        getStandingOrders(),
        getSavedLists(),
        getOrders(1, 50),
      ]);
      if (current === generation.current) setData({ orders, lists, sourceOrders: source.items });
    } catch (cause) {
      if (current === generation.current) setError(standingOrderErrorMessage(cause, t, apiT));
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const savedOptions = data?.lists ?? [];
  const orderOptions = data?.sourceOrders ?? [];
  useEffect(() => {
    setSourceId(
      kind === 'saved_list' ? (savedOptions[0]?.listId ?? '') : (orderOptions[0]?.id ?? ''),
    );
  }, [kind, savedOptions, orderOptions]);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || !sourceId || creating) return;
    setCreating(true);
    setError(null);
    invalidateLoad();
    const isCurrent = startAction('create');
    try {
      const source =
        kind === 'saved_list'
          ? ({ kind, listId: sourceId } as const)
          : ({ kind, orderId: sourceId } as const);
      const order = await createStandingOrder({ name: name.trim(), source, cadence });
      if (isCurrent()) {
        setData((old) => old && { ...old, orders: [...old.orders, order] });
        setName('');
      }
    } catch (cause) {
      if (isCurrent()) setError(standingOrderErrorMessage(cause, t, apiT));
    } finally {
      if (isCurrent()) setCreating(false);
    }
  }
  async function update(
    order: StandingOrder,
    body: { active?: boolean; cadence?: StandingOrderCadence },
  ) {
    invalidateLoad();
    const isCurrent = startAction(`update:${order.id}`);
    setError(null);
    try {
      const next = await updateStandingOrder(order.id, body);
      if (isCurrent())
        setData(
          (old) => old && { ...old, orders: old.orders.map((x) => (x.id === next.id ? next : x)) },
        );
    } catch (cause) {
      if (isCurrent()) setError(standingOrderErrorMessage(cause, t, apiT));
    }
  }
  async function history(id: string) {
    const isCurrent = startAction(`history:${id}`);
    setError(null);
    try {
      const value = await getStandingOrderRuns(id);
      if (isCurrent()) setRuns((old) => ({ ...old, [id]: value }));
    } catch (cause) {
      if (isCurrent()) setError(standingOrderErrorMessage(cause, t, apiT));
    }
  }
  async function run(order: StandingOrder) {
    if (running) return;
    invalidateLoad();
    const isCurrent = startAction(`run:${order.id}`);
    setRunning(order.id);
    setError(null);
    try {
      const result = await runStandingOrderNow(order.id);
      const historyResult = await getStandingOrderRuns(order.id);
      if (!isCurrent()) return;
      setRuns((old) => ({
        ...old,
        [order.id]: historyResult.some((x) => x.id === result.id)
          ? historyResult
          : [result, ...historyResult],
      }));
      await load();
    } catch (cause) {
      if (isCurrent()) setError(standingOrderErrorMessage(cause, t, apiT));
    } finally {
      setRunning((current) => (current === order.id ? null : current));
    }
  }
  async function remove(order: StandingOrder) {
    invalidateLoad();
    const isCurrent = startAction(`remove:${order.id}`);
    setError(null);
    try {
      await deleteStandingOrder(order.id);
      if (isCurrent())
        setData((old) => old && { ...old, orders: old.orders.filter((x) => x.id !== order.id) });
    } catch (cause) {
      if (isCurrent()) setError(standingOrderErrorMessage(cause, t, apiT));
    }
  }
  if (loading && !data) return <LoadingSpinner />;
  if (error && !data) return <ErrorMessage message={error} onRetry={() => void load()} />;
  if (!data)
    return <ErrorMessage message={t('standing.error.unavailable')} onRetry={() => void load()} />;
  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-12">
      <header>
        <p className="section-eyebrow">{t('standing.title')}</p>
        <h1 className="section-heading mt-2">{t('standing.heading')}</h1>
      </header>
      {error && (
        <p role="alert" className="rounded-md border border-destructive/40 p-3 text-destructive">
          {error}
        </p>
      )}
      <form className="space-y-3 rounded-lg border p-4" onSubmit={(e) => void create(e)}>
        <h2 className="font-medium">{t('standing.new')}</h2>
        <label htmlFor="standing-order-name">
          {t('standing.name')}
          <input
            id="standing-order-name"
            className="ml-2 h-9 rounded border bg-background px-2"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label htmlFor="standing-order-kind">
          {t('standing.repeatFrom')}
          <select
            id="standing-order-kind"
            className="ml-2 h-9 rounded border bg-background px-2"
            value={kind}
            onChange={(e) => setKind(e.target.value as Kind)}
          >
            <option value="saved_list">{t('standing.savedList')}</option>
            <option value="order">{t('standing.pastOrder')}</option>
          </select>
        </label>
        <label htmlFor="standing-order-source">
          {t('standing.source')}
          <select
            id="standing-order-source"
            className="ml-2 h-9 rounded border bg-background px-2"
            value={sourceId}
            onChange={(e) => setSourceId(e.target.value)}
          >
            {kind === 'saved_list'
              ? savedOptions.map((x) => (
                  <option key={x.listId} value={x.listId}>
                    {x.name}
                  </option>
                ))
              : orderOptions.map((x) => (
                  <option key={x.id} value={x.id}>
                    {t('standing.order', { id: x.id })}
                  </option>
                ))}
          </select>
        </label>
        <label htmlFor="standing-order-cadence">
          {t('standing.cadence')}
          <select
            id="standing-order-cadence"
            className="ml-2 h-9 rounded border bg-background px-2"
            value={cadence}
            onChange={(e) => setCadence(e.target.value as StandingOrderCadence)}
          >
            {STANDING_ORDER_CADENCES.map((x) => (
              <option key={x} value={x}>
                {standingOrderCadenceLabel(x, t)}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" disabled={creating || !name.trim() || !sourceId}>
          {creating ? t('standing.creating') : t('standing.create')}
        </Button>
      </form>
      {data.orders.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">{t('standing.empty')}</div>
      ) : (
        <ul aria-label={t('standing.title')} className="space-y-3">
          {data.orders.map((order) => (
            <li key={order.id} className="rounded-lg border p-4">
              <div className="flex flex-wrap justify-between gap-3">
                <div>
                  <h2 className="font-medium">{order.name}</h2>
                  <p className="text-sm text-muted-foreground">
                    {t('standing.nextRun', {
                      cadence: standingOrderCadenceLabel(order.cadence, t),
                      date: formatInstant(order.nextRunAt),
                    })}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {order.active ? t('standing.active') : t('standing.paused')}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void update(order, { active: !order.active })}
                  >
                    {order.active ? t('standing.pause') : t('standing.resume')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={running !== null}
                    onClick={() => void remove(order)}
                  >
                    {t('standing.delete')}
                  </Button>
                  <Button
                    size="sm"
                    disabled={!order.active || running !== null}
                    onClick={() => void run(order)}
                  >
                    {running === order.id ? t('standing.running') : t('standing.runNow')}
                  </Button>
                </div>
              </div>
              <label className="mt-3 block" htmlFor={`cadence-${order.id}`}>
                {t('standing.cadence')}
                <select
                  id={`cadence-${order.id}`}
                  className="ml-2 h-8 rounded border bg-background px-2"
                  value={order.cadence}
                  onChange={(e) =>
                    void update(order, { cadence: e.target.value as StandingOrderCadence })
                  }
                >
                  {STANDING_ORDER_CADENCES.map((x) => (
                    <option key={x} value={x}>
                      {standingOrderCadenceLabel(x, t)}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                className="mt-3"
                variant="ghost"
                size="sm"
                onClick={() => void history(order.id)}
              >
                {t('standing.showHistory')}
              </Button>
              <History id={order.id} runs={runs[order.id]} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
