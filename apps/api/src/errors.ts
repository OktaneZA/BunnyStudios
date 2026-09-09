/**
 * RFC 7807 problem+json, per the §10 API conventions.
 *
 * Every error the API emits has a stable `type`, a `title`, a `detail`, and — on validation
 * failures — a `field_errors` map. The 409 conflict shape additionally carries `current_state`
 * so a stale client can run the NF-10b field-level diff without a second round trip.
 */
import type { FastifyReply, FastifyInstance, FastifyError } from 'fastify';
import { ZodError } from 'zod';

const BASE = 'https://storyboard.studio/problems';

export const ProblemType = {
  validation: `${BASE}/validation`,
  unauthorized: `${BASE}/unauthorized`,
  forbidden: `${BASE}/forbidden`,
  notFound: `${BASE}/not-found`,
  conflict: `${BASE}/conflict`,
  internal: `${BASE}/internal`,
} as const;

export interface Problem {
  type: string;
  title: string;
  status: number;
  detail: string;
  field_errors?: Record<string, string[]>;
  current_state?: unknown;
}

export class ApiError extends Error {
  // Written out longhand rather than as constructor parameter properties: Node's
  // strip-only TypeScript support does not implement them, and the API runs from
  // source under `node src/server.ts`.
  readonly status: number;
  readonly type: string;
  readonly title: string;
  readonly extra: Partial<Problem>;

  constructor(
    status: number,
    type: string,
    title: string,
    message: string,
    extra: Partial<Problem> = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.type = type;
    this.title = title;
    this.extra = extra;
  }

  static unauthorized(detail = 'Authentication is required.'): ApiError {
    return new ApiError(401, ProblemType.unauthorized, 'Unauthorized', detail);
  }

  static notFound(what = 'Resource'): ApiError {
    return new ApiError(404, ProblemType.notFound, 'Not found', `${what} was not found.`);
  }

  static validation(detail: string, fieldErrors?: Record<string, string[]>): ApiError {
    return new ApiError(422, ProblemType.validation, 'Validation failed', detail, {
      ...(fieldErrors ? { field_errors: fieldErrors } : {}),
    });
  }

  /** Stale optimistic-concurrency write (NF-10). Carries the server's current record. */
  static conflict(detail: string, currentState: unknown): ApiError {
    return new ApiError(409, ProblemType.conflict, 'Version conflict', detail, {
      current_state: currentState,
    });
  }
}

export function send(reply: FastifyReply, problem: Problem): FastifyReply {
  return reply.status(problem.status).type('application/problem+json').send(problem);
}

export function registerErrorHandler(
  app: FastifyInstance,
  options: { spaFallback?: boolean } = {},
): void {
  app.setNotFoundHandler((request, reply) => {
    // Client-side routes (/projects/123) must load the app shell; only the API and
    // non-GET requests get a problem+json 404.
    const isApi = request.url === '/api' || request.url.startsWith('/api/');
    if (options.spaFallback && !isApi && (request.method === 'GET' || request.method === 'HEAD')) {
      return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
    }
    return send(reply, {
      type: ProblemType.notFound,
      title: 'Not found',
      status: 404,
      detail: `No route for ${request.method} ${request.url}.`,
    });
  });

  app.setErrorHandler((error: FastifyError | ApiError | ZodError, request, reply) => {
    if (error instanceof ApiError) {
      return send(reply, {
        type: error.type,
        title: error.title,
        status: error.status,
        detail: error.message,
        ...error.extra,
      });
    }

    if (error instanceof ZodError) {
      const fieldErrors: Record<string, string[]> = {};
      for (const issue of error.issues) {
        const key = issue.path.join('.') || '(root)';
        (fieldErrors[key] ??= []).push(issue.message);
      }
      return send(reply, {
        type: ProblemType.validation,
        title: 'Validation failed',
        status: 422,
        detail: 'The request body did not match the expected shape.',
        field_errors: fieldErrors,
      });
    }

    const status = (error as FastifyError).statusCode ?? 500;
    if (status >= 500) request.log.error({ err: error }, 'unhandled error');

    return send(reply, {
      type: status >= 500 ? ProblemType.internal : ProblemType.validation,
      title: status >= 500 ? 'Internal server error' : 'Bad request',
      status,
      // Never leak internals to the client on a 5xx.
      detail: status >= 500 ? 'An unexpected error occurred.' : error.message,
    });
  });
}
