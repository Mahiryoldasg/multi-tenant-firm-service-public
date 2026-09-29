import type { Realtime } from '../realtime/realtime.ts';

/** What the display channel needs from the realtime server. */
export type ModeBroadcaster = Pick<Realtime, 'broadcastModeChange'>;

/** The connected displays of one firm. No method takes a firm id: the firm is fixed at construction. */
export interface DisplayChannel {
  /**
   * Sends `mode-change` with this `modeId` to the firm's connected displays only, and the
   * payload-free `mode:changed` to the firm's open control screens only.
   */
  broadcastModeChange(modeId: string): void;
}

/** Binds the display broadcasts to `firmId`, so a tenant handler never picks the room. */
export function createDisplayChannel(realtime: ModeBroadcaster, firmId: string): DisplayChannel {
  return {
    broadcastModeChange(modeId) {
      realtime.broadcastModeChange(firmId, modeId);
    },
  };
}
