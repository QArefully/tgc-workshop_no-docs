import { useId, useState } from 'react';

import type { CustomBlendOption } from '@shop/contracts/custom-blends';

import { resolveCatalogPackagingPalette } from '@/components/packaging/catalogPackagingPalettes';
import { useLocalisation } from '@/i18n/LocaleContext';
import { customBlendMessages } from '@shop/localisation/messages/customBlend';

export type MixPart = Pick<CustomBlendOption, 'productId' | 'productName' | 'category'> & {
  percentage: number;
};

type MixSegment = MixPart & {
  colour: string;
  width: number;
  x: number;
};

const VESSEL_BODY_PATH =
  'M164 214Q148 400 156 594Q158 622 200 624L520 624Q562 622 564 594Q572 400 556 214Z';
const SEGMENT_X = 148;
const SEGMENT_WIDTH = 424;

/**
 * Stable fallback for parts which cannot be matched to a catalog palette. It is deliberately
 * local to the visualization: unresolved catalog products must never acquire a fake package
 * palette elsewhere in the storefront.
 */
export function deterministicMixColour(productId: string): string {
  let hash = 2166136261;
  for (const character of productId) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return `hsl(${(hash >>> 0) % 360} 46% 58%)`;
}

export function mixColour(part: Pick<MixPart, 'productId' | 'category'>): string {
  return (
    resolveCatalogPackagingPalette({ id: part.productId, category: part.category })?.pigment ??
    deterministicMixColour(part.productId)
  );
}

function toSegments(base: MixPart, ingredients: readonly MixPart[]): MixSegment[] {
  const parts = [base, ...ingredients.slice(0, 4)].filter(
    (part) => Number.isFinite(part.percentage) && part.percentage > 0,
  );
  const total = parts.reduce((sum, part) => sum + part.percentage, 0);
  let offset = 0;

  return parts.map((part, index) => {
    // Normalize so every non-empty state fills the vessel, including an in-progress invalid mix.
    // The final rect absorbs floating point residue to keep the clipped area exactly covered.
    const width = index === parts.length - 1 ? 100 - offset : (part.percentage / total) * 100;
    const segment = { ...part, colour: mixColour(part), width, x: offset };
    offset += width;
    return segment;
  });
}

export function MixVisualization({
  base,
  ingredients,
}: {
  base: MixPart;
  ingredients: readonly MixPart[];
}) {
  const { translate, formatCount } = useLocalisation();
  const rawId = useId().replace(/:/g, '');
  const clipId = `custom-blend-vessel-${rawId}`;
  const [activeProductId, setActiveProductId] = useState<string | null>(null);
  const segments = toSegments(base, ingredients);

  return (
    <section
      className="custom-blend-surface grid gap-3 rounded-xl p-4"
      aria-labelledby={`mix-visualization-heading-${rawId}`}
    >
      <div>
        <h2 id={`mix-visualization-heading-${rawId}`} className="text-base font-semibold">
          {translate(customBlendMessages, 'customBlend.mixProfile')}
        </h2>
        <p className="text-xs text-muted-foreground">
          {translate(customBlendMessages, 'customBlend.mixProportions')}
        </p>
      </div>
      <svg
        viewBox="0 0 720 720"
        role="img"
        aria-label={translate(customBlendMessages, 'customBlend.compositionVessel')}
        className="w-full"
      >
        <defs>
          <clipPath id={clipId}>
            <path d={VESSEL_BODY_PATH} />
          </clipPath>
        </defs>
        <ellipse cx="360" cy="638" rx="228" ry="24" fill="currentColor" opacity="0.1" />
        <path d="M164 196H556L550 222H170L164 196Z" fill="currentColor" opacity="0.18" />
        <g clipPath={`url(#${clipId})`}>
          {segments.map((segment) => {
            const isActive = activeProductId === segment.productId;
            return (
              <rect
                key={segment.productId}
                className="custom-blend-segment"
                data-product-id={segment.productId}
                data-active={isActive ? 'true' : undefined}
                x={SEGMENT_X + (segment.x / 100) * SEGMENT_WIDTH}
                y="200"
                width={(segment.width / 100) * SEGMENT_WIDTH}
                height="440"
                fill={segment.colour}
                opacity={activeProductId !== null && !isActive ? 0.45 : 1}
                role="img"
                aria-label={translate(customBlendMessages, 'customBlend.segment', {
                  name: segment.productName,
                  percentageLabel: formatCount(segment.percentage),
                })}
                tabIndex={0}
                onMouseEnter={() => setActiveProductId(segment.productId)}
                onMouseLeave={() => setActiveProductId(null)}
                onFocus={() => setActiveProductId(segment.productId)}
                onBlur={() => setActiveProductId(null)}
              >
                <title>
                  {translate(customBlendMessages, 'customBlend.segment', {
                    name: segment.productName,
                    percentageLabel: formatCount(segment.percentage),
                  })}
                </title>
              </rect>
            );
          })}
        </g>
        <path
          d={VESSEL_BODY_PATH}
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.32"
          strokeWidth="6"
          strokeLinejoin="round"
        />
      </svg>
      <ul
        className="grid gap-1 text-sm"
        aria-label={translate(customBlendMessages, 'customBlend.mixLegend')}
      >
        {segments.map((segment) => (
          <li key={segment.productId}>
            <button
              type="button"
              className="flex items-center gap-2 text-left"
              aria-pressed={activeProductId === segment.productId}
              onFocus={() => setActiveProductId(segment.productId)}
              onBlur={() => setActiveProductId(null)}
              onMouseEnter={() => setActiveProductId(segment.productId)}
              onMouseLeave={() => setActiveProductId(null)}
            >
              <i
                className="custom-blend-legend-dot"
                aria-hidden="true"
                style={{ backgroundColor: segment.colour }}
              />
              {segment.productName}{' '}
              <span className="text-muted-foreground">{formatCount(segment.percentage)}%</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
