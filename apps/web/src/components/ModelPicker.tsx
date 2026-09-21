import { modelChips, modelPrice, type ModelInfo, type ModelKind } from '../director-api';
import { Sheet } from './Sheet';

interface Props {
  models: ModelInfo[];
  kind: ModelKind;
  selectedId: string | null;
  onPick: (model: ModelInfo) => void;
  onClose: () => void;
  /** Advanced mode shows the real name and provider (plan §6). */
  advanced: boolean;
  message?: string | null;
}

/** The model picker sheet: each enabled model as a row with kid-word capability chips. */
export function ModelPicker({ models, kind, selectedId, onPick, onClose, advanced, message }: Props) {
  const rows = models.filter((m) => m.kind === kind);
  return (
    <Sheet title="Pick a picture maker" lede="Each one is a different AI. The chips say what it can do." onClose={onClose}>
      {rows.length === 0 && <p className="muted">{message ?? 'No picture makers are set up for this yet. Ask a grown-up.'}</p>}
      <div className="model-list">
        {rows.map((m) => (
          <button
            key={m.id}
            type="button"
            className={`model-row${m.id === selectedId ? ' selected' : ''}`}
            onClick={() => { onPick(m); onClose(); }}
            aria-pressed={m.id === selectedId}
          >
            <ModelBadge model={m} />
            <span className="model-text">
              <span className="model-name">
                {m.friendly_label}
                {advanced && m.label && <span className="model-real">{m.label}{m.provider ? ` · ${m.provider}` : ''}</span>}
              </span>
              <span className="model-help">{m.help}</span>
              <span className="chips">
                <span className="chip">{m.kind === 'image' ? 'Pictures' : 'Clips'}</span>
                {modelChips(m).map((c) => <span key={c} className="chip">{c}</span>)}
              </span>
            </span>
            <span className="model-price">{modelPrice(m)}</span>
          </button>
        ))}
      </div>
      <p className="hint">Grown-ups can turn picture makers on and off, and see the real names, in <b>Grown-ups</b>.</p>
    </Sheet>
  );
}

export function ModelBadge({ model }: { model: ModelInfo }) {
  return <span className={`model-badge ${model.kind}`} aria-hidden="true">{model.friendly_label.charAt(0)}</span>;
}
