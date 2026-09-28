import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import fastifyStatic from '@fastify/static';
import multipart from '@fastify/multipart';
import { config } from './config.ts';
import { registerErrorHandler, ApiError } from './errors.ts';
import { authRoutes } from './routes/auth.ts';
import { projectRoutes } from './routes/projects.ts';
import { sceneRoutes } from './routes/scenes.ts';
import { thumbnailRoutes } from './routes/thumbnails.ts';
import type { ThumbnailProvider } from './thumbnails/provider.ts';
import type { SceneImprovementProvider } from './scenes/improver.ts';
import { directorRoutes } from './routes/director.ts';
import { castRoutes } from './routes/cast.ts';
import { timelineRoutes } from './routes/timeline.ts';
import { productionRoutes } from './routes/production.ts';
import { createDirectorServices, type DirectorOverrides, type DirectorServices } from './director.ts';

declare module 'fastify' {
  interface FastifyInstance {
    director: DirectorServices;
    requireAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    /** Set by requireAuth from the verified token. Never read from the request body (NF-13). */
    accountId: string;
  }
}

export async function buildApp(options: { thumbnailProvider?: ThumbnailProvider; improvementProvider?: SceneImprovementProvider; director?: DirectorOverrides } = {}): Promise<FastifyInstance & { director: DirectorServices }> {
  const app = Fastify({
    logger:
      config.NODE_ENV === 'test'
        ? false
        : config.isProduction
          ? true
          : { level: 'info' },
    // Azure Container Apps terminates TLS at the ingress and forwards the original
    // client address; without this, rate limiting and logs would see the proxy.
    trustProxy: config.isProduction,
  });

  await app.register(cors, {
    origin: config.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'If-Match', 'Idempotency-Key'],
  });

  await app.register(jwt, { secret: config.JWT_SECRET });
  await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024, files: 1 } });

  const director = createDirectorServices(options.director ?? {});
  app.decorate('director', director);
  app.addHook('onClose', async () => { await director.runner.stop(); });
  // Tests drive the runner by hand (drain), so it never starts under node --test.
  if (config.GENERATION_RUNNER === 'on' && config.NODE_ENV !== 'test' && !process.env.NODE_TEST_CONTEXT) director.runner.start();

  app.decorate('requireAuth', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const payload = await request.jwtVerify<{ sub: string }>();
      request.accountId = payload.sub;
      reply.header('Cache-Control', 'private, no-store');
    } catch {
      throw ApiError.unauthorized('A valid bearer token is required.');
    }
  });

  if (config.WEB_ROOT) {
    // Production: the built web app and the API share one origin (see deploy/).
    await app.register(fastifyStatic, {
      root: config.WEB_ROOT,
      prefix: '/',
      wildcard: false,
      index: ['index.html'],
      // Let setHeaders below own Cache-Control instead of the plugin's default max-age=0.
      cacheControl: false,
      // Hashed asset filenames can be cached forever; index.html must always be re-fetched
      // so a redeploy is picked up without a hard refresh.
      setHeaders: (res, path) => {
        res.setHeader('Cache-Control', path.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
  }

  registerErrorHandler(app, { spaFallback: Boolean(config.WEB_ROOT) });

  app.get('/health', async () => ({
    status: 'ok',
    version: config.APP_VERSION,
    commit: config.GIT_COMMIT,
    build: config.BUILD_TAG,
  }));

  await app.register(
    async (v1) => {
      await v1.register(authRoutes);
      await v1.register(projectRoutes);
      await v1.register(sceneRoutes);
      const providers = {
        ...(options.thumbnailProvider ? { provider: options.thumbnailProvider } : {}),
        ...(options.improvementProvider ? { improvementProvider: options.improvementProvider } : {}),
      };
      await v1.register(thumbnailRoutes, providers);
      await v1.register(thumbnailRoutes, { ...providers, kind: 'improvement' });
      await v1.register(directorRoutes, director);
      await v1.register(castRoutes, director);
      await v1.register(timelineRoutes, director);
      await v1.register(productionRoutes, director);
    },
    { prefix: '/api/v1' },
  );

  return app as FastifyInstance & { director: DirectorServices };
}
