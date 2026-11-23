import { readFileSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import { Ajv } from 'ajv';
import type { AnySchemaObject, ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import type { FormatsPlugin } from 'ajv-formats';
import express from 'express';
import type { ErrorRequestHandler, Request, RequestHandler, Response } from 'express';
import jwt from 'jsonwebtoken';
import YAML from 'yaml';
import { env } from './config.ts';
import type { Role } from './contracts.ts';

type Method = 'get' | 'post' | 'put' | 'delete';
type Security = { BearerAuth?: string[]; InternalToken?: string[] };
type Reference = { $ref: string };
type Content = { 'application/json'?: { schema: AnySchemaObject } };
type Parameter = {
  in: 'path' | 'query' | 'header';
  name: string;
  required: boolean;
  schema: AnySchemaObject;
};
type OperationSpec = {
  operationId: string;
  tags: string[];
  security?: Security[];
  parameters?: (Parameter | Reference)[];
  requestBody?: { content: Content };
  responses: Record<string, { content?: Content } | Reference>;
};
type OpenApi = {
  security: Security[];
  paths: Record<string, Partial<Record<Method, OperationSpec>>>;
};

export const contract: OpenApi = YAML.parse(
  readFileSync(new URL('../../contracts/openapi.yaml', import.meta.url), 'utf8'),
);
const schemaId = 'https://entradasya.example.test/openapi';
const validator = new Ajv({ strict: false });
(addFormats as unknown as FormatsPlugin)(validator);
validator.addSchema(contract, schemaId);

function resolve<T>(value: T | Reference): T {
  if (typeof value === 'object' && value !== null && '$ref' in value) {
    const pointer = (value as Reference).$ref.slice(2).split('/');
    let current: unknown = contract;
    for (const part of pointer) current = (current as Record<string, unknown>)[part];
    return current as T;
  }
  return value;
}

function compile(schema: AnySchemaObject | undefined): ValidateFunction | null {
  if (!schema) return null;
  if (schema.$ref) return validator.compile({ $ref: schemaId + schema.$ref });
  return validator.compile(schema);
}

type Operation = {
  path: string;
  method: Method;
  security?: Security;
  parameters: (Parameter & { validate: ValidateFunction })[];
  responses: Record<string, ValidateFunction | null>;
  body: ValidateFunction | null;
};

const operations = new Map<string, Operation>();
for (const [path, methods] of Object.entries(contract.paths)) {
  for (const [method, spec] of Object.entries(methods)) {
    const security = (spec.security ?? contract.security)[0];
    const parameters = (spec.parameters ?? []).map((reference) => {
      const parameter = resolve<Parameter>(reference);
      return { ...parameter, validate: validator.compile(parameter.schema) };
    });
    const responses = Object.fromEntries(Object.entries(spec.responses).map(([status, response]) => [
      status, compile(resolve<{ content?: Content }>(response).content?.['application/json']?.schema),
    ]));
    operations.set(spec.operationId, {
      path, method: method as Method, security, parameters, responses,
      body: compile(spec.requestBody?.content['application/json']?.schema),
    });
  }
}

export class ApiError extends Error {
  status: number;
  body: { code: string; message: string; orderId?: string };

  constructor(status: number, code: string, message: string, details: { orderId?: string } = {}) {
    super(message);
    this.status = status;
    this.body = { code, message, ...details };
  }
}
export const notFound = () => new ApiError(404, 'NOT_FOUND', 'Recurso inexistente.');
export const unavailable = () => new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'Dependencia temporalmente indisponible.');
export const conflict = (code: string, message: string) => new ApiError(409, code, message);

type Level = 'info' | 'warn' | 'error';
export type Log = (level: Level, message: string, ids?: Record<string, string>) => void;

export function logger(service: string, threshold = 'info'): Log {
  const levels = ['info', 'warn', 'error'];
  return (level, message, ids = {}) => {
    if (levels.indexOf(level) >= levels.indexOf(threshold)) {
      console.log(JSON.stringify({ date: new Date().toISOString(), level, service, message, ...ids }));
    }
  };
}

type Actor = { sub: string };
type RouteOptions = { role?: Role; token?: string; bodyLimit?: string };
type RouteRequest<Body> = Request<Record<string, string>, unknown, Body, Record<string, string | undefined>>;
type AuthenticatedRequest<Body> = RouteRequest<Body> & { actor: Actor };
type Handler<Body, Req = RouteRequest<Body>> = (req: Req, res: Response) => unknown;

function authorize(req: Request, security: Security | undefined, options: RouteOptions): Actor | undefined {
  if (!security) return undefined;
  if (security.InternalToken && options.token) {
    const provided = req.get('X-Internal-Token');
    if (!provided) throw new ApiError(401, 'UNAUTHORIZED', 'Credencial interna requerida.');
    const actual = Buffer.from(provided);
    const expected = Buffer.from(env(options.token));
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new ApiError(403, 'FORBIDDEN', 'Credencial interna insuficiente.');
    }
    return undefined;
  }
  const match = /^Bearer (\S+)$/i.exec(req.get('Authorization') ?? '');
  let claims: jwt.JwtPayload;
  try {
    if (!match) throw new Error();
    const value = jwt.verify(match[1], env('JWT_SECRET'), { algorithms: ['HS256'] });
    if (typeof value === 'string' || !value.exp || typeof value.sub !== 'string') throw new Error();
    claims = value;
  } catch {
    throw new ApiError(401, 'UNAUTHORIZED', 'Sesión ausente, inválida o expirada.');
  }
  if (claims.role !== options.role) throw new ApiError(403, 'FORBIDDEN', 'Rol insuficiente.');
  return { sub: claims.sub! };
}

