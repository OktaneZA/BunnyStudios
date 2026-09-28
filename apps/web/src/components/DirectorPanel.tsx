import { useEffect, useRef, useState, type ReactNode } from 'react';

/** Panels stay in normal document flow until explicitly floated on a large screen. */
export function DirectorPanel({ title, className, children, movable = false }: {
  title: string; className: string; children: ReactNode; movable?: boolean;
}) {
  const panel = useRef<HTMLElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number; width: number } | null>(null);
  useEffect(() => {
    setPosition(null);
    const dock = () => setPosition(null);
    window.addEventListener('resize', dock);
    return () => window.removeEventListener('resize', dock);
  }, [movable]);
  function move(left: number, top: number) {
    setPosition((p) => p && ({ ...p,
      left: Math.max(8, Math.min(window.innerWidth - p.width - 8, left)),
      top: Math.max(8, Math.min(window.innerHeight - 100, top)),
    }));
  }
  return <section ref={panel} className={`${className} director-panel${position ? ' floating-panel' : ''}`}
    style={position ? { left: position.left, top: position.top, width: position.width, maxHeight: `calc(100dvh - ${position.top + 8}px)` } : undefined}>
    {movable && <div className="panel-bar">
      <button type="button" className="panel-grip secondary" disabled={!position}
        aria-label={`Move ${title}; use arrow keys`} onKeyDown={(event) => {
          if (!position || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
          event.preventDefault();
          move(position.left + (event.key === 'ArrowLeft' ? -20 : event.key === 'ArrowRight' ? 20 : 0),
            position.top + (event.key === 'ArrowUp' ? -20 : event.key === 'ArrowDown' ? 20 : 0));
        }} onPointerDown={(event) => {
          if (!position) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { x: event.clientX, y: event.clientY, ...position };
        }} onPointerMove={(event) => {
          const d = drag.current;
          if (d) move(d.left + event.clientX - d.x, d.top + event.clientY - d.y);
        }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
        <span aria-hidden="true">⠿ </span>{title}
      </button>
      <button type="button" className="secondary" aria-label={`${position ? 'Dock' : 'Float'} ${title}`} onClick={() => {
        if (position) { setPosition(null); return; }
        const rect = panel.current!.getBoundingClientRect();
        const width = Math.min(Math.max(rect.width, 320), window.innerWidth - 32);
        setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)), top: Math.max(8, Math.min(rect.top, window.innerHeight - 150)), width });
      }}>{position ? 'Dock' : 'Float'}</button>
    </div>}
    {children}
  </section>;
}
