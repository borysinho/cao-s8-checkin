import { env, positiveInteger } from './config.ts';
import { validateResponse } from './api.ts';

type RequestOptions = {
  method: string;
  operationId: string;
  body?: object;
  timeout?: number;
};

export async function internalRequest<Body extends object = Record<string, never>>(
  target: string, token: string, path: string, { method, operationId, body, timeout }: RequestOptions,
): Promise<{ status?: number; body?: Body & { code?: string }; unreachable?: boolean }> {
  try {
    const response = await fetch(new URL(path, env(target)), {
      method,
      headers: { 'X-Internal-Token': env(token), 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeout ?? positiveInteger('HTTP_TIMEOUT_MS')),
      redirect: 'error',
    });
    const payload = response.status === 204 ? undefined : await response.json();
    if (!validateResponse(operationId, response.status, payload)) return {};
    return { status: response.status, body: payload };
  } catch (error) {
    const cause = error instanceof Error ? error.cause as NodeJS.ErrnoException | undefined : undefined;
    return { unreachable: cause?.code === 'ECONNREFUSED' };
  }
}
