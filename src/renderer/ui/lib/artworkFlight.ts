/**
 * Shared-element "flight" helper for the lyrics sidebar.
 *
 * The track artwork has to leave the track page and land inside the sidebar, so it cannot simply be
 * animated in place: its layout position changes with the panel. The robust way to do that is to
 * render the artwork once in a viewport-fixed overlay, parked on the destination rectangle, and then
 * animate the delta between the two rectangles. The overlay lives outside the panel transform chain
 * and outside `.app-shell`, which keeps the landing point exact even while the page reflows.
 */

export type ElementRect = { left: number; top: number; width: number; height: number };

export const artworkFlightDuration = 520;
export const artworkFlightEasing = 'cubic-bezier(.22, 1, .28, 1)';

type FlightOptions = {
  duration?: number;
  easing?: string;
  /** Corner radius at the source and at the destination, so the corners morph with the artwork. */
  radius?: [number, number];
};

const activeFlights = new WeakMap<HTMLElement, Animation>();

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function measureElementRect(element: Element | null | undefined): ElementRect | null {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

function isUsableRect(rect: ElementRect | null | undefined): rect is ElementRect {
  return Boolean(rect) && rect!.width > 0 && rect!.height > 0;
}

/**
 * Moves `element` from the `from` rectangle to the `to` rectangle. The element must already be
 * positioned on the `to` rectangle; the animation only applies the offset between the two.
 */
export function playArtworkFlight(
  element: HTMLElement,
  from: ElementRect,
  to: ElementRect,
  options: FlightOptions = {},
  signal?: AbortSignal,
): Promise<void> {
  if (!isUsableRect(from) || !isUsableRect(to) || !element.animate || signal?.aborted) return Promise.resolve();
  // With reduced motion the artwork simply appears at its destination instead of travelling.
  if (prefersReducedMotion()) return Promise.resolve();

  const duration = options.duration ?? artworkFlightDuration;
  const [radiusFrom, radiusTo] = options.radius ?? [14, 12];

  // `transform-origin: top left` makes the scale factor map the element's box exactly onto the
  // source rectangle, so the artwork lands pixel-perfect on its original spot.
  const scaleX = from.width / to.width;
  const scaleY = from.height / to.height;
  const translateX = from.left - to.left;
  const translateY = from.top - to.top;

  const keyframes: Keyframe[] = [
    {
      transform: `translate(${translateX}px, ${translateY}px) scale(${scaleX}, ${scaleY})`,
      borderRadius: `${radiusFrom}px`,
      boxShadow: '0 22px 48px #000a',
    },
    {
      transform: 'translate(0, 0) scale(1, 1)',
      borderRadius: `${radiusTo}px`,
      boxShadow: '0 6px 18px #0006',
    },
  ];

  activeFlights.get(element)?.cancel();
  const previousZIndex = element.style.zIndex;
  element.style.zIndex = '1';
  const animation = element.animate(keyframes, {
    duration,
    easing: options.easing ?? artworkFlightEasing,
    fill: 'both',
  });
  activeFlights.set(element, animation);

  return new Promise((resolve) => {
    const finish = () => {
      signal?.removeEventListener('abort', cancel);
      if (activeFlights.get(element) === animation) {
        activeFlights.delete(element);
        element.style.zIndex = previousZIndex;
      }
      resolve();
    };
    const cancel = () => animation.cancel();
    animation.addEventListener('finish', finish, { once: true });
    animation.addEventListener('cancel', finish, { once: true });
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
  });
}
