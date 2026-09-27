import type { Transition } from '../director-api';
import { Sheet } from './Sheet';

/** The three joins (plan D40), each with one plain sentence. */
export const TRANSITIONS: { value: Transition; label: string; help: string }[] = [
  { value: 'cut', label: 'Cut', help: 'Straight to the next scene. Snappy.' },
  { value: 'fade', label: 'Fade', help: 'Melts into the next scene. Gentle.' },
  { value: 'slide', label: 'Slide', help: 'Pushes the next scene in from the side. Fun.' },
];

export function transitionLabel(t: Transition) {
  return TRANSITIONS.find((x) => x.value === t)?.label ?? t;
}

export function TransitionIcon({ value }: { value: Transition }) {
  if (value === 'cut') {
    return <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M7 1 V13" stroke="currentColor" strokeWidth="2" /></svg>;
  }
  if (value === 'slide') {
    return <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M2 7 H10 M7 3 L11 7 L7 11" stroke="currentColor" strokeWidth="2" fill="none" /></svg>;
  }
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <rect x="1" y="3" width="6" height="8" fill="currentColor" opacity="0.35" /><rect x="7" y="3" width="6" height="8" fill="currentColor" />
    </svg>
  );
}

/** The small button between two scenes. */
export function TransitionChip({ value, onClick, disabled }: { value: Transition; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className="transition-chip" onClick={onClick} disabled={disabled} aria-label={`Change how scenes join: ${transitionLabel(value)}`}>
      <TransitionIcon value={value} />
      {transitionLabel(value)}
    </button>
  );
}

interface PopoverProps {
  fromNumber: number;
  toNumber: number;
  value: Transition;
  busy: boolean;
  onPick: (t: Transition) => void;
  onPickAll: (t: Transition) => void;
  onClose: () => void;
}

export function TransitionPopover({ fromNumber, toNumber, value, busy, onPick, onPickAll, onClose }: PopoverProps) {
  return (
    <Sheet title={`How does scene ${fromNumber} join scene ${toNumber}?`} onClose={onClose} size="popover">
      <div className="transition-options">
        {TRANSITIONS.map((t) => (
          <button key={t.value} type="button" className={`transition-option${t.value === value ? ' selected' : ''}`} disabled={busy} onClick={() => onPick(t.value)} aria-pressed={t.value === value}>
            <span className="transition-chip static"><TransitionIcon value={t.value} />{t.label}</span>
            <span className="transition-help">{t.help}</span>
            {t.value === value && <span className="chip">Chosen</span>}
          </button>
        ))}
      </div>
      <p className="hint">Tap a transition to change this join, or apply the chosen transition to every scene.</p>
      <button type="button" className="secondary" disabled={busy} onClick={() => onPickAll(value)}>Use this for every scene</button>
    </Sheet>
  );
}
