import { useEffect, useState, type CSSProperties } from 'react';
import { useStore } from '../lib/util';
import { theme, type BgSpec } from '../state/theme';
import { appearance } from '../state/appearance';

function meshCss(s: BgSpec) {
  const [a, b, c, d] = s.colors;
  return [
    `radial-gradient(62% 70% at 12% 14%, ${a} 0%, transparent 72%)`,
    `radial-gradient(52% 60% at 88% 10%, ${b} 0%, transparent 70%)`,
    `radial-gradient(60% 66% at 78% 88%, ${c} 0%, transparent 72%)`,
    `radial-gradient(48% 56% at 18% 92%, ${d} 0%, transparent 70%)`,
    s.base,
  ].join(',');
}

function Layer({ spec, onDone }: { spec: BgSpec; onDone: () => void }) {
  const style: CSSProperties = spec.kind === 'mesh' ? { background: meshCss(spec) } : { background: spec.base };
  return (
    <div className="bg-layer" style={style} onAnimationEnd={(e) => e.target === e.currentTarget && onDone()}>
      {spec.kind === 'image' && spec.image && (
        <img src={spec.image} alt="" decoding="async" style={{ filter: spec.blur ? `blur(${spec.blur}px) saturate(1.35)` : undefined }} />
      )}
      <div className="bg-dim" style={{ background: spec.dim }} />
    </div>
  );
}

/** Cross-fading background layer behind all glass panels. */
export function Background() {
  const bg = useStore(theme, (s) => s.bg);
  const [layers, setLayers] = useState<BgSpec[]>(() => (bg ? [bg] : []));
  useEffect(() => {
    if (!bg) return;
    setLayers((ls) => {
      const top = ls[ls.length - 1];
      if (top?.key === bg.key) return [...ls.slice(0, -1), bg];
      return [...ls.slice(-2), bg];
    });
  }, [bg]);
  return (
    <div className="bg-root" aria-hidden="true">
      {layers.map((l, i) => (
        <Layer key={l.key} spec={l} onDone={() => i === layers.length - 1 && setLayers((ls) => ls.slice(ls.indexOf(l)))} />
      ))}
    </div>
  );
}

/** SVG displacement filter that gives Liquid Glass its refraction (Chromium / Firefox). */
export function SvgDefs() {
  const r = useStore(appearance, (s) => s.refraction);
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" focusable="false">
      <filter id="lg-distort" x="0%" y="0%" width="100%" height="100%" colorInterpolationFilters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency="0.007 0.011" numOctaves={2} seed={7} result="noise" />
        <feGaussianBlur in="noise" stdDeviation="2.5" result="soft" />
        <feDisplacementMap in="SourceGraphic" in2="soft" scale={Math.round(r * 1.3)} xChannelSelector="R" yChannelSelector="G" />
      </filter>
    </svg>
  );
}
