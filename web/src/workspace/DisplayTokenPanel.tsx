import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { errorMessage } from '../api.ts';
import { useSession } from '../auth/session.tsx';
import { displayTokenBody } from './requests.ts';

/** Issues display tokens for the firm's kiosk screens, showing each new token once. */
export function DisplayTokenPanel() {
  const { request } = useSession();
  const [label, setLabel] = useState('');
  const [copyResult, setCopyResult] = useState<'copied' | 'failed' | null>(null);

  // The token lives only in this mutation's state: it is never stored, logged or put in a URL, so
  // a new issuance replaces it and a refresh drops it.
  const issue = useMutation({
    mutationFn: (body: { label?: string }) =>
      request<{ token: string }>('/api/display-tokens', { method: 'POST', body }),
    onSuccess: () => setLabel(''),
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCopyResult(null);
    issue.mutate(displayTokenBody(label));
  }

  async function handleCopy(token: string) {
    try {
      // Throws when the Clipboard API is missing (a non-secure context) or the browser refuses.
      await navigator.clipboard.writeText(token);
      setCopyResult('copied');
    } catch {
      setCopyResult('failed');
    }
  }

  return (
    <section>
      <h2>Ekran token'ları</h2>
      <p>Bir ekran bu token ile bağlanır ve yalnızca bu firmanın mod değişikliklerini alır.</p>
      <form
        className="form"
        noValidate
        onSubmit={handleSubmit}
        aria-describedby={issue.isError ? 'display-token-error' : undefined}
      >
        <label htmlFor="display-token-label">Etiket (isteğe bağlı)</label>
        <input
          id="display-token-label"
          autoComplete="off"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
        />
        {issue.isError && (
          <p id="display-token-error" className="error" role="alert">
            {errorMessage(issue.error)}
          </p>
        )}
        <button type="submit" disabled={issue.isPending}>
          {issue.isPending ? 'Oluşturuluyor...' : 'Token oluştur'}
        </button>
      </form>
      {issue.isSuccess && (
        <div className="issued-token">
          <h3>
            Yeni ekran token'ı
            {issue.variables.label !== undefined && ` (${issue.variables.label})`}
          </h3>
          <label htmlFor="issued-display-token">Token</label>
          <textarea
            id="issued-display-token"
            className="token-output"
            readOnly
            rows={4}
            spellCheck={false}
            value={issue.data.token}
          />
          <p>
            Bu token yalnızca şimdi gösterilir. Kopyalayıp ekran cihazına girin; kaybederseniz yeni
            bir token oluşturun.
          </p>
          <button type="button" onClick={() => void handleCopy(issue.data.token)}>
            Kopyala
          </button>
          {copyResult === 'copied' && (
            <p className="success" role="status">
              Kopyalandı.
            </p>
          )}
          {copyResult === 'failed' && (
            <p className="error" role="alert">
              Kopyalanamadı. Token'ı seçip elle kopyalayın.
            </p>
          )}
          {/* A new tab keeps this token on screen here, and the link never carries it. */}
          <p>
            Denemek için simülatörü açıp kopyaladığınız token'ı yapıştırın:{' '}
            <Link to="/display" target="_blank" rel="noopener noreferrer">
              Ekran simülatörünü yeni sekmede aç
            </Link>
          </p>
        </div>
      )}
    </section>
  );
}
