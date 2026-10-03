import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import {
  comparisonPath,
  normalizeComparisonIds,
  toggleComparisonId,
  type ComparisonDraftChange,
} from './comparisonSelection';
import {
  loadComparisonSelection,
  saveComparisonSelection,
  type ComparisonSelectionStorage,
} from './comparisonStorage';

type CapacityStatus = 'available' | 'at-capacity';

interface ComparisonSelectionContextValue {
  selectedIds: string[];
  isSelected: (id: string) => boolean;
  toggle: (id: string) => ComparisonDraftChange;
  clear: () => void;
  canCompare: boolean;
  comparePath: string | null;
  capacityStatus: CapacityStatus;
  syncValidSelection: (ids: readonly unknown[]) => void;
}

const ComparisonSelectionContext = createContext<ComparisonSelectionContextValue | null>(null);

function browserStorage(): ComparisonSelectionStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function initialSelection(storage: ComparisonSelectionStorage | null | undefined): string[] {
  return loadComparisonSelection(storage ?? browserStorage()) ?? [];
}

export function ComparisonSelectionProvider({
  children,
  storage,
}: {
  children: ReactNode;
  storage?: ComparisonSelectionStorage | null;
}) {
  const resolvedStorage = storage === undefined ? browserStorage() : storage;
  const [selectedIds, setSelectedIds] = useState(() => initialSelection(resolvedStorage));
  const [capacityStatus, setCapacityStatus] = useState<CapacityStatus>('available');

  const persistCompleteSelection = useCallback(
    (ids: readonly string[]) => {
      if (normalizeComparisonIds(ids) !== null) saveComparisonSelection(resolvedStorage, ids);
    },
    [resolvedStorage],
  );

  const toggle = useCallback(
    (id: string): ComparisonDraftChange => {
      const change = toggleComparisonId(selectedIds, id);
      if (change.status === 'at-capacity') {
        setCapacityStatus('at-capacity');
        return change;
      }
      if (change.status !== 'invalid') {
        setSelectedIds(change.ids);
        persistCompleteSelection(change.ids);
        setCapacityStatus('available');
      }
      return change;
    },
    [persistCompleteSelection, selectedIds],
  );

  const clear = useCallback(() => {
    setSelectedIds([]);
    setCapacityStatus('available');
  }, []);

  const syncValidSelection = useCallback(
    (ids: readonly unknown[]) => {
      const normalized = normalizeComparisonIds(ids);
      if (normalized === null) return;
      setSelectedIds(normalized);
      persistCompleteSelection(normalized);
      setCapacityStatus('available');
    },
    [persistCompleteSelection],
  );

  const value = useMemo<ComparisonSelectionContextValue>(
    () => ({
      selectedIds,
      isSelected: (id) => selectedIds.includes(id),
      toggle,
      clear,
      canCompare: normalizeComparisonIds(selectedIds) !== null,
      comparePath: comparisonPath(selectedIds),
      capacityStatus,
      syncValidSelection,
    }),
    [capacityStatus, clear, selectedIds, syncValidSelection, toggle],
  );

  return (
    <ComparisonSelectionContext.Provider value={value}>
      {children}
    </ComparisonSelectionContext.Provider>
  );
}

export function useComparisonSelection(): ComparisonSelectionContextValue {
  const context = useContext(ComparisonSelectionContext);
  if (!context)
    throw new Error('useComparisonSelection must be used within ComparisonSelectionProvider');
  return context;
}
