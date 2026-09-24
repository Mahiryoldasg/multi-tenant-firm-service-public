import { useEffect, useState } from 'react';

type HealthState = 'checking' | 'ok' | 'down';

const HEALTH_LABELS: Record<HealthState, string> = {
  checking: 'kontrol ediliyor…',
  ok: 'çalışıyor',
  down: 'ulaşılamıyor',
};

// Placeholder shell: replaced by the real control UI in build-plan items 11–13.
export function App() {
  const [health, setHealth] = useState<HealthState>('checking');

  useEffect(() => {
    let active = true;
    fetch('/health')
      .then((res) => active && setHealth(res.ok ? 'ok' : 'down'))
      .catch(() => active && setHealth('down'));
    return () => {
      active = false;
    };
  }, []);

  return (
    <main>
      <h1>Firma Yönetim Paneli</h1>
      <p>API durumu: {HEALTH_LABELS[health]}</p>
    </main>
  );
}
