/**
 * Vector marks for the sign-in screen.
 * SVGs inherit `currentColor`, scale with the layout, and stay crisp on any display.
 */

type GlyphProps = {
  className?: string;
};

/** SoundCloud-style cloud mark (brand / CTA / manual toggle). */
export function CloudGlyph({ className }: GlyphProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M17.4 18.75H7.1a4.85 4.85 0 0 1-.55-9.67A6.35 6.35 0 0 1 18.75 10.9a4.4 4.4 0 0 1-1.35 7.85Z"
      />
    </svg>
  );
}

/** Chevron for the manual-setup accordion. */
export function ChevronGlyph({ className }: GlyphProps) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true" focusable="false">
      <path
        d="M3.5 6.2 8 10.5l4.5-4.3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Five-bar waveform, painted with the surrounding text color. */
export function WaveGlyph({ className }: GlyphProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
      <g fill="currentColor">
        <rect x="2.4" y="9.5" width="2.4" height="5" rx="1.2" />
        <rect x="6.6" y="7" width="2.4" height="10" rx="1.2" />
        <rect x="10.8" y="4" width="2.4" height="16" rx="1.2" />
        <rect x="15" y="7" width="2.4" height="10" rx="1.2" />
        <rect x="19.2" y="9.5" width="2.4" height="5" rx="1.2" />
      </g>
    </svg>
  );
}

/** Accent tile with the waveform cut out of it. The tile itself is styled by CSS. */
export function BrandMark({ className }: GlyphProps) {
  return (
    <span className={`auth-brand-mark${className ? ` ${className}` : ''}`}>
      <WaveGlyph className="auth-brand-wave" />
    </span>
  );
}

/** Check mark for the feature list. */
export function CheckGlyph({ className }: GlyphProps) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true" focusable="false">
      <path d="M3.2 8.7 6.3 11.8 12.8 4.8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Diagonal arrow used by the primary call to action. */
export function ArrowUpRightGlyph({ className }: GlyphProps) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true" focusable="false">
      <path d="M5 11 11 5M6.2 5H11v4.8" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Four-point sparkle for the wordmark footer. */
export function SparkleGlyph({ className }: GlyphProps) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true" focusable="false">
      <path d="M8 1.5c.5 3 1.5 4 4.5 4.5-3 .5-4 1.5-4.5 4.5-.5-3-1.5-4-4.5-4.5 3-.5 4-1.5 4.5-4.5Z" fill="currentColor" />
    </svg>
  );
}
