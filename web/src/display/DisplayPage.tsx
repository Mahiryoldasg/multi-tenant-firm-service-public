import { useState, type FormEvent } from 'react';
import {
  EVENT_LABELS,
  formatTime,
  STATUS_LABELS,
  type LogEntry,
  type SimulatorState,
  type SimulatorStatus,
} from './simulator.ts';
import { useDisplaySimulator } from './use-display-simulator.ts';

const ACTIVE_STATUSES: SimulatorStatus[] = ['connecting', 'connected', 'reconnecting'];
const ALERT_ID = 'display-alert';

/** A kiosk display in the browser: it connects with a pasted display token, without a login. */
export function DisplayPage() {
  const { state, connect, disconnect } = useDisplaySimulator();
  const [token, setToken] = useState('');
  const active = ACTIVE_STATUSES.includes(state.status);
  const hasAlert = state.status === 'rejected' || state.status === 'closed-by-server';

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    connect(token);
  }

  return (
    <main className="simulator">
      <h1>Ekran simülatörü</h1>
      <p>
        Bu sayfa bir ekran cihazı gibi çalışır: yapıştırdığınız ekran token'ıyla bağlanır ve
        yalnızca o token'ın firmasına giden mode-change olaylarını alır. Sunucu bağlantı anında
        kendiliğinden bir şey göndermez; bu yüzden simülatör her bağlanışında, otomatik yeniden
        bağlanmalar dahil, mevcut modu sözleşme dışı mode:get isteğiyle sorar, sonra mode-change
        olaylarını izler.
      </p>
      <p>
        İzolasyonu görmek için bu sayfayı iki pencerede açıp iki farklı firmanın token'ıyla
        bağlanın.
      </p>
      <form className="simulator-form" noValidate onSubmit={handleSubmit}>
        <label htmlFor="display-token">Ekran token'ı</label>
        <textarea
          id="display-token"
          className="token-output"
          rows={4}
          spellCheck={false}
          autoComplete="off"
          value={token}
          disabled={active}
          aria-describedby={hasAlert ? ALERT_ID : undefined}
          onChange={(event) => setToken(event.target.value)}
        />
        <div className="actions">
          <button type="submit" disabled={active}>
            Bağlan
          </button>
          <button type="button" disabled={!active} onClick={disconnect}>
            Bağlantıyı kes
          </button>
        </div>
      </form>
      <ConnectionStatus state={state} />
      <LastMode lastMode={state.lastMode} modeSyncError={state.modeSyncError} />
      <EventLog log={state.log} />
    </main>
  );
}

function ConnectionStatus({ state }: { state: SimulatorState }) {
  const { status, reason } = state;
  return (
    <section aria-labelledby="status-heading">
      <h2 id="status-heading">Durum</h2>
      <p role="status">
        {STATUS_LABELS[status]}
        {status === 'reconnecting' && reason !== null && ` (${reason})`}
      </p>
      {status === 'rejected' && (
        <p id={ALERT_ID} className="error" role="alert">
          Sunucunun connect_error sebebi: {reason}
        </p>
      )}
      {status === 'closed-by-server' && (
        <p id={ALERT_ID} className="error" role="alert">
          Sunucu bu ekranın bağlantısını kapattı ({reason}), örneğin firma silinmiş olabilir.
          Yeniden denemek için "Bağlan"a basın.
        </p>
      )}
    </section>
  );
}

function LastMode({ lastMode, modeSyncError }: Pick<SimulatorState, 'lastMode' | 'modeSyncError'>) {
  return (
    <section aria-labelledby="mode-heading">
      <h2 id="mode-heading">Son mod</h2>
      <div aria-live="polite" aria-atomic="true">
        <ModeValue lastMode={lastMode} />
        {modeSyncError !== null && <p className="error">Mevcut mod alınamadı: {modeSyncError}</p>}
      </div>
    </section>
  );
}

function ModeValue({ lastMode }: Pick<SimulatorState, 'lastMode'>) {
  if (lastMode === null) return <p>Henüz mod bilgisi alınmadı.</p>;

  const time = (
    <time dateTime={new Date(lastMode.at).toISOString()}>{formatTime(lastMode.at)}</time>
  );
  if (lastMode.modeId === null) {
    return (
      <>
        <p>Bu firma için henüz bir mod seçilmemiş.</p>
        <p>Soruldu: {time}</p>
      </>
    );
  }
  return (
    <>
      <p className="mode-value">{lastMode.modeId}</p>
      <p>Alındı: {time}</p>
    </>
  );
}

function EventLog({ log }: { log: LogEntry[] }) {
  return (
    <section aria-labelledby="log-heading">
      <h2 id="log-heading">Olay günlüğü</h2>
      {log.length === 0 ? (
        <p>Henüz olay yok.</p>
      ) : (
        <ol className="event-log">
          {log.map((entry) => (
            <li key={entry.id}>
              <time dateTime={new Date(entry.at).toISOString()}>{formatTime(entry.at)}</time>
              <span>
                {EVENT_LABELS[entry.type]}
                {entry.detail !== null && `: ${entry.detail}`}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
