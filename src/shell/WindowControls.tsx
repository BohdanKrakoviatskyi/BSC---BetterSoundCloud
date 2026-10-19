import { commands } from '../app/commands';

export function WindowControls() {
  return (
    <div className="window-controls" aria-label="Window controls">
      <button aria-label="Minimize" onClick={() => void commands.minimizeWindow()}>
        <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6h8" /></svg>
      </button>
      <button aria-label="Maximize or restore" onClick={() => void commands.toggleMaximizeWindow()}>
        <svg viewBox="0 0 12 12" aria-hidden="true"><rect x="2.5" y="2.5" width="7" height="7" /></svg>
      </button>
      <button className="close-window" aria-label="Close" onClick={() => void commands.closeWindow()}>
        <svg viewBox="0 0 12 12" aria-hidden="true"><path d="m3 3 6 6m0-6-6 6" /></svg>
      </button>
    </div>
  );
}