import { PROMPT_VOCABULARIES, type PromptVocabularyName } from '@storyboard/vocabularies';

interface Props {
  vocabulary: PromptVocabularyName;
  value: string | null;
  onChange: (value: string | null) => void;
  /** Simple mode shows the plain-English wording; Advanced shows the film term. */
  friendly: boolean;
  allowNone?: boolean;
  noneLabel?: string;
  allowedValues?: readonly string[];
  /** Small chip buttons in one wrapping row (the Create scene editor); no film term underneath. */
  compact?: boolean;
  /** Accessible name for the group. */
  label?: string;
  /** Tapping the chosen chip again clears it (only with allowNone). */
  toggle?: boolean;
}

/**
 * A picker rendered as tappable cards rather than a dropdown.
 *
 * This is the text-only forerunner of the visual picker in Phase 0b — the diagrams are not
 * drawn yet, but the data shape and the Simple/Advanced label split (plan D12) are already
 * here, so adding artwork later is an addition rather than a rewrite.
 *
 * Values and prompt phrases come from @storyboard/vocabularies, never from a local list —
 * that is CV-1's single-authority rule holding on the client too.
 */
export function OptionPicker({
  vocabulary,
  value,
  onChange,
  friendly,
  allowNone = false,
  noneLabel = 'Not decided yet',
  allowedValues,
  compact = false,
  label,
  toggle = false,
}: Props) {
  const options = PROMPT_VOCABULARIES[vocabulary].filter((option) => !allowedValues || allowedValues.includes(option.value));

  if (compact) {
    return (
      <div className="picker compact" role="group" aria-label={label}>
        {options.map((opt) => {
          const selected = opt.value === value;
          return (
            <button key={opt.value} type="button" className={`chip${selected ? ' selected' : ''}`} aria-pressed={selected} title={opt.help}
              onClick={() => onChange(selected && toggle && allowNone ? null : opt.value)}>
              {friendly ? opt.friendlyLabel : opt.label}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="picker" role="group" aria-label={label}>
      {allowNone && (
        <button
          type="button"
          className={`option${value === null ? ' selected' : ''}`}
          onClick={() => onChange(null)}
          aria-pressed={value === null}
        >
          <span className="option-label">{noneLabel}</span>
        </button>
      )}

      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            className={`option${selected ? ' selected' : ''}`}
            onClick={() => onChange(opt.value)}
            aria-pressed={selected}
            title={opt.help}
          >
            <span className="option-label">{friendly ? opt.friendlyLabel : opt.label}</span>
            {/* Showing the real film term underneath in Simple mode means a young user
                picks up the vocabulary over time instead of being walled off from it. */}
            {friendly && opt.friendlyLabel !== opt.label && (
              <span className="option-term">{opt.label}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
