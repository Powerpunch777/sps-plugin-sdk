import { PassThrough } from "node:stream";
import { defineSpsPlugin, runSpsWorker } from "./index.mjs";

function toError(value) {
  if (value instanceof Error) return value;
  if (value && typeof value === "object" && typeof value.message === "string") return new Error(value.message);
  return new Error("SPS Worker request failed.");
}

/**
 * Runs the public JSON-RPC Worker in memory. It is intentionally a small
 * evidence harness, not a Host implementation: plugins can assert their
 * Inbox summaries without importing SPS Desktop internals.
 */
export function createSpsWorkerTestHarness(plugin, options = {}) {
  const input = new PassThrough();
  const output = new PassThrough();
  const definition = plugin?.handlers ? plugin : defineSpsPlugin(plugin);
  const worker = runSpsWorker(definition, { input, output, logger: () => {} });
  const inboxItems = [];
  const pending = new Map();
  let nextId = 1;
  let buffered = "";

  const send = (message) => input.write(`${JSON.stringify(message)}\n`);
  const respond = (id, result) => send({ jsonrpc: "2.0", id, result });
  const reject = (id, cause) => send({ jsonrpc: "2.0", id, error: { code: -32000, message: toError(cause).message } });

  async function handleWorkerRequest(message) {
    const { id, method, params } = message;
    try {
      if (method === "inbox.publish") {
        const existing = inboxItems.find((item) => item.companyId === params.companyId && item.externalId === params.externalId);
        const item = existing ?? {
          id: `inbox-${inboxItems.length + 1}`,
          companyId: params.companyId,
          externalId: params.externalId,
          title: params.title,
          withdrawn: false,
        };
        item.title = params.title;
        item.withdrawn = false;
        if (!existing) inboxItems.push(item);
        respond(id, { id: item.id, externalId: item.externalId });
        return;
      }
      if (method === "inbox.update") {
        const existing = inboxItems.find((item) => item.companyId === params.companyId && item.externalId === params.externalId);
        if (!existing) throw new Error("Inbox item not found");
        existing.title = params.title;
        existing.withdrawn = false;
        respond(id, { id: existing.id, externalId: existing.externalId });
        return;
      }
      if (method === "inbox.withdraw") {
        const existing = inboxItems.find((item) => item.companyId === params.companyId && item.externalId === params.externalId);
        if (!existing) throw new Error("Inbox item not found");
        existing.withdrawn = true;
        respond(id, { id: existing.id, externalId: params.externalId });
        return;
      }
      respond(id, await options.onHostRequest?.(method, params));
    } catch (cause) {
      reject(id, cause);
    }
  }

  output.setEncoding("utf8");
  output.on("data", (chunk) => {
    buffered += chunk;
    let newline = buffered.indexOf("\n");
    while (newline >= 0) {
      const line = buffered.slice(0, newline);
      buffered = buffered.slice(newline + 1);
      if (line) {
        const message = JSON.parse(line);
        if (typeof message.method === "string") {
          void handleWorkerRequest(message);
        } else if (Object.hasOwn(message, "id")) {
          const request = pending.get(String(message.id));
          if (request) {
            pending.delete(String(message.id));
            if (message.error) request.reject(toError(message.error));
            else request.resolve(message.result);
          }
        }
      }
      newline = buffered.indexOf("\n");
    }
  });

  function invoke(method, params = {}) {
    const id = `host-${nextId++}`;
    return new Promise((resolve, rejectPromise) => {
      pending.set(id, { resolve, reject: rejectPromise });
      send({ jsonrpc: "2.0", id, method, params });
    });
  }

  return Object.freeze({
    inboxItems,
    initialize(params = {}) { return invoke("initialize", params); },
    health(params = {}) { return invoke("health", params); },
    async shutdown(params = {}) {
      const result = await invoke("shutdown", params);
      input.end();
      await worker.closed;
      return result;
    },
  });
}
