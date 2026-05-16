// public/scramjet/baremux.js
// Minimal BareMuxConnection compatible with @mercuryworkshop/bare-mux wire protocol.
// Imported by sniffer.html so it can:
//   1. Set the transport the bare-mux SharedWorker should use.
//   2. Respond to the scramjet SW's "getPort" requests with a SharedWorker port.

'use strict';

// Stash native refs before scramjet can rewrite them.
const _SharedWorker     = globalThis.SharedWorker;
const _MessageChannel   = globalThis.MessageChannel;
const _postMessage      = MessagePort.prototype.postMessage;

const WORKER_NAME = 'bare-mux-worker';

export class BareMuxConnection {
  #workerPath;
  #port;  // MessagePort connected to the SharedWorker

  constructor(workerPath) {
    this.#workerPath = workerPath;
    const worker = new _SharedWorker(workerPath, WORKER_NAME);
    this.#port = worker.port;
    this.#port.start();

    // When the scramjet SW needs a transport port, it postMessages
    // { type: 'getPort', port: <MessagePort> } to each window client.
    // We must respond on that port with a fresh SharedWorker port.
    if (typeof navigator !== 'undefined' && navigator.serviceWorker) {
      navigator.serviceWorker.addEventListener('message', ev => {
        if (ev.data?.type === 'getPort' && ev.data.port) {
          const freshWorker = new _SharedWorker(workerPath, WORKER_NAME);
          _postMessage.call(ev.data.port, freshWorker.port, [freshWorker.port]);
        }
      });
    }
  }

  // ── Internal helpers ───────────────────────────────────────────────────

  #ping(port) {
    return new Promise((resolve, reject) => {
      const mc = new _MessageChannel();
      const timer = setTimeout(() => reject(new Error('bare-mux ping timeout')), 1500);
      mc.port1.onmessage = ev => {
        clearTimeout(timer);
        ev.data?.type === 'pong' ? resolve() : reject(new Error('unexpected ping reply'));
      };
      _postMessage.call(port, { message: { type: 'ping' }, port: mc.port2 }, [mc.port2]);
    });
  }

  async #sendMessage(msg, transferList = []) {
    // Ping first to ensure the SharedWorker is alive.
    try { await this.#ping(this.#port); } catch { /* first call may arrive before worker is ready */ }

    return new Promise((resolve, reject) => {
      const mc = new _MessageChannel();
      mc.port1.onmessage = ev => {
        ev.data?.type === 'error'
          ? reject(ev.data.error instanceof Error ? ev.data.error : new Error(String(ev.data.error)))
          : resolve(ev.data);
      };
      _postMessage.call(
        this.#port,
        { message: msg, port: mc.port2 },
        [mc.port2, ...transferList]
      );
    });
  }

  // ── Public API ─────────────────────────────────────────────────────────

  /** Tell the SharedWorker which transport to use.
   *  @param {string} transportPath  URL of the transport ES module (bare.js)
   *  @param {string[]} args         Constructor args — typically [bareServerUrl]
   */
  async setTransport(transportPath, args = []) {
    const fnBody = `
      const { default: BareTransport } = await import(${JSON.stringify(transportPath)});
      return [BareTransport, ${JSON.stringify(transportPath)}];
    `;
    await this.#sendMessage({ type: 'set', client: { function: fnBody, args } });
  }

  async getTransport() {
    const reply = await this.#sendMessage({ type: 'get' });
    return reply?.name ?? null;
  }

  /** Exposed so advanced callers can get the raw port if needed. */
  getInnerPort() { return this.#port; }
}
