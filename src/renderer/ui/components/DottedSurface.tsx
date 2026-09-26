import { useEffect, useRef } from 'react';
import * as THREE from 'three';

type DottedSurfaceProps = {
  className?: string;
  size?: number;
  opacity?: number;
  sizeAttenuation?: boolean;
  vertexColors?: boolean;
  /**
   * Doubles as the fog colour, so distant points fade into the background instead of
   * being clipped by the far plane. The canvas itself stays transparent and the layer
   * behind it supplies the gradient.
   */
  fogColor?: number;
  /** Point colour used when `vertexColors` is off, and the colour in dark mode. */
  pointColor?: number;
};

const SEPARATION = 150;
const AMOUNTX = 40;
const AMOUNTY = 60;
/** Matches the far plane of the camera below. */
const FOG_NEAR = 2000;
const FOG_FAR = 10000;
const MAX_PIXEL_RATIO = 2;

/**
 * Animated dotted plane driven by two sine waves, the same geometry as the reference
 * component: a 40x60 lattice that ripples as the camera looks across it.
 *
 * The scene is created once and kept for the lifetime of the component. Re-creating it
 * whenever a prop changed would throw away and rebuild the WebGL context, which shows up
 * as a visible hitch on every settings change, so the material is updated in place instead.
 */
export function DottedSurface({
  className,
  size = 8,
  opacity = 0.8,
  sizeAttenuation = true,
  vertexColors = true,
  fogColor = 0x0a0c10,
  pointColor = 0xc8c8c8,
}: DottedSurfaceProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const materialRef = useRef<THREE.PointsMaterial | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    } catch {
      // No WebGL: the layer keeps its gradient background instead of failing the panel.
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
    renderer.setClearColor(fogColor, 0);
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(fogColor, FOG_NEAR, FOG_FAR);

    const camera = new THREE.PerspectiveCamera(60, 1, 1, FOG_FAR);
    camera.position.set(0, 355, 1220);

    const positions: number[] = [];
    const colors: number[] = [];
    for (let ix = 0; ix < AMOUNTX; ix += 1) {
      for (let iy = 0; iy < AMOUNTY; iy += 1) {
        positions.push(
          ix * SEPARATION - (AMOUNTX * SEPARATION) / 2,
          0,
          iy * SEPARATION - (AMOUNTY * SEPARATION) / 2,
        );
        // Every vertex carries the same colour, so the lattice fades evenly into the fog.
        colors.push(pointColor, pointColor, pointColor);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size,
      vertexColors,
      color: vertexColors ? 0xffffff : pointColor,
      transparent: true,
      opacity,
      sizeAttenuation,
    });
    materialRef.current = material;

    const points = new THREE.Points(geometry, material);
    scene.add(points);

    const resize = () => {
      const { width, height } = container.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);

    // Windows reports prefers-reduced-motion whenever "animations" are switched off in the
    // system settings, which is common. Freezing the surface on that signal made it read as a
    // broken image rather than a calm background, so the wave keeps moving far more slowly
    // instead: the movement is low-contrast and slow either way.
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const waveSpeed = reduceMotion ? 0.01 : 0.1;
    let count = 0;
    let animationId = 0;

    const applyWave = () => {
      const attribute = geometry.attributes.position;
      const array = attribute.array as Float32Array;
      let index = 0;
      for (let ix = 0; ix < AMOUNTX; ix += 1) {
        for (let iy = 0; iy < AMOUNTY; iy += 1) {
          const offset = index * 3;
          array[offset + 1] = Math.sin((ix + count) * 0.3) * 50 + Math.sin((iy + count) * 0.5) * 50;
          index += 1;
        }
      }
      attribute.needsUpdate = true;
    };

    const render = () => {
      renderer.render(scene, camera);
    };

    applyWave();
    render();

    const loop = () => {
      animationId = window.requestAnimationFrame(loop);
      applyWave();
      render();
      count += waveSpeed;
    };
    animationId = window.requestAnimationFrame(loop);

    return () => {
      window.cancelAnimationFrame(animationId);
      observer.disconnect();
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
      materialRef.current = null;
    };
  }, [fogColor, pointColor]);

  // Settings are applied in place: no new context, no flash.
  useEffect(() => {
    const material = materialRef.current;
    if (!material) return;
    material.size = size;
    material.opacity = opacity;
    material.sizeAttenuation = sizeAttenuation;
    material.vertexColors = vertexColors;
    material.color.set(vertexColors ? 0xffffff : pointColor);
    material.needsUpdate = true;
  }, [size, opacity, sizeAttenuation, vertexColors, pointColor]);

  return <div ref={containerRef} className={className} aria-hidden="true" />;
}

export default DottedSurface;
