export type Send = (event: 'stage' | 'done' | 'error', data: object) => void;

const SSE_HEADERS = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-store',
  // Proxies that buffer a stream turn honest progress into one burst at the end.
  'x-accel-buffering': 'no',
};

/**
 * One `text/event-stream` response, an event per stage, then a terminal `done`
 * or `error`. Never both, and never neither.
 *
 * `failure` is the caller's own mapping from a thrown error to an event.
 * Two callers, two error taxonomies (`ProviderError`/`ApplicationError` here,
 * `CvExtractionError`/`ParseLimitReached` on the CV route), so this stays a
 * parameter rather than something the shared plumbing decides for both.
 */
export function stream(
  run: (send: Send) => Promise<void>,
  failure: (error: unknown) => { error: string; status?: number },
): Response {
  const encoder = new TextEncoder();

  return new Response(
    new ReadableStream({
      async start(controller) {
        let open = true;

        // `send` never throws. It is handed to `onStage`, which runs between
        // paid model calls, and an exception there would throw away work the
        // user has already been billed for. A closed stream means the reader
        // left; there is nobody to tell.
        const send: Send = (event, data) => {
          if (!open) {
            return;
          }
          try {
            controller.enqueue(
              encoder.encode(
                `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
              ),
            );
          } catch {
            open = false;
          }
        };

        try {
          await run(send);
        } catch (error) {
          send('error', failure(error));
        } finally {
          open = false;
          try {
            controller.close();
          } catch {
            // Already closed by the reader going away.
          }
        }
      },
    }),
    { headers: SSE_HEADERS },
  );
}

/** An abort is the user's tab closing or our own timeout firing. */
export function isTimeout(error: Error): boolean {
  return error.name === 'AbortError' || error.name === 'TimeoutError';
}
