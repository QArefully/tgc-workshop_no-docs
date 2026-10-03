import { useId, type CSSProperties } from 'react';
import { productMessages } from '@shop/localisation/messages/product';
import { useLocalisation } from '@/i18n/LocaleContext';

export type BagArtworkPaint = {
  kind: 'linear-gradient';
  colors: readonly [string, string];
};

export interface BagArtworkProps {
  name: string;
  category: string;
  quantity: string;
  batchCode: string;
  mark: string;
  accent?: string;
  powderAccent?: string;
  /**
   * Stable key of the decorative catalog scheme these colours came from, exposed on the root SVG as
   * `data-colour-scheme` for deterministic tests and browser inspection. Optional: explicit legacy
   * `product.packaging` colours do not come from the scheme registry and omit it.
   */
  schemeKey?: string;
  paint?: BagArtworkPaint;
  consumptionLabel: string | null;
  ariaLabel?: string;
  className?: string;
  style?: CSSProperties;
}

function ProductLabel({
  name,
  category,
  quantity,
  batchCode,
  mark,
  accent = '#9fb3aa',
  consumptionLabel,
  netQuantityLabel,
  batchLabel,
}: Omit<BagArtworkProps, 'ariaLabel' | 'className' | 'style' | 'powderAccent' | 'schemeKey'> & {
  netQuantityLabel: string;
  batchLabel: string;
}) {
  const normalizedName = name.trim().toUpperCase() || 'MATERIAL';
  const titleWords = normalizedName.split(/\s+/);
  const splitIndex =
    titleWords.length > 1
      ? Array.from({ length: titleWords.length - 1 }, (_, index) => index + 1).reduce(
          (best, candidate) => {
            const difference = Math.abs(
              titleWords.slice(0, candidate).join(' ').length -
                titleWords.slice(candidate).join(' ').length,
            );
            const bestDifference = Math.abs(
              titleWords.slice(0, best).join(' ').length - titleWords.slice(best).join(' ').length,
            );
            return difference < bestDifference ? candidate : best;
          },
          1,
        )
      : 1;
  const titleLines =
    titleWords.length > 1
      ? [titleWords.slice(0, splitIndex).join(' '), titleWords.slice(splitIndex).join(' ')]
      : [titleWords[0] ?? normalizedName];
  const longestTitleLine = Math.max(...titleLines.map((line) => line.length));
  const titleSize = longestTitleLine > 15 ? 18 : longestTitleLine > 12 ? 21 : 25;

  return (
    <svg x="215" y="270" width="290" height="214" viewBox="0 0 320 236">
      <rect width="320" height="236" rx="8" fill={accent} stroke="#242522" strokeWidth="5" />
      <rect x="3" y="3" width="314" height="36" rx="5" fill="#292b29" />
      <text
        x="18"
        y="27"
        fill="#fffaf0"
        fontFamily="Arial, sans-serif"
        fontSize="14"
        fontWeight="800"
        letterSpacing="1.5"
      >
        QAREFULLY MATERIALS EXCHANGE
      </text>
      <circle cx="53" cy="91" r="26" fill="#dcecf0" stroke="#fffaf0" strokeWidth="3" />
      <text
        x="53"
        y="97"
        textAnchor="middle"
        fill="#20211f"
        fontFamily="Arial, sans-serif"
        fontSize="15"
        fontWeight="900"
      >
        {mark}
      </text>
      <text
        x="91"
        y="76"
        fill="#fffaf0"
        fontFamily="Arial, sans-serif"
        fontSize={titleSize}
        fontWeight="900"
        letterSpacing="-0.5"
      >
        {titleLines[0]}
      </text>
      {titleLines[1] && (
        <text
          x="91"
          y="103"
          fill="#fffaf0"
          fontFamily="Arial, sans-serif"
          fontSize={Math.min(29, titleSize + 3)}
          fontWeight="900"
          letterSpacing="-0.5"
        >
          {titleLines[1]}
        </text>
      )}
      <text
        x="92"
        y="124"
        fill="#c9cbc6"
        fontFamily="Arial, sans-serif"
        fontSize="11"
        fontWeight="800"
        letterSpacing="1.7"
      >
        {category.toUpperCase()}
      </text>
      <path d="M18 143H302" stroke="#c9cbc6" strokeWidth="2" />
      <text
        x="19"
        y="164"
        fill="#c9cbc6"
        fontFamily="Arial, sans-serif"
        fontSize="9"
        fontWeight="800"
      >
        {netQuantityLabel}
      </text>
      <text
        x="19"
        y="181"
        fill="#fffaf0"
        fontFamily="Arial, sans-serif"
        fontSize="13"
        fontWeight="900"
      >
        {quantity.toUpperCase()}
      </text>
      <text
        x="183"
        y="164"
        fill="#c9cbc6"
        fontFamily="Arial, sans-serif"
        fontSize="9"
        fontWeight="800"
      >
        {batchLabel}
      </text>
      <text
        x="183"
        y="181"
        fill="#fffaf0"
        fontFamily="Arial, sans-serif"
        fontSize="13"
        fontWeight="900"
      >
        {batchCode}
      </text>
      {consumptionLabel && (
        <>
          <rect x="18" y="195" width="284" height="25" rx="3" fill={accent} />
          <text
            x="160"
            y="212"
            textAnchor="middle"
            fill="#20211f"
            fontFamily="Arial, sans-serif"
            fontSize="10"
            fontWeight="900"
            letterSpacing="1.1"
          >
            {consumptionLabel.toUpperCase()}
          </text>
        </>
      )}
    </svg>
  );
}

