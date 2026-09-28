import { useEffect, useReducer, useRef } from 'react';
import { openDisplayConnection, type DisplayConnection } from './connection.ts';
import { INITIAL_SIMULATOR_STATE, simulatorReducer, type SimulatorState } from './simulator.ts';

interface DisplaySimulator {
  state: SimulatorState;
  connect: (token: string) => void;
  disconnect: () => void;
}

/** The simulator's state and its one display connection, which closes when the page unmounts. */
export function useDisplaySimulator(): DisplaySimulator {
  const [state, dispatch] = useReducer(simulatorReducer, INITIAL_SIMULATOR_STATE);
  // Opened in `connect`, not in an effect, so StrictMode's second effect run opens nothing.
  const connection = useRef<DisplayConnection | null>(null);

  useEffect(() => () => connection.current?.close(), []);

  function connect(token: string) {
    connection.current?.close();
    dispatch({ type: 'connecting', at: Date.now() });
    // A JWT has no whitespace, but a pasted copy may end with a newline. An empty token is still
    // sent, so the server's own message shows.
    connection.current = openDisplayConnection(window.location.origin, token.trim(), (event) =>
      dispatch({ ...event, at: Date.now() }),
    );
  }

  function disconnect() {
    connection.current?.close();
    connection.current = null;
    dispatch({ type: 'closed', at: Date.now() });
  }

  return { state, connect, disconnect };
}
