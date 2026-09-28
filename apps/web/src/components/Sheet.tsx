import { useEffect, useRef, type ReactNode } from 'react';

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
  const panel = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.querySelector<HTMLButtonElement>('button')?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); close.current(); }
      if (e.key !== 'Tab') return;
      const targets = Array.from(panel.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), summary, [tabindex="0"]',
      ) ?? []).filter((el) => el.getClientRects().length > 0);
      const first = targets[0];
      const last = targets[targets.length - 1];
      if (!first) { e.preventDefault(); panel.current?.focus(); return; }
      if (e.shiftKey && (document.activeElement === first || !panel.current?.contains(document.activeElement))) {
        e.preventDefault(); last?.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !panel.current?.contains(document.activeElement))) {
        e.preventDefault(); first.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);

  return (
    <div className={`sheet-layer is-${size}`}>
      <div className="scrim" onClick={onClose} aria-hidden="true" />
      <section ref={panel} tabIndex={-1} className="sheet" role="dialog" aria-modal="true" aria-label={title}>
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
