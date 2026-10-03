import { useId } from 'react';

import { cond, condWidth, ghs, lab, MONO_FONT } from './svgText';
import type { VesselArtworkProps } from './packagingSpec';
import { productMessages } from '@shop/localisation/messages/product';
import { useLocalisation } from '@/i18n/LocaleContext';

const EDGE = '#3f3d36';
const PAPER = '#f4f2ec';
const Z_START = 164;
const Z_END = 556;
const Z_TEETH = 16;
const BODY_PATH =
  'M164 214Q148 400 156 594Q158 622 200 624L520 624Q562 622 564 594Q572 400 556 214Z';

export function WovenSackArtwork({ name, spec, ariaLabel, className }: VesselArtworkProps) {
  const { translate } = useLocalisation();
  const rawId = useId().replace(/:/g, '');
  const weaveId = `weave-${rawId}`;
  const hatchId = `hatch-${rawId}`;
  const bodyId = `body-${rawId}`;
  const { ink, alert } = spec.ink;
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
    : (ariaLabel ?? translate(productMessages, 'product.wovenSackAria', { name }));

  const zStep = (Z_END - Z_START) / Z_TEETH;
  let zig = `M${Z_START} 196`;
  for (let index = 0; index < Z_TEETH; index += 1) {
    const x = Z_START + index * zStep;
    zig += ` L${x + zStep / 2} 181 L${x + zStep} 196`;
  }

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
      <defs>
        <pattern id={weaveId} width="9" height="9" patternUnits="userSpaceOnUse">
          <rect width="9" height="9" fill="#eeebe3" />
          <path d="M0 4.5H9" stroke="#ddd9cd" strokeWidth="2.4" />
          <path d="M4.5 0V9" stroke="#e6e2d8" strokeWidth="2.4" />
        </pattern>
        <pattern
          id={hatchId}
          width="18"
          height="18"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect width="18" height="18" fill={PAPER} />
          <rect width="9" height="18" fill={ink} />
        </pattern>
        <clipPath id={bodyId}>
          <path d={BODY_PATH} />
        </clipPath>
      </defs>
      <ellipse cx="360" cy="638" rx="228" ry="24" fill="#2a2721" opacity="0.13" />
      <path
        d={`${zig} L${Z_END} 216 L${Z_START} 216Z`}
        fill="#dcd8cc"
        stroke={EDGE}
        strokeWidth="4"
        strokeLinejoin="round"
      />
      <path
        d={BODY_PATH}
        fill={`url(#${weaveId})`}
        stroke={EDGE}
        strokeWidth="6"
        strokeLinejoin="round"
      />

      <g clipPath={`url(#${bodyId})`}>
        <rect x="120" y="300" width="480" height="132" fill={ink} />
        {cond(184, 358, line1, 50, condWidth(line1, 26, 60, 316), '#fff')}
        {line2 && cond(184, 410, line2, 50, condWidth(line2, 26, 60, 316), '#fff')}
        {spec.grade &&
          lab(540, 420, spec.grade, 11, '#fff', 1.4, {
            anchor: 'end',
            opacity: 0.8,
            // `grade` is `GardenFacts.npk` (contract max 50 chars) -- width-constrained to the
            // knockout band's left edge (x=120) per the same-class overflow risk as R4-F1.
            width: condWidth(spec.grade, 8, 40, 400),
          })}
        <rect x="120" y="536" width="480" height="20" fill={`url(#${hatchId})`} />
      </g>

      {lab(186, 262, spec.brand, 11.5, ink, 1.9)}
      {lab(186, 284, spec.sub.toUpperCase(), 10, ink, 1.5, { opacity: 0.6 })}

      {/*
       * Decorative material chip beside the LOT/coverage panel: above the coverage line (y=512) and
       * right of the LOT code column, inside the sack body but clear of every printed string.
       */}
      <g aria-hidden="true" data-pigment={spec.pigment}>
        <circle cx="536" cy="456" r="10" fill={spec.pigment} stroke={ink} strokeWidth="1.5" />
      </g>

      {lab(186, 460, translate(productMessages, 'product.netWeight'), 9.5, ink, 1.4, {
        opacity: 0.7,
      })}
      {spec.netWeight &&
        cond(184, 512, spec.netWeight, 62, condWidth(spec.netWeight, 20, 50, 128), ink)}
      <path d="M336 442V522" stroke={ink} strokeWidth="1.5" opacity="0.35" />
      {lab(356, 460, translate(productMessages, 'product.lot'), 9.5, ink, 1.4, {
        opacity: 0.7,
      })}
      <text x="356" y="486" fontFamily={MONO_FONT} fontSize="15" fontWeight="700" fill={ink}>
        {spec.lot}
      </text>
      {spec.yield &&
        lab(356, 512, spec.yield.toUpperCase(), 9.5, ink, 0.9, {
          opacity: 0.75,
          // `yield` is `GardenFacts.coverage` (contract max 200 chars, real catalog worst case
          // ~75 chars) -- width-constrained to the remaining panel width right of the LOT column.
          width: condWidth(spec.yield, 7, 40, 344),
        })}

      {ghs(226, 590, 24, alert, PAPER)}
      {hazard &&
        lab(262, 586, hazard.toUpperCase(), 8.5, ink, 0.8, {
          // `hazard` here is `GardenFacts.handling` (contract max 500 chars, real catalog worst
          // case ~180 chars) -- width-constrained to the remaining canvas width right of the GHS
          // pictogram per R4-F1.
          width: condWidth(hazard, 5, 40, 420),
        })}
      {lab(262, 602, translate(productMessages, 'product.ppeRequiredSee'), 7.5, ink, 0.7, {
        opacity: 0.7,
      })}
    </svg>
  );
}
