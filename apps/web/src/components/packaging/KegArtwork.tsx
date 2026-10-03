import { cond, condWidth, irritant, lab, UI_FONT } from './svgText';
import type { VesselArtworkProps } from './packagingSpec';
import { productMessages } from '@shop/localisation/messages/product';
import { useLocalisation } from '@/i18n/LocaleContext';

const EDGE = '#33403f';
const SHELL = '#e7e9e4';

export function KegArtwork({ name, spec, ariaLabel, className }: VesselArtworkProps) {
  const { ink, alert } = spec.ink;
  const { translate } = useLocalisation();
  const tone = spec.tone ?? 'corrosive';
  const stripeFill = tone === 'corrosive' ? alert : ink;
  const [line1 = '', line2] = spec.titleLines;
  const decorative = ariaLabel === '';
  const label = decorative
    ? undefined
    : (ariaLabel ?? translate(productMessages, 'product.kegAria', { name }));

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
      <ellipse cx="360" cy="646" rx="182" ry="18" fill="#232a26" opacity="0.14" />

      <rect
        x="286"
        y="150"
        width="148"
        height="46"
        rx="8"
        fill={alert}
        stroke={EDGE}
        strokeWidth="5"
      />
      <path
        d="M300 156V190M318 156V190M336 156V190M354 156V190M372 156V190M390 156V190M408 156V190"
        stroke="#7d2712"
        strokeWidth="3"
        opacity="0.55"
      />
      <rect
        x="292"
        y="196"
        width="136"
        height="16"
        rx="4"
        fill="#c9cbc5"
        stroke={EDGE}
        strokeWidth="4"
      />
      <path
        d="M300 212Q212 244 202 316V600Q202 632 240 632H480Q518 632 518 600V316Q508 244 420 212Z"
        fill={SHELL}
        stroke={EDGE}
        strokeWidth="6"
        strokeLinejoin="round"
      />
      <path d="M210 296Q360 322 510 296" fill="none" stroke="#c9cbc5" strokeWidth="4" />
      <path d="M210 606Q360 626 510 606" fill="none" stroke="#c9cbc5" strokeWidth="4" />

      <rect
        x="222"
        y="322"
        width="276"
        height="272"
        fill="#fbfbf8"
        stroke={alert}
        strokeWidth="4"
      />

      {/* Signature stripe: full alert ink for the corrosive tone, category ink for the mild tone. */}
      <rect x="222" y="322" width="46" height="272" fill={stripeFill} />
      {tone === 'corrosive' ? (
        <g
          transform="translate(245 372)"
          stroke="#fff"
          strokeWidth="2.6"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M-13-18 -3-24 6-8 -4-2Z" />
          <path d="M-1-1 1 7M5 0 8 8" />
          <path d="M-14 16H14" />
          <path d="M-4 16 0 24 4 16" />
        </g>
      ) : (
        irritant(245, 400, 16, '#fff', stripeFill)
      )}
      {tone === 'corrosive' && (
        <text
          transform="translate(251 546) rotate(-90)"
          fontFamily={UI_FONT}
          fontSize="12"
          fontWeight="700"
          letterSpacing="3.4"
          fill="#fff"
        >
          {translate(productMessages, 'product.corrosive')}
        </text>
      )}

      {/*
       * Decorative material chip in the white label panel's top-right corner, right of the brand
       * line. Deliberately outside the danger stripe, pictogram and DANGER band, which stay
       * safety-owned and never take a scheme colour.
       */}
      <g aria-hidden="true" data-pigment={spec.pigment}>
        <circle cx="478" cy="344" r="10" fill={spec.pigment} stroke={ink} strokeWidth="1.5" />
      </g>

      {/*
       * Width-bounded: the brand line shares its baseline with the pigment chip (x 467.25..488.75),
       * and `PACKAGING_BRAND` at its natural width reaches ~x=473, overprinting the chip. 168px ends
       * the line at x=452, clear of the chip, without moving either element.
       */}
      {lab(284, 348, spec.brand, 8.5, ink, 1.3, { opacity: 0.7, width: 168 })}
      {cond(282, 394, line1, 40, condWidth(line1, 20, 50, 200), ink)}
      {line2 && cond(282, 434, line2, 40, condWidth(line2, 20, 50, 200), ink)}
      {spec.grade &&
        cond(284, 454, spec.grade.toUpperCase(), 8.5, condWidth(spec.grade, 5, 40, 200), ink, {
          opacity: 0.75,
        })}

      {tone === 'corrosive' && spec.never && (
        <>
          <rect x="284" y="464" width="200" height="40" fill={alert} />
          {lab(292, 480, translate(productMessages, 'product.danger'), 9, '#fff', 2, {
            opacity: 0.85,
          })}
          {lab(292, 496, spec.never.toUpperCase(), 9, '#fff', 0.7, {
            // `never` is extracted "Do not"/"Never" clause(s) from `CleaningFacts.hazardStatement`
            // (contract max 500 chars total, so theoretically the whole statement) -- width
            // constrained to the DANGER band's own 200px rect (x=284..484) per R4-F1.
            width: condWidth(spec.never, 6, 40, 184),
          })}
        </>
      )}

      {spec.dose && (
        <>
          {lab(284, 522, translate(productMessages, 'product.dose'), 8, ink, 1.3, {
            opacity: 0.65,
          })}
          {cond(284, 540, spec.dose, 10, condWidth(spec.dose, 6, 40, 200), ink)}
        </>
      )}
      <path d="M284 556H484" stroke={ink} strokeWidth="1.3" opacity="0.35" />
      {lab(284, 580, `${translate(productMessages, 'product.lot')} ${spec.lot}`, 9, ink, 0.8, {
        opacity: 0.7,
      })}
      {lab(414, 580, translate(productMessages, 'product.netWeight'), 8, ink, 1.3, {
        anchor: 'end',
        opacity: 0.65,
      })}
      {spec.netWeight &&
        cond(484, 582, spec.netWeight, 32, condWidth(spec.netWeight, 12, 30, 66), ink, {
          anchor: 'end',
        })}
    </svg>
  );
}
