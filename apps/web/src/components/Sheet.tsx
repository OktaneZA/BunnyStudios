import { useEffect, type ReactNode } from 'react';

interface Props {
  title: string;
  lede?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** A narrower popover rather than a full-height sheet. */
  size?: 'sheet' | 'popover';
  labelledBy?: string;
}

/**
 * A panel that slides over the working area from the right (the picker, the cast sheet)
 * or floats in the middle (the transition choice). Escape and the scrim both close it;
 * the close button is a real 44px target, never a hover-only affordance.
 */
export function Sheet({ title, lede, onClose, children, size = 'sheet' }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className={`sheet-layer is-${size}`}>
      <div className="scrim" onClick={onClose} aria-hidden="true" />
      <section className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <header className="sheet-head">
          <h3>{title}</h3>
          <button type="button" className="icon" onClick={onClose} aria-label="Close">✕</button>
        </header>
        {lede && <p className="hint sheet-lede">{lede}</p>}
        <div className="sheet-body">{children}</div>
      </section>
    </div>
  );
}
