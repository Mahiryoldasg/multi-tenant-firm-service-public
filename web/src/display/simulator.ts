// The `/display` simulator's state. DOM-free and without React, so the Node test suite can import it.

export type SimulatorStatus =
  'idle' | 'connecting' | 'connected' | 'reconnecting' | 'rejected' | 'closed-by-server';

/** What happened to the simulator's connection, reported by the socket or by the user. */
export type SimulatorEvent =
  | { type: 'connecting' }
  | { type: 'connected' }
  /** A `connect_error` the client does not retry: the server rejected the handshake. */
  | { type: 'rejected'; reason: string }
  /** A `connect_error` the client retries: the server could not be reached. */
  | { type: 'connect-failed'; reason: string }
  /** A `disconnect` the client retries. */
  | { type: 'connection-lost'; reason: string }
  /** A `disconnect` the client does not retry: the server dropped the display. */
  | { type: 'closed-by-server'; reason: string }
  | { type: 'closed' }
  | { type: 'mode-change'; modeId: string }
  /** The answer to `mode:get` (not in the contract): `null` when the firm never set a mode. */
  | { type: 'mode-synced'; modeId: string | null }
  /** `mode:get` got no usable answer while connected. */
  | { type: 'mode-sync-failed'; reason: string };

export type SimulatorEventType = SimulatorEvent['type'];

/** An event with the time it happened, in epoch milliseconds. */
export type SimulatorAction = SimulatorEvent & { at: number };

export interface LogEntry {
  id: number;
  at: number;
  type: SimulatorEventType;
  /** The reason or the `modeId`, when the event has one. */
  detail: string | null;
}

export interface SimulatorState {
  status: SimulatorStatus;
  reason: string | null;
  /** `modeId` is `null` when `mode:get` answered that the firm never set a mode. */
  lastMode: { modeId: string | null; at: number } | null;
  /** Why the last `mode:get` failed, until a mode arrives or a new connection starts. */
  modeSyncError: string | null;
  /** Newest first, at most `LOG_LIMIT` entries. */
  log: LogEntry[];
  nextLogId: number;
}

export const LOG_LIMIT = 100;
/** The log detail of a `mode:get` answer without a mode. */
export const NO_MODE_DETAIL = 'mod seçilmemiş (null)';

export const INITIAL_SIMULATOR_STATE: SimulatorState = {
  status: 'idle',
  reason: null,
  lastMode: null,
  modeSyncError: null,
  log: [],
  nextLogId: 1,
};

export const STATUS_LABELS: Record<SimulatorStatus, string> = {
  idle: 'Bağlı değil',
  connecting: 'Bağlanıyor...',
  connected: 'Bağlı',
  reconnecting: 'Bağlantı yok, yeniden deneniyor...',
  rejected: 'Bağlantı reddedildi',
  'closed-by-server': 'Sunucu bağlantıyı kapattı',
};

export const EVENT_LABELS: Record<SimulatorEventType, string> = {
  connecting: 'Bağlanılıyor',
  connected: 'connect: bağlandı',
  rejected: 'connect_error: bağlantı reddedildi',
  'connect-failed': 'connect_error: sunucuya ulaşılamadı, yeniden denenecek',
  'connection-lost': 'disconnect: bağlantı koptu, yeniden denenecek',
  'closed-by-server': 'disconnect: sunucu bağlantıyı kapattı',
  closed: 'Bağlantı kesildi',
  'mode-change': 'mode-change',
  'mode-synced': 'mode:get yanıtı',
  'mode-sync-failed': 'mode:get: mevcut mod alınamadı',
};

export function simulatorReducer(state: SimulatorState, action: SimulatorAction): SimulatorState {
  const entry: LogEntry = {
    id: state.nextLogId,
    at: action.at,
    type: action.type,
    detail: detailOf(action),
  };
  return {
    ...state,
    ...transition(state, action),
    log: [entry, ...state.log].slice(0, LOG_LIMIT),
    nextLogId: state.nextLogId + 1,
  };
}

function transition(
  state: SimulatorState,
  action: SimulatorAction,
): Partial<Pick<SimulatorState, 'status' | 'reason' | 'lastMode' | 'modeSyncError'>> {
  switch (action.type) {
    case 'connecting':
      // A new connection may use another firm's token, so the old firm's mode must not stay on screen.
      return { status: 'connecting', reason: null, lastMode: null, modeSyncError: null };
    case 'connected':
      return { status: 'connected', reason: null };
    case 'rejected':
      return { status: 'rejected', reason: action.reason };
    case 'connect-failed':
    case 'connection-lost':
      return { status: 'reconnecting', reason: action.reason };
    case 'closed-by-server':
      return { status: 'closed-by-server', reason: action.reason };
    case 'closed':
      return { status: 'idle', reason: null };
    case 'mode-change':
    case 'mode-synced':
      // Whichever arrives last is current: the server answers and broadcasts in the order the mode
      // changed.
      return { lastMode: { modeId: action.modeId, at: action.at }, modeSyncError: null };
    case 'mode-sync-failed':
      return { modeSyncError: action.reason };
  }
}

function detailOf(action: SimulatorAction): string | null {
  if (action.type === 'mode-change') return action.modeId;
  if (action.type === 'mode-synced') return action.modeId ?? NO_MODE_DETAIL;
  return 'reason' in action ? action.reason : null;
}

/** The local time of day, `HH:MM:SS`. */
export function formatTime(at: number): string {
  return new Date(at).toLocaleTimeString('tr-TR');
}
