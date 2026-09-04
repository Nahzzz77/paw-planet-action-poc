import type { ComfyApiWorkflow, ComfyUploadResult } from './types.ts';

export type ComfyFetch = typeof fetch;

export type ComfyWorkerConfig = {
  id: string;
  baseUrl: string;
  authCookie?: string;
};

export type ComfyQueue = {
  queue_running: unknown[];
  queue_pending: unknown[];
};

export type ComfyHistoryEntry = {
  outputs?: Record<string, Record<string, unknown>>;
  status?: {
    completed?: boolean;
    status_str?: string;
    messages?: unknown[];
  };
};

export type ComfyMediaOutput = {
  nodeId: string;
  slot: string;
  index: number;
  filename: string;
  subfolder: string;
  type: string;
};

export class ComfyHttpError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ComfyHttpError';
    this.status = status;
  }
}

/**
 * A prompt POST is special: a lost response can mean that ComfyUI accepted the
 * prompt even though the caller never received its id. `retrySafe=false` is a
 * hard guard against charging twice for that ambiguous submission.
 */
export class PromptSubmissionError extends Error {
  readonly retrySafe: boolean;

  constructor(message: string, retrySafe: boolean, options?: ErrorOptions) {
    super(message, options);
    this.name = 'PromptSubmissionError';
    this.retrySafe = retrySafe;
  }
}

function normalizeBaseUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('ComfyUI worker endpoint must use http or https.');
  }
  if (url.username || url.password) {
    throw new Error('Do not put ComfyUI credentials in the worker URL.');
  }
  if (url.search) {
    throw new Error('Do not put temporary credentials in the ComfyUI worker URL query string.');
  }
  url.hash = '';
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url;
}

function messageFromBody(body: unknown, fallback: string) {
  if (!body || typeof body !== 'object') return fallback;
  const record = body as Record<string, unknown>;
  if (typeof record.message === 'string') return record.message;
  if (typeof record.error === 'string') return record.error;
  if (record.error && typeof record.error === 'object') {
    const nested = record.error as Record<string, unknown>;
    if (typeof nested.message === 'string') return nested.message;
  }
  return fallback;
}