function badRequest() {
  return new ApiError(400, 'INVALID_REQUEST', 'Solicitud inválida.');
}

export function createApi(log: Log) {
  const app = express();
  app.disable('x-powered-by');
  const json = express.json({ limit: '32kb' });

  function route<Body = unknown>(
    id: string, options: { role: Role; bodyLimit?: string }, handle: Handler<Body, AuthenticatedRequest<Body>>,
  ): void;
  function route<Body = unknown>(
    id: string, options: { role?: never; token?: string }, handle: Handler<Body>,
  ): void;
  function route<Body>(
    id: string, options: RouteOptions, handle: Handler<Body> | Handler<Body, AuthenticatedRequest<Body>>,
  ) {
    const spec = operations.get(id);
    if (!spec) throw new Error(`Operación desconocida: ${id}.`);
    if (spec.security?.InternalToken && !options.token) throw new Error(`Falta credencial para ${id}.`);
    if (spec.security?.BearerAuth && !options.role) throw new Error(`Falta rol para ${id}.`);
    const dispatch: RequestHandler = async (req, res) => {
      const actor = authorize(req, spec.security, options);
      const sources = { path: req.params, query: req.query, header: req.headers };
      for (const param of spec.parameters) {
        const key = param.in === 'header' ? param.name.toLowerCase() : param.name;
        const value = sources[param.in][key];
        if ((param.required || value !== undefined) && !param.validate(value)) throw badRequest();
      }
      if (spec.body && !spec.body(req.body)) throw badRequest();
      const request = req as RouteRequest<Body>;
      if (actor) {
        await (handle as Handler<Body, AuthenticatedRequest<Body>>)(Object.assign(request, { actor }), res);
      } else {
        await (handle as Handler<Body>)(request, res);
      }
    };
    app[spec.method](spec.path.replaceAll(/\{(\w+)\}/g, ':$1'),
      options.bodyLimit ? express.json({ limit: options.bodyLimit }) : json, dispatch);
  }

  function finish() {
    app.use((_req, _res, next) => next(notFound()));
    const respondError: ErrorRequestHandler = (error, _req, res, next) => {
      if (res.headersSent) return next(error);
      if (['entity.parse.failed', 'entity.too.large', 'charset.unsupported', 'encoding.unsupported'].includes(error.type)
          || error instanceof URIError) error = badRequest();
      if (!(error instanceof ApiError)) {
        log('error', 'Fallo inesperado al procesar la petición.');
        error = unavailable();
      }
      const failure: ApiError = error;
      res.status(failure.status).json(failure.body);
    };
    app.use(respondError);
    return app;
  }

  return { route, finish };
}

export type Api = ReturnType<typeof createApi>;

export function validateResponse(id: string, status: number, value: unknown): boolean {
  const operation = operations.get(id);
  if (!operation || !Object.hasOwn(operation.responses, status)) return false;
  return operation.responses[status]?.(value) ?? true;
}
