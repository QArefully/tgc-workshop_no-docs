import { createElement, type ReactNode } from 'react';

export const NARROW_FONT = "Haettenschweiler,'Arial Narrow',Impact,sans-serif";
export const UI_FONT = 'Arial,Helvetica,sans-serif';
export const MONO_FONT = "'Courier New',monospace";

/**
 * Per-category safety defaults only. `alert` is safety-owned and must never vary with a decorative
 * colour scheme; `ink` here is the neutral category default used when no catalog palette resolves
 * (`resolvePackagingSpec` overrides it from `catalogPackagingPalettes` for canonical products).
 * Do not expand this table into the decorative scheme matrix -- that lives in
 * `catalogPackagingPalettes.ts`.
 */
export const INKS = {
  trade: { ink: '#26292c', alert: '#b0381a' },
  garden: { ink: '#2c5130', alert: '#9d5416' },
  clean: { ink: '#1b4a68', alert: '#b0381a' },
} as const satisfies Record<string, { ink: string; alert: string }>;
export type InkKey = keyof typeof INKS;

interface CondOptions {
  anchor?: 'start' | 'end' | 'middle';
  opacity?: number;
}

export function cond(
  x: number,
  y: number,
  str: string,
  size: number,
  width: number,
  fill: string,
  opts: CondOptions = {},
): ReactNode {
  const { anchor = 'start', opacity = 1 } = opts;
  return createElement(
    'text',
    {
      key: `${x}-${y}-${str}`,
      x,
      y,
      fill,
      opacity,
      fontFamily: NARROW_FONT,
      fontSize: size,
      textAnchor: anchor,
      textLength: width,
      lengthAdjust: 'spacingAndGlyphs',
    },
    str,
  );
}

/** Deterministic condensed-text pixel width from character count, clamped to a sane range. */
export function condWidth(str: string, perChar = 30, min = 40, max = 420): number {
  return Math.min(max, Math.max(min, str.length * perChar));
}

interface LabOptions {
  anchor?: 'start' | 'end' | 'middle';
  weight?: number;
  opacity?: number;
  /**
   * Pixel width to force via `textLength` + `spacingAndGlyphs`, same mechanism as `cond`. Required
   * whenever `str` is unbounded prose sourced from a catalog fact field (hazard/handling/ppe,
   * grade, yield, the keg's "never" clause) rather than a short fixed literal -- see R4-F1: an
   * unconstrained `lab()` call fed real catalog prose overflows its printable panel. Callers
   * compute this with `condWidth` scoped to the panel's available pixel budget. Omit only for
   * literal caption strings (fixed labels, brand, category name) that are known short and constant.
   */
  width?: number;
}

/** Label / caption text, ported from the prototype's `lab` helper (`:100-105`). */
export function lab(
  x: number,
  y: number,
  str: string,
  size: number,
  fill: string,
  sp = 1.4,
  opts: LabOptions = {},
): ReactNode {
  const { anchor = 'start', weight = 700, opacity = 1, width } = opts;
  return createElement(
    'text',
    {
      key: `${x}-${y}-${str}`,
      x,
      y,
      fill,
      opacity,
      fontFamily: UI_FONT,
      fontSize: size,
      fontWeight: weight,
      letterSpacing: sp,
      textAnchor: anchor,
      ...(width !== undefined ? { textLength: width, lengthAdjust: 'spacingAndGlyphs' } : {}),
    },
    str,
  );
}

/** GHS-style diamond hazard pictogram, ported from the prototype's `ghs` helper (`:106-112`). */
export function ghs(cx: number, cy: number, r: number, alert: string, paper: string): ReactNode {
  return createElement(
    'g',
    { key: 'ghs', transform: `translate(${cx} ${cy})` },
    createElement(
      'g',
      { transform: 'rotate(45)' },
      createElement('rect', {
        x: -r,
        y: -r,
        width: r * 2,
        height: r * 2,
        rx: 3,
        fill: paper,
        stroke: alert,
        strokeWidth: r * 0.22,
      }),
    ),
    createElement(
      'text',
      {
        x: 0,
        y: r * 0.42,
        textAnchor: 'middle',
        fontFamily: UI_FONT,
        fontSize: r * 1.25,
        fontWeight: 900,
        fill: '#1b1c19',
      },
      '!',
    ),
  );
}

/**
 * Generic irritant pictogram -- a plain circle mark, not a GHS diamond -- used only by the
 * softened keg "mild" tone so it never borrows the corrosive pictogram's severity.
 */
export function irritant(cx: number, cy: number, r: number, ink: string, paper: string): ReactNode {
  return createElement(
    'g',
    { key: 'irritant', transform: `translate(${cx} ${cy})` },
    createElement('circle', { r, fill: paper, stroke: ink, strokeWidth: r * 0.16 }),
    createElement(
      'text',
      {
        x: 0,
        y: r * 0.36,
        textAnchor: 'middle',
        fontFamily: UI_FONT,
        fontSize: r * 1.1,
        fontWeight: 900,
        fill: ink,
      },
      'i',
    ),
  );
}

/**
 * Balanced two-line title split by character-count, mirroring `BagArtwork`'s `ProductLabel` title
 * logic (`components/BagArtwork.tsx:32-53`). Single-word names return one line.
 */
export function titleLines(name: string): string[] {
  const normalized = name.trim().toUpperCase() || 'MATERIAL';
  const words = normalized.split(/\s+/);
  if (words.length <= 1) {
    return [words[0] ?? normalized];
  }
  const splitIndex = Array.from({ length: words.length - 1 }, (_, index) => index + 1).reduce(
    (best, candidate) => {
      const difference = Math.abs(
        words.slice(0, candidate).join(' ').length - words.slice(candidate).join(' ').length,
      );
      const bestDifference = Math.abs(
        words.slice(0, best).join(' ').length - words.slice(best).join(' ').length,
      );
      return difference < bestDifference ? candidate : best;
    },
    1,
  );
  return [words.slice(0, splitIndex).join(' '), words.slice(splitIndex).join(' ')];
}
