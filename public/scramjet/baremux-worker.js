// public/scramjet/baremux-worker.js
// Minimal bare-mux SharedWorker compatible with @mercuryworkshop/bare-mux wire protocol.
// Receives requests from BareMuxConnection (page) and the scramjet SW, routes them
// through a pluggable transport (bare-as-module3 → @nebula-services/bare-server-node).

'use strict';

let transport = null;  // { instance, name }

// ── SharedWorker connection handler ───────────────────────────────────────
self.addEventListener('connect', ev => {
  const port = ev.ports[0];
  port.start();
  port.addEventListener('message', ev => dispatch(ev.data, port));
});

// ── Message dispatcher ─────────────────────────────────────────────────────
// Wire protocol (from bare-mux source):
//   Sender posts: { message: { type, ...payload }, port: replyPort }
//                 with replyPort (+ any body ArrayBuffer) transferred.
//   We respond on replyPort with { type: 'pong' / 'success' / 'error' / 'fetch' }
async function dispatch({ message, port: replyPort }, _senderPort) {
  if (!replyPort) return;
  replyPort.start();

  try {
    const type = message?.type;

    if (type === 'ping') {
      replyPort.postMessage({ type: 'pong' });
      return;
    }

    if (type === 'get') {
      replyPort.postMessage({ type: 'get', name: transport?.name ?? null });
      return;
    }

    if (type === 'set') {
      // message.client = { function: '<fn body>', args: [serverUrl, ...] }
      // The fn body does: const { default: T } = await import(url); return [T, url];
      const { function: fnBody, args } = message.client;
      const loaderFn = new Function('...args', `return (async (...args) => { ${fnBody} })(...args)`);
      const [BareTransport, name] = await loaderFn(...(args || []));
      // Construct transport with the server URL(s) as args
      const instance = new BareTransport(...(args || []));
      if (typeof instance.init === 'function') await instance.init();
      transport = { instance, name };
      replyPort.postMessage({ type: 'success' });
      return;
    }

    if (type === 'fetch') {
      if (!transport) throw new Error('No transport configured. Call setTransport() first.');
      const { remote, method, headers, body } = message.fetch;
      const response = await transport.instance.request(
        new URL(remote),
        method ?? 'GET',
        body ?? null,
        headers ?? {},
        null   // AbortSignal
      );

      // Normalise body — ReadableStream → ArrayBuffer for transferability
      let respBody = response.body;
      if (respBody instanceof ReadableStream) {
        respBody = await new Response(respBody).arrayBuffer();
      }
      const transferList = respBody instanceof ArrayBuffer ? [respBody] : [];
      replyPort.postMessage(
        { type: 'fetch', fetch: {
            body: respBody,
            headers: response.headers ?? {},
            status: response.status,
            statusText: response.statusText ?? '',
          }
        },
        transferList
      );
      return;
    }

    if (type === 'websocket') {
      if (!transport) throw new Error('No transport configured.');
      const { url, protocols, requestHeaders, channel } = message.websocket;
      channel.start();
      const [send, close] = transport.instance.connect(
        new URL(url),
        protocols ?? [],
        requestHeaders ?? {},
        proto  => channel.postMessage({ type: 'open',    args: [proto] }),
        data   => {
          if (data instanceof ArrayBuffer)
            channel.postMessage({ type: 'message', args: [data] }, [data]);
          else
            channel.postMessage({ type: 'message', args: [data] });
        },
        (code, reason) => channel.postMessage({ type: 'close', args: [code, reason] }),
        err    => channel.postMessage({ type: 'error', args: [String(err)] }),
      );
      channel.addEventListener('message', ev => {
        const { type: t, data, closeCode, closeReason } = ev.data;
        if (t === 'data')  send(data);
        if (t === 'close') close(closeCode, closeReason);
      });
      replyPort.postMessage({ type: 'websocket' });
      return;
    }

    throw new Error(`Unknown message type: ${type}`);

  } catch (err) {
    try {
      replyPort.postMessage({ type: 'error', error: err instanceof Error ? err : new Error(String(err)) });
    } catch { /* replyPort already neutered */ }
  }
}
