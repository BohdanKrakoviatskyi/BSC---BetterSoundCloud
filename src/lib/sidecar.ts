import { Command, type Child } from '@tauri-apps/plugin-shell';

type RpcResponse<T> = { id: number; result?: T; error?: string };
type Pending = { resolve: (value: unknown) => void; reject: (reason: Error) => void };

let child: Promise<Child> | undefined;
let nextId = 0;
let buffer = '';
const pending = new Map<number, Pending>();

function failPending(message: string) {
  pending.forEach(({ reject }) => reject(new Error(message)));
  pending.clear();
}

function handleLine(line: string) {
  if (!line.trim()) return;
  try {
    const response = JSON.parse(line) as RpcResponse<unknown>;
    const request = pending.get(response.id);
    if (!request) return;
    pending.delete(response.id);
    if (response.error) request.reject(new Error(response.error));
    else request.resolve(response.result);
  } catch {
    // Ignore malformed output; sidecar diagnostics belong on stderr.
  }
}

function start() {
  const command = Command.sidecar('binaries/local-api');

  command.stdout.on('data', (chunk) => {
    buffer += chunk;
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      handleLine(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf('\n');
    }
  });
  command.stderr.on('data', (line) => console.error('[local-api]', line));
  command.on('error', (error) => failPending(String(error)));
  command.on('close', () => {
    failPending('Local API stopped');
    buffer = '';
    child = undefined;
  });
  return command.spawn();
}

export async function rpc<T>(method: string, params: object = {}, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const starting = child ?? (child = start());
  let process: Child;
  try {
    process = await starting;
  } catch (error) {
    if (child === starting) child = undefined;
    throw error;
  }
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const id = ++nextId;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      pending.delete(id);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    pending.set(id, {
      resolve: (value) => { signal?.removeEventListener('abort', onAbort); resolve(value as T); },
      reject: (error) => { signal?.removeEventListener('abort', onAbort); reject(error); },
    });
    process.write(`${JSON.stringify({ id, method, params })}\n`).catch((error: Error) => {
      pending.delete(id);
      signal?.removeEventListener('abort', onAbort);
      reject(error);
    });
  });
}
