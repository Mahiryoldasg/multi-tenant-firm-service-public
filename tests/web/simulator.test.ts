import { describe, expect, it } from 'vitest';
import {
  INITIAL_SIMULATOR_STATE,
  LOG_LIMIT,
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
  it('starts idle, with no reason, no mode and an empty log', () => {
    expect(INITIAL_SIMULATOR_STATE).toMatchObject({
      status: 'idle',
      reason: null,
      lastMode: null,
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
