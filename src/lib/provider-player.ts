export type ProviderPlaybackState = { playing: boolean; loading: boolean; position: number; duration: number; ended?: boolean };
type Controls = { play: () => void; pause: () => void; seek: (seconds: number) => void; setVolume: (volume: number) => void; destroy: () => void };

let controls: Controls | undefined;
let queued: (() => void)[] = [];
const listeners = new Set<(state: ProviderPlaybackState) => void>();

export function registerProviderControls(next: Controls) {
  controls?.destroy();
  controls = next;
  queued.forEach((command) => command());
  queued = [];
  return () => {
    if (controls === next) controls = undefined;
    next.destroy();
  };
}

export function providerCommand(command: keyof Omit<Controls, 'destroy'>, value?: number) {
  const run = () => command === 'seek' || command === 'setVolume'
    ? controls?.[command](value ?? 0)
    : controls?.[command]();
  if (controls) run();
  else queued.push(run);
}

export function publishProviderState(state: ProviderPlaybackState) {
  listeners.forEach((listener) => listener(state));
}

export function onProviderState(listener: (state: ProviderPlaybackState) => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
