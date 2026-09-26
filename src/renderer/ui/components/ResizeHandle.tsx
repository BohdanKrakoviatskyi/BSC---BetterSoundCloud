import type { PointerEvent as ReactPointerEvent } from 'react';

type Props = {
  side: 'left' | 'right';
  label: string;
  onResize: (delta: number) => void;
};

export function ResizeHandle({ side, label, onResize }: Props) {
  function startResize(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    let previousX = event.clientX;
    const move = (moveEvent: globalThis.PointerEvent) => {
      const delta = moveEvent.clientX - previousX;
      previousX = moveEvent.clientX;
      onResize(side === 'left' ? delta : -delta);
    };
    const finish = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      document.body.classList.remove('is-resizing-sidebar');
    };
    document.body.classList.add('is-resizing-sidebar');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  }

  return <div className={`sidebar-resize-handle ${side}`} role="separator" aria-orientation="vertical" aria-label={label} onPointerDown={startResize} />;
}
