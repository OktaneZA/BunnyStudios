/**
 * Money (plan D31, DM-25/DM-26): pre-paid.
 *
 * An adult adds money to an account's pot (credit_top_ups). Every job reserves its estimated
 * cost from the pot inside the same transaction that creates it, with the account row locked,
 * so two requests cannot both squeeze under a limit. Settling replaces the estimate with the
 * real cost when the provider reports one; refunding marks the row so it no longer counts. The
 * pot is derived, never stored: top-ups minus everything the ledger still counts. A daily cap
 * (per UTC day) limits how fast the pot can be spent.
 */
import { and, eq, gte, inArray, sql as raw } from 'drizzle-orm';
import type { GenerationModel, QuoteOptions } from '@storyboard/models';
import { quoteGeneration } from '@storyboard/models';
import { db, schema } from '../db/client.ts';
import { ApiError, ProblemType } from '../errors.ts';

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export function startOfDay(now = new Date()): Date { const d = new Date(now); d.setUTCHours(0, 0, 0, 0); return d; }

/** What the ledger still counts since `since` (all time when omitted): the real bill where known, else the estimate. */
async function spent(database: typeof db | Tx, accountId: string, since?: Date): Promise<number> {
  const [row] = await database
    .select({ pence: raw<number>`COALESCE(SUM(COALESCE(${schema.generationLedger.actualPence}, ${schema.generationLedger.estimatedPence})), 0)::int` })
    .from(schema.generationLedger)
    .where(and(eq(schema.generationLedger.accountId, accountId), ...(since ? [gte(schema.generationLedger.createdAt, since)] : []), inArray(schema.generationLedger.status, ['reserved', 'settled'])));
  return row?.pence ?? 0;
}

async function toppedUp(database: typeof db | Tx, accountId: string): Promise<number> {
  const [row] = await database.select({ pence: raw<number>`COALESCE(SUM(${schema.creditTopUps.pence}), 0)::int` })
    .from(schema.creditTopUps).where(eq(schema.creditTopUps.accountId, accountId));
  return row?.pence ?? 0;
}

export interface Allowance {
  /** The pre-paid pot: what is left to spend, ever, until an adult adds more. */
  pot_pence: number;
  topped_up_pence: number;
  spent_all_time_pence: number;
  daily_budget_pence: number;
  spent_today_pence: number;
  remaining_today_pence: number;
  resets_at: string;
  currency: string;
}

export async function allowance(accountId: string, database: typeof db | Tx = db): Promise<Allowance> {
  const [account] = await database.select().from(schema.accounts).where(eq(schema.accounts.id, accountId));
  if (!account) throw ApiError.notFound('Account');
  const now = new Date();
  const [today, all, added] = await Promise.all([spent(database, accountId, startOfDay(now)), spent(database, accountId), toppedUp(database, accountId)]);
  const tomorrow = startOfDay(now); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  return {
    pot_pence: Math.max(0, added - all),
    topped_up_pence: added,
    spent_all_time_pence: all,
    daily_budget_pence: account.dailyBudgetPence,
    spent_today_pence: today,
    remaining_today_pence: Math.max(0, account.dailyBudgetPence - today),
    resets_at: tomorrow.toISOString(),
    currency: account.currency,
  };
}

/** Plain words for a 10-year-old: "about 12 more pictures today". */
export function allowanceInWords(a: Allowance, cheapestImagePence: number | null, cheapestClipPence: number | null): string {
  const left = Math.min(a.remaining_today_pence, a.pot_pence);
  if (left <= 0) return a.pot_pence <= 0 ? 'Your pot is empty. Ask a grown-up to add more picture money.' : 'No more picture money today. It comes back tomorrow.';
  const parts: string[] = [];
  if (cheapestImagePence && cheapestImagePence > 0) parts.push(`about ${Math.floor(left / cheapestImagePence)} more pictures`);
  if (cheapestClipPence && cheapestClipPence > 0) parts.push(`about ${Math.floor(left / cheapestClipPence)} clips`);
  if (!parts.length) return `You have ${pence(left)} left today.`;
  return `You can make ${parts.join(' or ')} today.`;
}

export function pence(p: number): string {
  if (p < 100) return `${Math.max(0, Math.round(p))}p`;
  return `£${(p / 100).toFixed(2)}`;
}

export class BudgetError extends ApiError {
  /** `resetsAt` is null when waiting will not help: the pot needs an adult. */
  constructor(detail: string, resetsAt: string | null) {
    super(402, `${ProblemType.validation.replace('/validation', '')}/budget`, 'Out of picture money', detail, { current_state: { resets_at: resetsAt, needs_top_up: resetsAt === null } });
  }
}