/** Locked live SVG packaging design used for canonical catalog products. */
export function BagArtwork({
  name,
  category,
  quantity,
  batchCode,
  mark,
  accent = '#9fb3aa',
  powderAccent = accent,
  schemeKey,
  paint,
  consumptionLabel,
  ariaLabel,
  className,
  style,
}: BagArtworkProps) {
  const paintId = `bag-art-paint-${useId().replace(/:/g, '')}`;
  const { translate } = useLocalisation();
  const labelPaint = paint ? `url(#${paintId})` : accent;

  return (
    <svg
      viewBox="0 0 720 720"
      role={ariaLabel === '' ? undefined : 'img'}
      aria-hidden={ariaLabel === '' ? true : undefined}
      aria-label={
        ariaLabel === ''
          ? undefined
          : (ariaLabel ?? translate(productMessages, 'product.bagAria', { name }))
      }
      className={className}
      style={style}
      data-colour-scheme={schemeKey}
      xmlns="http://www.w3.org/2000/svg"
    >
      {paint && (
        <defs>
          <linearGradient id={paintId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={paint.colors[0]} />
            <stop offset="100%" stopColor={paint.colors[1]} />
          </linearGradient>
        </defs>
      )}
      <ellipse cx="360" cy="632" rx="226" ry="30" fill="#252722" opacity="0.12" />
      <path
        d="M158 158L192 80H528L562 158L579 592Q579 622 551 630Q360 655 169 630Q141 622 141 592Z"
        fill="#e7e0d2"
        stroke="#333530"
        strokeWidth="7"
      />
      <path d="M192 80H528L562 158H158Z" fill="#f3efe7" stroke="#333530" strokeWidth="7" />
      <path d="M174 130H546" stroke="#c5bbac" strokeWidth="5" />
      <path d="M562 159L579 592L532 574" fill="#d6cdbf" stroke="#333530" strokeWidth="5" />
      <path d="M185 584Q360 614 532 574" fill="none" stroke="#bdb3a4" strokeWidth="5" />
      {/* Decorative pigment sample: geometry unchanged, filled from the resolved scheme pigment. */}
      <g fill={powderAccent} aria-hidden="true" data-pigment={powderAccent}>
        <ellipse cx="330" cy="544" rx="76" ry="25" opacity="0.65" />
        <ellipse cx="399" cy="548" rx="88" ry="28" opacity="0.9" />
      </g>
      <ProductLabel
        {...{
          name,
          category,
          quantity,
          batchCode,
          mark,
          accent: labelPaint,
          consumptionLabel,
          netQuantityLabel: translate(productMessages, 'product.netQuantity'),
          batchLabel: translate(productMessages, 'product.batch'),
        }}
      />
    </svg>
  );
}
