import { useEffect, useState } from 'react';
import type {
  CustomBlendEvaluationResponse,
  CustomBlendOption,
  CustomBlendSnapshot,
  ResolvedCustomBlendSnapshot,
} from '@shop/contracts/custom-blends';
import { CustomBlendPackaging, customBlendCompositionLabel } from './CustomBlendPackaging';
import { useLocalisation } from '@/i18n/LocaleContext';
import { customBlendMessages } from '@shop/localisation/messages/customBlend';

export type PreviewIngredient = {
  option: CustomBlendOption;
  percentage: number;
};

export type CustomBlendPreviewProps = {
  base: CustomBlendOption;
  basePercentage: number;
  ingredients: readonly PreviewIngredient[];
  /** Latest successful server verdict; its snapshot owns the rendered blend facts. */
  resolved?: ResolvedCustomBlendSnapshot | null;
  /** Alias for callers that retain the complete evaluation response from the evaluation hook. */
  evaluation?: CustomBlendEvaluationResponse | null;
  /**
   * A server-issued key for the composition currently being shown. This is intentionally not the
   * edit target key: replacing a blend may produce a different composition and therefore a
   * different key.
   */
  authoritativeConfigKey?: string;
  /**
   * Kept temporarily for callers that still pass the edit target. It is deliberately ignored:
   * an old cart-line key must never be presented as the mark for an edited draft.
   * @deprecated Use authoritativeConfigKey only after the server has returned that key.
   */
  configKey?: string;
  className?: string;
};

function previewProduct(base: CustomBlendOption) {
  return {
    id: base.productId,
    name: base.productName,
    category: base.category,
    consumptionClassification: base.consumptionClassification,
    categoryFacts: base.categoryFacts,
    mixingGroup: base.mixingGroup,
  };
}

/** A render-only shape. It is never submitted or presented as a persisted server snapshot. */
export function toPreviewBlend({
  base,
  basePercentage,
  ingredients,
  authoritativeConfigKey,
  resolved,
  evaluation,
}: Omit<CustomBlendPreviewProps, 'className'>): CustomBlendSnapshot {
  const serverSnapshot = resolved ?? evaluation?.customBlend ?? null;
  if (serverSnapshot) return serverSnapshot;
  return {
    // Required by the transport type. Drafts use a non-authoritative sentinel and render
    // `CB-PREVIEW`; only a fresh server key is allowed to produce a batch mark.
    configKey: authoritativeConfigKey ?? '0'.repeat(64),
    basePercentage,
    mixingGroup: base.mixingGroup,
    ingredients: ingredients.map(({ option, percentage }) => ({
      variantId: option.variant.variantId,
      productId: option.productId,
      productName: option.productName,
      productDescription: option.productDescription,
      mixingGroup: option.mixingGroup,
      percentage,
    })),
    blendingFeeCents: 0,
    madeToOrder: true,
    returnable: false,
  };
}

export function CustomBlendPreview(props: CustomBlendPreviewProps) {
  const { country, translate } = useLocalisation();
  const blend = toPreviewBlend(props);
  const isDraft =
    !props.authoritativeConfigKey && !props.resolved && !props.evaluation?.customBlend;
  const [zoomed, setZoomed] = useState(false);
  const [origin, setOrigin] = useState('50% 50%');
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setPrefersReducedMotion(query.matches);
    update();
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);
  useEffect(() => {
    if (!zoomed) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setZoomed(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [zoomed]);
  return (
    <section
      className={`custom-blend-notice grid gap-3 rounded-xl p-4 ${props.className ?? ''}`}
      aria-labelledby="custom-blend-preview-heading"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="custom-blend-preview-heading" className="text-sm font-semibold">
          {translate(customBlendMessages, 'customBlend.livePreview')}
        </h2>
        <span className="text-xs text-muted-foreground">
          {translate(
            customBlendMessages,
            isDraft ? 'customBlend.draftMark' : 'customBlend.confirmedBatchMark',
          )}
        </span>
      </div>
      <button
        type="button"
        className="relative cursor-zoom-in overflow-hidden rounded-lg"
        aria-label={translate(
          customBlendMessages,
          zoomed ? 'customBlend.resetPreviewZoom' : 'customBlend.zoomPreview',
        )}
        aria-pressed={zoomed}
        onClick={() => setZoomed((value) => !value)}
        onPointerMove={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          if (
            bounds.width === 0 ||
            bounds.height === 0 ||
            !Number.isFinite(event.clientX) ||
            !Number.isFinite(event.clientY)
          ) {
            return;
          }
          const x = Math.max(
            0,
            Math.min(100, ((event.clientX - bounds.left) / bounds.width) * 100),
          );
          const y = Math.max(
            0,
            Math.min(100, ((event.clientY - bounds.top) / bounds.height) * 100),
          );
          setOrigin(`${x}% ${y}%`);
        }}
      >
        <div
          className="motion-reduce:transform-none"
          style={{
            transform: zoomed && !prefersReducedMotion ? 'scale(1.5)' : undefined,
            transformOrigin: origin,
            transition: prefersReducedMotion
              ? 'none'
              : 'transform var(--custom-blend-motion-duration) ease',
          }}
        >
          <CustomBlendPackaging
            product={previewProduct(props.base)}
            variant={props.base.variant}
            blend={blend}
            previewBatchMark={isDraft ? 'CB-PREVIEW' : undefined}
            className="mx-auto h-64 w-full max-w-52"
          />
        </div>
      </button>
      <p className="text-xs text-muted-foreground">
        {customBlendCompositionLabel(props.base.productName, blend, country)}
      </p>
    </section>
  );
}