async function readResponseBody(response: Response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function queueItemPromptId(value: unknown): string | null {
  if (Array.isArray(value) && typeof value[1] === 'string') return value[1];
  if (!isRecord(value)) return null;
  if (typeof value.prompt_id === 'string') return value.prompt_id;
  if (typeof value.promptId === 'string') return value.promptId;
  return null;
}

export function queueContainsPrompt(queue: ComfyQueue, promptId: string) {
  return [...queue.queue_running, ...queue.queue_pending]
    .some((item) => queueItemPromptId(item) === promptId);
}

export function queuedPromptIds(queue: ComfyQueue) {
  return [...queue.queue_running, ...queue.queue_pending]
    .map(queueItemPromptId)
    .filter((promptId): promptId is string => Boolean(promptId));
}

export function getHistoryExecutionError(entry: ComfyHistoryEntry) {
  for (const message of entry.status?.messages ?? []) {
    if (!Array.isArray(message) || typeof message[0] !== 'string') continue;
    if (!['execution_error', 'execution_interrupted'].includes(message[0])) continue;
    const detail = isRecord(message[1]) ? message[1] : {};
    const text = [detail.exception_message, detail.node_type, detail.node_id]
      .filter((part): part is string => typeof part === 'string' && Boolean(part))
      .join(' | ');
    return text || message[0];
  }
  if (entry.status?.status_str === 'error') return 'ComfyUI execution failed.';
  return null;
}

/** Collect every media array emitted by every SaveVideo node, not just `images[0]`. */
export function collectSaveVideoOutputs(
  entry: ComfyHistoryEntry,
  workflow: ComfyApiWorkflow,
): ComfyMediaOutput[] {
  const saveNodeIds = new Set(
    Object.entries(workflow)
      .filter(([, node]) => node.class_type === 'SaveVideo')
      .map(([nodeId]) => nodeId),
  );
  const media: ComfyMediaOutput[] = [];
  const seen = new Set<string>();

  for (const [nodeId, output] of Object.entries(entry.outputs ?? {})) {
    if (!saveNodeIds.has(nodeId) || !isRecord(output)) continue;
    for (const [slot, value] of Object.entries(output)) {
      const values = Array.isArray(value) ? value : [value];
      values.forEach((item, index) => {
        if (!isRecord(item) || typeof item.filename !== 'string') return;
        const animated = output.animated;
        const normalizedSlot = slot === 'images'
          && /\.mp4$/i.test(item.filename)
          && (animated === true || (Array.isArray(animated) && animated[index] === true))
          ? 'videos'
          : slot;
        const candidate = {
          nodeId,
          slot: normalizedSlot,
          index,
          filename: item.filename,
          subfolder: typeof item.subfolder === 'string' ? item.subfolder : '',
          type: typeof item.type === 'string' ? item.type : 'output',
        };
        const key = [candidate.type, candidate.subfolder, candidate.filename, nodeId, slot, index].join('\0');
        if (!seen.has(key)) {
          seen.add(key);
          media.push(candidate);
        }
      });
    }
  }
  return media;
}

export class ComfyWorkerClient {
  readonly id: string;
  readonly endpointIdentity: string;
  readonly #baseUrl: URL;
  readonly #authCookie?: string;
  readonly #fetch: ComfyFetch;

  constructor(config: ComfyWorkerConfig, fetchImpl: ComfyFetch = fetch) {
    if (!config.id.trim()) throw new Error('ComfyUI worker id is required.');
    this.id = config.id;
    this.#baseUrl = normalizeBaseUrl(config.baseUrl);
    this.endpointIdentity = this.#baseUrl.toString();
    this.#authCookie = config.authCookie?.trim() || undefined;
    this.#fetch = fetchImpl;
  }

  #url(path: string) {
    return new URL(path.replace(/^\//, ''), this.#baseUrl);
  }

  #headers(input?: HeadersInit) {
    const headers = new Headers(input);
    if (this.#authCookie) headers.set('Cookie', this.#authCookie);
    return headers;
  }

  async #request(path: string, init?: RequestInit) {
    const response = await this.#fetch(this.#url(path), {
      ...init,
      headers: this.#headers(init?.headers),
    });
    if (!response.ok) {
      const body = await readResponseBody(response);
      throw new ComfyHttpError(
        messageFromBody(body, `ComfyUI worker ${this.id} returned HTTP ${response.status}.`),
        response.status,
      );
    }
    return response;
  }

  async getQueue(): Promise<ComfyQueue> {
    const response = await this.#request('/queue', { cache: 'no-store' });
    const body = await response.json() as Partial<ComfyQueue>;
    if (!Array.isArray(body.queue_running) || !Array.isArray(body.queue_pending)) {
      throw new Error(`ComfyUI worker ${this.id} returned an invalid queue payload.`);
    }
    return { queue_running: body.queue_running, queue_pending: body.queue_pending };
  }

  async preflight() {
    const queue = await this.getQueue();
    return {
      workerId: this.id,
      endpoint: this.endpointIdentity,
      running: queue.queue_running.length,
      pending: queue.queue_pending.length,
      queue,
    };
  }

  async uploadInput(
    bytes: Uint8Array,
    filename: string,
    subfolder: string,
    overwrite = true,
  ): Promise<ComfyUploadResult> {
    const form = new FormData();
    form.append('image', new Blob([new Uint8Array(bytes)]), filename);
    form.append('type', 'input');
    form.append('subfolder', subfolder);
    form.append('overwrite', overwrite ? 'true' : 'false');
    const response = await this.#request('/upload/image', { method: 'POST', body: form });
    const result = await response.json() as Partial<ComfyUploadResult>;
    if (typeof result.name !== 'string' || typeof result.subfolder !== 'string') {
      throw new Error(`ComfyUI worker ${this.id} returned an invalid upload result.`);
    }
    return {
      name: result.name,
      subfolder: result.subfolder,
      type: typeof result.type === 'string' ? result.type : 'input',
    };
  }

  /** Performs exactly one POST. The caller, not this method, owns all retry policy. */
  async submitPrompt(workflow: ComfyApiWorkflow, clientId: string) {
    let response: Response;
    try {
      response = await this.#fetch(this.#url('/prompt'), {
        method: 'POST',
        headers: this.#headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ prompt: workflow, client_id: clientId }),
      });
    } catch (error) {
      throw new PromptSubmissionError(
        `Prompt submission response was lost on worker ${this.id}; automatic retry is forbidden.`,
        false,
        { cause: error },
      );
    }

    const body = await readResponseBody(response);
    if (!response.ok) {
      // Only deterministic validation/auth failures are known to be rejected
      // before execution. Timeouts, rate limits and 5xx responses can be proxy
      // failures after ComfyUI accepted the prompt, so they remain ambiguous.
      const retrySafe = [400, 401, 403, 404, 422].includes(response.status);
      throw new PromptSubmissionError(
        messageFromBody(body, `ComfyUI worker ${this.id} rejected the prompt with HTTP ${response.status}.`),
        retrySafe,
      );
    }
    if (isRecord(body) && typeof body.prompt_id === 'string' && body.prompt_id) {
      return {
        promptId: body.prompt_id,
        number: typeof body.number === 'number' ? body.number : null,
        nodeErrors: isRecord(body.node_errors) ? body.node_errors : {},
      };
    }
    const hasNodeErrors = isRecord(body)
      && isRecord(body.node_errors)
      && Object.keys(body.node_errors).length > 0;
    if (isRecord(body) && (body.error || hasNodeErrors)) {
      throw new PromptSubmissionError(
        messageFromBody(body, `ComfyUI worker ${this.id} rejected the prompt.`),
        true,
      );
    }
    throw new PromptSubmissionError(
      `Worker ${this.id} returned no prompt id; automatic retry is forbidden.`,
      false,
    );
  }

  async getHistory(promptId: string) {
    const response = await this.#request(`/history/${encodeURIComponent(promptId)}`, { cache: 'no-store' });
    const body = await response.json() as Record<string, ComfyHistoryEntry>;
    return body[promptId] ?? null;
  }

  async downloadOutput(output: ComfyMediaOutput) {
    const params = new URLSearchParams({
      filename: output.filename,
      subfolder: output.subfolder,
      type: output.type,
    });
    const response = await this.#request(`/view?${params.toString()}`, { cache: 'no-store' });
    return new Uint8Array(await response.arrayBuffer());
  }
}