/** An adult adds money to an account's pot. Returns the pot after the top-up. */
export async function topUp(input: { accountId: string; addedBy: string; pence: number; note: string }, database: typeof db | Tx = db) {
  if (!Number.isInteger(input.pence) || input.pence <= 0) throw ApiError.validation('Enter an amount to add.');
  const [row] = await database.insert(schema.creditTopUps).values({ accountId: input.accountId, addedByAccountId: input.addedBy, pence: input.pence, note: input.note }).returning();
  return row!;
}

/**
 * Reserve the estimated cost of a job. Call inside a transaction that has already locked
 * the account row (`FOR UPDATE`), after the job row exists.
 */
export async function reserve(tx: Tx, input: { accountId: string; projectId: string; jobId: string; model: GenerationModel } & QuoteOptions) {
  const [account] = await tx.select().from(schema.accounts).where(eq(schema.accounts.id, input.accountId));
  if (!account) throw ApiError.notFound('Account');
  // The same calculation the price check showed (MB-01), with its provenance (MB-02).
  const quote = quoteGeneration(input.model, input);
  const estimated = quote.pence;
  const now = new Date();
  const [today, all, added] = await Promise.all([spent(tx, input.accountId, startOfDay(now)), spent(tx, input.accountId), toppedUp(tx, input.accountId)]);
  const tomorrow = startOfDay(now); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const pot = added - all;
  // The pot first: an empty pot is the adult's decision, and no day will refill it.
  if (estimated > pot) {
    throw new BudgetError(`That would cost about ${pence(estimated)}, and there is ${pence(Math.max(0, pot))} left in the pot. Ask a grown-up to add more picture money.`, null);
  }
  if (today + estimated > account.dailyBudgetPence) {
    throw new BudgetError(`That would cost about ${pence(estimated)}, and there is ${pence(Math.max(0, account.dailyBudgetPence - today))} of picture money left today. It comes back tomorrow.`, tomorrow.toISOString());
  }
  const [row] = await tx.insert(schema.generationLedger).values({
    accountId: input.accountId, projectId: input.projectId, jobId: input.jobId, modelId: input.model.id,
    units: quote.snapshot.units, unitCostPence: String(input.model.unit_cost_pence), estimatedPence: estimated, currency: account.currency,
    costState: 'estimated', pricingSnapshot: quote.snapshot,
  }).returning();
  return { ledger: row!, estimated, quote };
}

/**
 * The job produced its result. With an actual provider cost the row records it; without one the
 * estimate stands and says so (MB-04). Settles once: a second call finds no reserved row.
 */
export async function settle(jobId: string, actualPence: number | null = null, database: typeof db | Tx = db) {
  await database.update(schema.generationLedger).set({ status: 'settled', ...(actualPence !== null ? { actualPence, costState: 'actual' as const } : { costState: 'estimated' as const }) })
    .where(and(eq(schema.generationLedger.jobId, jobId), eq(schema.generationLedger.status, 'reserved')));
}

/**
 * Work reached the provider and may be billed, but the amount is not confirmed: a cancel after
 * submission, a failure after a paid part, an ambiguous submit. The estimate keeps counting
 * against the allowance, marked unknown, instead of claiming zero cost (MB-04, MG-08).
 */
export async function keepAsUnknown(jobId: string, database: typeof db | Tx = db) {
  await database.update(schema.generationLedger).set({ status: 'settled', costState: 'unknown' })
    .where(and(eq(schema.generationLedger.jobId, jobId), eq(schema.generationLedger.status, 'reserved')));
}

/** Nothing reached the provider, so nothing can be billed: the reservation goes back. */
export async function refund(jobId: string, database: typeof db | Tx = db) {
  await database.update(schema.generationLedger).set({ status: 'refunded', actualPence: 0, costState: 'not_incurred' })
    .where(and(eq(schema.generationLedger.jobId, jobId), inArray(schema.generationLedger.status, ['reserved', 'settled'])));
}

/** True when any of this job's paid work was sent to a provider (or may have been). */
export function reachedProvider(job: { providerJobId: string | null; submissionState: string; request: unknown }): boolean {
  const parts = (job.request as { partJobIds?: string[] } | null)?.partJobIds ?? [];
  return Boolean(job.providerJobId) || parts.length > 0 || job.submissionState !== 'not_submitted';
}
