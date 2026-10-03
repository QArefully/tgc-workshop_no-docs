import { cond, condWidth, ghs, lab, MONO_FONT } from './svgText';
import type { VesselArtworkProps } from './packagingSpec';
import { productMessages } from '@shop/localisation/messages/product';
import { useLocalisation } from '@/i18n/LocaleContext';

const KRAFT = '#c9ae83';
const SHADE = '#b3966d';
const EDGE = '#3a3128';
const PAPER = '#f2efe7';

export function KraftSackArtwork({ name, spec, ariaLabel, className }: VesselArtworkProps) {
  const { ink, alert } = spec.ink;
  const { translate } = useLocalisation();
  const hazard =
    spec.hazard === 'Not for consumption'
      ? translate(productMessages, 'product.notForConsumption')
      : spec.hazard === 'Caution -- handle with protective equipment'
        ? translate(productMessages, 'product.cautionHandling')
        : spec.hazard;
  const [line1 = '', line2] = spec.titleLines;
  const decorative = ariaLabel === '';
  const label = decorative
    ? undefined
    : (ariaLabel ?? translate(productMessages, 'product.kraftSackAria', { name }));

  return (
    <svg
      viewBox="0 0 720 720"
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative ? true : undefined}
      aria-label={label}
      className={className}
      data-colour-scheme={spec.schemeKey}
      xmlns="http://www.w3.org/2000/svg"
    >
      <ellipse cx="362" cy="634" rx="248" ry="26" fill="#2a2721" opacity="0.13" />
      <path
        d="M150 186 154 176 178 200Z"
        fill={SHADE}
        stroke={EDGE}
        strokeWidth="5"
        strokeLinejoin="round"
      />
      <path
        d="M570 186 566 176 542 200Z"
        fill={SHADE}
        stroke={EDGE}
        strokeWidth="5"
        strokeLinejoin="round"
      />
      <path
        d="M158 232Q126 386 140 558Q144 610 196 616L524 616Q576 610 580 558Q594 386 562 232Z"
        fill={KRAFT}
        stroke={EDGE}
        strokeWidth="6"
        strokeLinejoin="round"
      />
      <path d="M150 556Q360 596 570 556" fill="none" stroke={SHADE} strokeWidth="5" />
      <path d="M152 300Q360 322 568 300" fill="none" stroke={SHADE} strokeWidth="3" opacity="0.5" />
      <path
        d="M150 186H570L562 234H158Z"
        fill={SHADE}
        stroke={EDGE}
        strokeWidth="6"
        strokeLinejoin="round"
      />
      <path
        d="M170 210H550"
        stroke="#6d5a42"
        strokeWidth="5"
        strokeDasharray="11 9"
        strokeLinecap="round"
      />

      {lab(194, 268, spec.brand, 10.5, ink, 1.4)}
      {spec.grade &&
        cond(544, 268, spec.grade, 12, condWidth(spec.grade, 7, 40, 220), ink, { anchor: 'end' })}
      <path d="M194 280H544" stroke={ink} strokeWidth="3" />

      {/*
       * Decorative material chip printed in the blank band between the header rule (y=280) and the
       * title cap line (~y=306); right-aligned under the grade column so it never sits over copy.
       * cy/r are tuned so the chip's stroked extent (283.25..300.75) clears both the header rule
       * above and the title cap line plus the decorative fold curve (y~302 at x=548) below, which
       * the narrow-font fallbacks would otherwise collide with.
       */}
      <g aria-hidden="true" data-pigment={spec.pigment}>
        <circle cx="548" cy="292" r="8" fill={spec.pigment} stroke={ink} strokeWidth="1.5" />
      </g>

      {cond(190, 356, line1, 66, condWidth(line1, 34, 60, 356) + 2, alert, { opacity: 0.22 })}
      {cond(188, 354, line1, 66, condWidth(line1, 34, 60, 356), ink)}
      {line2 &&
        cond(190, 414, line2, 66, condWidth(line2, 34, 60, 356) + 2, alert, { opacity: 0.22 })}
      {line2 && cond(188, 412, line2, 66, condWidth(line2, 34, 60, 356), ink)}
      {lab(190, 440, spec.sub.toUpperCase(), 11.5, ink, 1.8, { opacity: 0.75 })}
      <path d="M190 456H556" stroke={ink} strokeWidth="1.5" opacity="0.55" />

      {ghs(224, 520, 30, alert, PAPER)}
      <rect
        x="268"
        y="492"
        width="120"
        height="27"
        fill="none"
        stroke={ink}
        strokeWidth="1.5"
        opacity="0.6"
      />
      <text x="278" y="511" fontFamily={MONO_FONT} fontSize="14" fontWeight="700" fill={ink}>
        {spec.lot}
      </text>
      {lab(268, 542, translate(productMessages, 'product.productionLot'), 9, ink, 1.2, {
        opacity: 0.7,
      })}

      {lab(556, 486, translate(productMessages, 'product.netWeight'), 10, ink, 1.6, {
        anchor: 'end',
      })}
      {spec.netWeight &&
        cond(556, 552, spec.netWeight, 74, condWidth(spec.netWeight, 22, 60, 152), ink, {
          anchor: 'end',
        })}
      {hazard &&
        lab(190, 586, hazard.toUpperCase(), 9.5, ink, 0.9, {
          opacity: 0.85,
          // `hazard` here is `TradeFacts.ppe.join(', ')`, unbounded prose (up to 10 items x 200
          // chars in the contract, real catalog worst case ~120 chars) -- width-constrained to the
          // sack's printable panel (x=190 up to the right-hand NET WEIGHT column) per R4-F1.
          width: condWidth(hazard, 3, 40, 370),
        })}
    </svg>
  );
}
