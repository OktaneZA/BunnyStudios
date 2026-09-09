import { useState } from 'react';

export function CopyButton({ text, label = 'Copy scene', disabled = false }: { text: () => string; label?: string; disabled?: boolean }) {
  const [status, setStatus] = useState('');
  const [fallback, setFallback] = useState<string | null>(null);
  async function copy() {
    const content = text();
    setStatus(''); setFallback(null);
    try {
      await navigator.clipboard.writeText(content);
      setStatus('Copied!');
    } catch {
      setStatus('Select and copy the text below.');
      setFallback(content);
    }
  }
  return <div className="copy-control">
    <button type="button" className="secondary" disabled={disabled} onClick={() => void copy()}>{label}</button>
    <span role="status" className="hint">{status}</span>
    {fallback !== null && <textarea aria-label="Text to copy" readOnly value={fallback} onFocus={(event) => event.target.select()} rows={8} />}
  </div>;
}
