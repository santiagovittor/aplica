/**
 * `@supabase/supabase-js`'s `createClient` constructs a `RealtimeClient`
 * eagerly, even for a caller like `src/lib/session.ts` that only ever does
 * cookie-based auth and never subscribes to anything. That construction
 * calls `WebSocketFactory.getWebSocketConstructor()`, which throws on Node 20
 * because Node ships a native `WebSocket` only from v22 (v20 has it behind
 * `--experimental-websocket`, unset here). The factory's own check is a bare
 * `typeof WebSocket !== 'undefined'`, so a stub that is never actually
 * connected -- true of every test in this repo, since none exercises
 * realtime -- satisfies it without needing a real implementation.
 *
 * Delete this file, and its `setupFiles` entry in `vitest.config.ts`, once
 * the project's minimum supported Node version reaches 22.
 */
if (typeof globalThis.WebSocket === 'undefined') {
  class UnavailableWebSocket {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;

    constructor() {
      throw new Error(
        'WebSocket is not available in this test environment, and nothing here should be constructing one.',
      );
    }
  }

  Object.assign(globalThis, { WebSocket: UnavailableWebSocket });
}
