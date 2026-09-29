import { describe, expect, it } from 'vitest';
import {
  INITIAL_SIMULATOR_STATE,
  LOG_LIMIT,
  NO_MODE_DETAIL,
  simulatorReducer,
  type SimulatorAction,
  type SimulatorState,
} from '../../web/src/display/simulator.ts';

function run(actions: SimulatorAction[], from: SimulatorState = INITIAL_SIMULATOR_STATE) {
  return actions.reduce(simulatorReducer, from);
}

const connectedWithMode = run([
  { type: 'connecting', at: 1 },
  { type: 'connected', at: 2 },
  { type: 'mode-change', modeId: 'lobby', at: 3 },
]);

describe('simulatorReducer', () => {
  it('starts idle, with no reason, no mode, no sync error and an empty log', () => {
    expect(INITIAL_SIMULATOR_STATE).toMatchObject({
      status: 'idle',
      reason: null,
      lastMode: null,
      modeSyncError: null,
      log: [],
    });
  });

  it('clears the reason and the last mode on a new connection, and keeps the log', () => {
    const rejected = run(
      [{ type: 'rejected', reason: 'Display token geçersiz.', at: 4 }],
      connectedWithMode,
    );

    const state = run([{ type: 'connecting', at: 5 }], rejected);

    expect(state.status).toBe('connecting');
    expect(state.reason).toBeNull();
    expect(state.lastMode).toBeNull();
    expect(state.log.map((entry) => entry.type)).toEqual([
      'connecting',
      'rejected',
      'mode-change',
      'connected',
      'connecting',
    ]);
  });

  it('clears the reason once connected', () => {
    const retrying = run([
      { type: 'connecting', at: 1 },
      { type: 'connect-failed', reason: 'xhr poll error', at: 2 },
    ]);

    const state = run([{ type: 'connected', at: 3 }], retrying);

    expect(state.status).toBe('connected');
    expect(state.reason).toBeNull();
  });

  it('records a mode change with its time and keeps the status', () => {
    expect(connectedWithMode.status).toBe('connected');
    expect(connectedWithMode.lastMode).toEqual({ modeId: 'lobby', at: 3 });
    expect(connectedWithMode.log[0]).toMatchObject({ type: 'mode-change', detail: 'lobby', at: 3 });
  });

  it('logs the same modeId twice, because the broadcast is unconditional', () => {
    const state = run([{ type: 'mode-change', modeId: 'lobby', at: 4 }], connectedWithMode);

    expect(state.lastMode).toEqual({ modeId: 'lobby', at: 4 });
    expect(state.log.filter((entry) => entry.type === 'mode-change')).toHaveLength(2);
  });

  it('keeps the server reason of a rejection', () => {
    const state = run([
      { type: 'connecting', at: 1 },
      { type: 'rejected', reason: 'Display token gerekli.', at: 2 },
    ]);

    expect(state.status).toBe('rejected');
    expect(state.reason).toBe('Display token gerekli.');
    expect(state.log[0]).toMatchObject({ type: 'rejected', detail: 'Display token gerekli.' });
  });

  it.each([
    { type: 'connect-failed', reason: 'xhr poll error' },
    { type: 'connection-lost', reason: 'transport close' },
  ] as const)('shows $type as reconnecting and keeps the last mode', (event) => {
    const state = run([{ ...event, at: 4 }], connectedWithMode);

    expect(state.status).toBe('reconnecting');
    expect(state.reason).toBe(event.reason);
    expect(state.lastMode).toEqual({ modeId: 'lobby', at: 3 });
  });

  it('keeps the last mode and the reason when the server closes the connection', () => {
    const state = run(
      [{ type: 'closed-by-server', reason: 'io server disconnect', at: 4 }],
      connectedWithMode,
    );

    expect(state.status).toBe('closed-by-server');
    expect(state.reason).toBe('io server disconnect');
    expect(state.lastMode).toEqual({ modeId: 'lobby', at: 3 });
  });

  it('goes back to idle when the user disconnects, keeping the last mode', () => {
    const state = run([{ type: 'closed', at: 4 }], connectedWithMode);

    expect(state.status).toBe('idle');
    expect(state.reason).toBeNull();
    expect(state.lastMode).toEqual({ modeId: 'lobby', at: 3 });
    expect(state.log[0]).toMatchObject({ type: 'closed', detail: null });
  });

  it('records a mode:get answer with its time, and logs it', () => {
    const state = run([
      { type: 'connecting', at: 1 },
      { type: 'connected', at: 2 },
      { type: 'mode-synced', modeId: 'lobby', at: 3 },
    ]);

    expect(state.status).toBe('connected');
    expect(state.lastMode).toEqual({ modeId: 'lobby', at: 3 });
    expect(state.log[0]).toMatchObject({ type: 'mode-synced', detail: 'lobby', at: 3 });
  });

  it('records an answer without a mode as a null modeId', () => {
    const state = run([
      { type: 'connecting', at: 1 },
      { type: 'connected', at: 2 },
      { type: 'mode-synced', modeId: null, at: 3 },
    ]);

    expect(state.lastMode).toEqual({ modeId: null, at: 3 });
    expect(state.log[0]).toMatchObject({ type: 'mode-synced', detail: NO_MODE_DETAIL });
  });

  it.each([
    {
      order: 'a mode:get answer after a mode-change',
      actions: [
        { type: 'mode-change', modeId: 'lobby', at: 4 },
        { type: 'mode-synced', modeId: 'night', at: 5 },
      ],
      expected: { modeId: 'night', at: 5 },
    },
    {
      order: 'a mode-change after a mode:get answer',
      actions: [
        { type: 'mode-synced', modeId: 'lobby', at: 4 },
        { type: 'mode-change', modeId: 'night', at: 5 },
      ],
      expected: { modeId: 'night', at: 5 },
    },
  ] as { order: string; actions: SimulatorAction[]; expected: unknown }[])(
    'keeps whichever mode arrives last: $order',
    ({ actions, expected }) => {
      expect(run(actions, connectedWithMode).lastMode).toEqual(expected);
    },
  );

  it('keeps the status and the last mode when mode:get fails, and logs why', () => {
    const state = run(
      [{ type: 'mode-sync-failed', reason: 'Sunucu hatası.', at: 4 }],
      connectedWithMode,
    );

    expect(state.status).toBe('connected');
    expect(state.lastMode).toEqual({ modeId: 'lobby', at: 3 });
    expect(state.modeSyncError).toBe('Sunucu hatası.');
    expect(state.log[0]).toMatchObject({ type: 'mode-sync-failed', detail: 'Sunucu hatası.' });
  });

  it.each([
    { type: 'mode-synced', modeId: null },
    { type: 'mode-change', modeId: 'night' },
  ] as const)('clears the sync error when $type brings a mode', (event) => {
    const failed = run(
      [{ type: 'mode-sync-failed', reason: 'Sunucu hatası.', at: 4 }],
      connectedWithMode,
    );

    const state = run([{ ...event, at: 5 }], failed);

    expect(state.modeSyncError).toBeNull();
    expect(state.lastMode).toEqual({ modeId: event.modeId, at: 5 });
  });

  it('clears the sync error on a new connection, and keeps it through a lost connection', () => {
    const failed = run(
      [{ type: 'mode-sync-failed', reason: 'Sunucu hatası.', at: 4 }],
      connectedWithMode,
    );

    const lost = run([{ type: 'connection-lost', reason: 'transport close', at: 5 }], failed);
    expect(lost.modeSyncError).toBe('Sunucu hatası.');

    expect(run([{ type: 'connecting', at: 6 }], lost).modeSyncError).toBeNull();
  });

  it('keeps the newest LOG_LIMIT entries, newest first, with unique increasing ids', () => {
    const actions: SimulatorAction[] = Array.from({ length: LOG_LIMIT + 1 }, (_, index) => ({
      type: 'mode-change',
      modeId: `mode-${index}`,
      at: index,
    }));

    const state = run(actions);

    expect(state.log).toHaveLength(LOG_LIMIT);
    expect(state.log[0]?.detail).toBe(`mode-${LOG_LIMIT}`);
    expect(state.log.at(-1)?.detail).toBe('mode-1');
    const ids = state.log.map((entry) => entry.id);
    expect(ids).toEqual([...ids].sort((a, b) => b - a));
    expect(new Set(ids).size).toBe(LOG_LIMIT);
  });
});
