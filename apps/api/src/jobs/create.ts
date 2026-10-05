/**
 * The one way a paid job is created (review 2 Oct, architecture P1).
 *
 * Every route that spends money does the same four things, in one transaction: lock the
 * account row so two requests cannot both squeeze under a limit (MB-03); answer a repeated
 * idempotency key with the job it already made (DF-05); insert the job; reserve its price from
 * the pot (D31). Then nudge the runner. Routes only decide *what* to make; this decides *how* a
 * job comes to exist, so the three routes cannot drift apart again.
 */
import { and, eq } from 'drizzle-orm';
import type { GenerationModel, QuoteOptions } from '@storyboard/models';
import { db, schema } from '../db/client.ts';
import { reserve, type Tx } from '../generation/budget.ts';
import type { Job } from './runner.ts';

type NewJob = typeof schema.generationJobs.$inferInsert;

export interface JobPlan<Extra> {
  /** Everything about the job except who asked and the idempotency key, which are the caller's. */
  values: Omit<NewJob, 'accountId' | 'requestKey'> & { projectId: string; modelId: string; provider: string };
  /** What to reserve: the same inputs the quote was shown with (MB-01). */
  reserve: QuoteOptions & { model: GenerationModel };
  /** Anything the route wants back alongside the job (a presented plan, a saved cast). */
  extra: Extra;
}

export interface JobCreated<Extra> {
  job: Job;
  /** False when the idempotency key had already made this job: nothing new was spent. */
  fresh: boolean;
  extra: Extra | null;
}

export async function createJob<Extra>(
  input: { accountId: string; requestKey: string; runner: { tick(): Promise<number> }; log: { error: (e: unknown, msg: string) => void } },
  plan: (tx: Tx) => Promise<JobPlan<Extra>>,
): Promise<JobCreated<Extra>> {
  const created = await db.transaction(async (tx): Promise<JobCreated<Extra>> => {
    await tx.select({ id: schema.accounts.id }).from(schema.accounts).where(eq(schema.accounts.id, input.accountId)).for('update');
    const [previous] = await tx.select().from(schema.generationJobs)
      .where(and(eq(schema.generationJobs.accountId, input.accountId), eq(schema.generationJobs.requestKey, input.requestKey)));
    if (previous) return { job: previous, fresh: false, extra: null };
    const p = await plan(tx);
    const [job] = await tx.insert(schema.generationJobs).values({ ...p.values, accountId: input.accountId, requestKey: input.requestKey }).returning();
    const { model, ...options } = p.reserve;
    await reserve(tx, { accountId: input.accountId, projectId: p.values.projectId, jobId: job!.id, model, ...options });
    return { job: job!, fresh: true, extra: p.extra };
  });
  if (created.fresh) void input.runner.tick().catch((e) => input.log.error(e, 'runner tick'));
  return created;
}
