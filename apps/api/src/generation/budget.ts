/**
 * Money (plan D31, DM-25/DM-26).
 *
 * Every job reserves its estimated cost inside the same transaction that creates it, with
 * the account row locked, so two requests cannot both squeeze under the cap. Settling
 * replaces the estimate with the real cost when the provider reports one; refunding marks
 * the row so it no longer counts. Caps are per UTC day and per UTC month.
 */
import { and, eq, gte, inArray, sql as raw } from 'drizzle-orm';
import type { GenerationModel } from '@storyboard/models';
import { estimatePence, unitsFor } from '@storyboard/models';
import { db, schema } from '../db/client.ts';
import { ApiError, ProblemType } from '../errors.ts';

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export function startOfDay(now = new Date()): Date { const d = new Date(now); d.setUTCHours(0, 0, 0, 0); return d; }
export function startOfMonth(now = new Date()): Date { const d = startOfDay(now); d.setUTCDate(1); return d; }

async function spent(database: typeof db | Tx, accountId: string, since: Date): Promise<number> {
  const [row] = await database
    .select({ pence: raw<number>`COALESCE(SUM(COALESCE(${schema.generationLedger.actualPence}, ${schema.generationLedger.estimatedPence})), 0)::int` })
    .from(schema.generationLedger)
    .where(and(eq(schema.generationLedger.accountId, accountId), gte(schema.generationLedger.createdAt, since), inArray(schema.generationLedger.status, ['reserved', 'settled'])));
  return row?.pence ?? 0;
}

export interface Allowance {
  daily_budget_pence: number;
  monthly_budget_pence: number;
  spent_today_pence: number;
  spent_this_month_pence: number;
  remaining_today_pence: number;
  remaining_this_month_pence: number;
  resets_at: string;
  currency: string;
}

export async function allowance(accountId: string, database: typeof db | Tx = db): Promise<Allowance> {
  const [account] = await database.select().from(schema.accounts).where(eq(schema.accounts.id, accountId));
  if (!account) throw ApiError.notFound('Account');
  const now = new Date();
  const [today, month] = await Promise.all([spent(database, accountId, startOfDay(now)), spent(database, accountId, startOfMonth(now))]);
  const tomorrow = startOfDay(now); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  return {
    daily_budget_pence: account.dailyBudgetPence,
    monthly_budget_pence: account.monthlyBudgetPence,
    spent_today_pence: today,
    spent_this_month_pence: month,
    remaining_today_pence: Math.max(0, account.dailyBudgetPence - today),
    remaining_this_month_pence: Math.max(0, account.monthlyBudgetPence - month),
    resets_at: tomorrow.toISOString(),
    currency: account.currency,
  };
}

/** Plain words for a 10-year-old: "about 12 more pictures today". */
export function allowanceInWords(a: Allowance, cheapestImagePence: number | null, cheapestClipPence: number | null): string {
  const left = Math.min(a.remaining_today_pence, a.remaining_this_month_pence);
  if (left <= 0) return a.remaining_today_pence <= 0 ? 'No more picture money today. It comes back tomorrow.' : 'No more picture money this month.';
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
  constructor(detail: string, resetsAt: string) {
    super(402, `${ProblemType.validation.replace('/validation', '')}/budget`, 'Out of picture money', detail, { current_state: { resets_at: resetsAt } });
  }
}

/**
 * Reserve the estimated cost of a job. Call inside a transaction that has already locked
 * the account row (`FOR UPDATE`), after the job row exists.
 */
export async function reserve(tx: Tx, input: { accountId: string; projectId: string; jobId: string; model: GenerationModel; count?: number; durationSeconds?: number; resolution?: string }) {
  const [account] = await tx.select().from(schema.accounts).where(eq(schema.accounts.id, input.accountId));
  if (!account) throw ApiError.notFound('Account');
  const estimated = estimatePence(input.model, input);
  const now = new Date();
  const [today, month] = await Promise.all([spent(tx, input.accountId, startOfDay(now)), spent(tx, input.accountId, startOfMonth(now))]);
  const tomorrow = startOfDay(now); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  if (today + estimated > account.dailyBudgetPence) {
    throw new BudgetError(`That would cost about ${pence(estimated)}, and there is ${pence(Math.max(0, account.dailyBudgetPence - today))} of picture money left today. It comes back tomorrow.`, tomorrow.toISOString());
  }
  if (month + estimated > account.monthlyBudgetPence) {
    const next = startOfMonth(now); next.setUTCMonth(next.getUTCMonth() + 1);
    throw new BudgetError(`That would cost about ${pence(estimated)}, and there is ${pence(Math.max(0, account.monthlyBudgetPence - month))} of picture money left this month.`, next.toISOString());
  }
  const [row] = await tx.insert(schema.generationLedger).values({
    accountId: input.accountId, projectId: input.projectId, jobId: input.jobId, modelId: input.model.id,
    units: unitsFor(input.model, input), unitCostPence: String(input.model.unit_cost_pence), estimatedPence: estimated, currency: account.currency,
  }).returning();
  return { ledger: row!, estimated };
}

export async function settle(jobId: string, actualPence: number | null = null, database: typeof db | Tx = db) {
  await database.update(schema.generationLedger).set({ status: 'settled', ...(actualPence !== null ? { actualPence } : {}) })
    .where(and(eq(schema.generationLedger.jobId, jobId), eq(schema.generationLedger.status, 'reserved')));
}

export async function refund(jobId: string, database: typeof db | Tx = db) {
  await database.update(schema.generationLedger).set({ status: 'refunded', actualPence: 0 })
    .where(and(eq(schema.generationLedger.jobId, jobId), inArray(schema.generationLedger.status, ['reserved', 'settled'])));
}
