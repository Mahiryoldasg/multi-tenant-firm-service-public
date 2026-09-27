import type { ModeBroadcaster } from '../../src/server/tenancy/displays.ts';

/** For scope tests that do not look at the display channel: every broadcast is dropped. */
export const NO_BROADCASTS: ModeBroadcaster = { broadcastModeChange: () => {} };
