import { describe, expect, it } from 'vitest';
import {
  addComparisonId,
  comparisonPath,
  clearComparisonIds,
  parseComparisonSelection,
  removeComparisonId,
  serializeComparisonIds,
  toggleComparisonId,
} from './comparisonSelection';

describe('comparison URL selection', () => {
  it('preserves request order and emits a canonical comma-separated value', () => {
    expect(parseComparisonSelection(new URLSearchParams('ids=3,1,2'))).toEqual({
      status: 'valid',
      ids: ['3', '1', '2'],
      value: '3,1,2',
    });
    expect(serializeComparisonIds(['4', '2', '3'])).toBe('4,2,3');
  });

  it('distinguishes a missing selection from malformed URL input', () => {
    expect(parseComparisonSelection(new URLSearchParams())).toEqual({ status: 'missing' });
    expect(parseComparisonSelection(new URLSearchParams('ids=1,,2'))).toEqual({
      status: 'invalid',
    });
    expect(parseComparisonSelection(new URLSearchParams('ids=1,2&ids=3,4'))).toEqual({
      status: 'invalid',
    });
  });

  it.each([
    '1',
    '1,2,3,4,5',
    '1,1',
    '01,2',
    '0,2',
    '-1,2',
    '+1,2',
    '1, 2',
    '1,two',
    '9007199254740992,2',
  ])('rejects invalid IDs: %s', (ids) => {
    expect(parseComparisonSelection(new URLSearchParams({ ids }))).toEqual({ status: 'invalid' });
  });

  it('removes an ID without sorting the remaining requested order', () => {
    expect(removeComparisonId(['4', '2', '3'], '2')).toEqual(['4', '3']);
  });

  it('toggles draft IDs in insertion order', () => {
    expect(toggleComparisonId(['3', '1'], '2')).toEqual({ status: 'added', ids: ['3', '1', '2'] });
    expect(toggleComparisonId(['3', '1', '2'], '1')).toEqual({
      status: 'removed',
      ids: ['3', '2'],
    });
    expect(toggleComparisonId(['3', '2'], '1')).toEqual({ status: 'added', ids: ['3', '2', '1'] });
    expect(clearComparisonIds()).toEqual([]);
  });

  it('rejects a fifth draft ID without changing selection', () => {
    expect(addComparisonId(['1', '2', '3', '4'], '5')).toEqual({
      status: 'at-capacity',
      ids: ['1', '2', '3', '4'],
    });
  });

  it('serializes a complete draft as one comparison path', () => {
    expect(comparisonPath(['4', '2'])).toBe('/compare?ids=4,2');
    expect(comparisonPath(['4'])).toBeNull();
  });
});
