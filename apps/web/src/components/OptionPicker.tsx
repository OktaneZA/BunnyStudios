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
}: Props) {
  const options = PROMPT_VOCABULARIES[vocabulary].filter((option) => !allowedValues || allowedValues.includes(option.value));

  return (
    <div className="picker" role="group">
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
