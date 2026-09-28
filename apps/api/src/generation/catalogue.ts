/**
 * Which models this deployment can actually run: the catalogue filtered by which adapter
 * has a key (DM-3) and by each model's release gate (build plan Stage 1/6). Tests inject a
 * fake provider and a fake catalogue.
 */
import { ALL_MODELS, createVideoModelRegistry, type VideoModelDefinition, type VideoModelRequirements, type GenerationModel, type ModelKind } from '@storyboard/models';
import { config } from '../config.ts';
import type { GenerationProvider } from './provider.ts';

export interface Catalogue {
  providers: Map<string, GenerationProvider>;
  models: GenerationModel[];
  /** Every model with a working adapter, gated or not. For lookups of existing jobs. */
  enabled(): GenerationModel[];
  /** What this kind of account may start new work with: gated models only for Advanced. */
  available(advanced: boolean): GenerationModel[];
  find(id: string): GenerationModel | undefined;
  providerFor(model: GenerationModel): GenerationProvider | undefined;
  cheapest(kind: ModelKind): GenerationModel | undefined;
  /** Production video models matching the requirements (Simple-mode routing never sees gated ones). */
  videoModels(requirements?: VideoModelRequirements, advanced?: boolean): VideoModelDefinition[];
}

/** A model still waiting for its live check is Advanced-only unless the adult switched the gate. */
export function isGated(model: GenerationModel): boolean {
  return model.video?.rollout === 'advanced' && config.VIDEO_FAMILY_ROLLOUT !== 'all';
}

export function createCatalogue(providers: GenerationProvider[], models: GenerationModel[] = ALL_MODELS as GenerationModel[]): Catalogue {
  const map = new Map(providers.map((p) => [p.name, p]));
  const catalogue: Catalogue = {
    providers: map,
    models,
    enabled: () => models.filter((m) => m.enabled && map.get(m.provider)?.enabled),
    available: (advanced) => catalogue.enabled().filter((m) => !isGated(m) || (advanced && config.VIDEO_FAMILY_ROLLOUT !== 'off')),
    find: (id) => models.find((m) => m.id === id),
    providerFor: (model) => map.get(model.provider),
    cheapest: (kind) => catalogue.available(false).filter((m) => m.kind === kind).sort((a, b) => a.unit_cost_pence - b.unit_cost_pence)[0],
    videoModels: (requirements, advanced = false) => createVideoModelRegistry(catalogue.available(advanced)).matching(requirements),
  };
  return catalogue;
}

/** What the client sees. Real names only for the adult; keys never. */
export function presentModel(m: GenerationModel, advanced: boolean) {
  return {
    id: m.id,
    kind: m.kind,
    tier: m.tier ?? null,
    friendly_label: m.friendlyLabel,
    label: advanced ? m.label : null,
    provider: advanced ? m.provider : null,
    help: m.help,
    icon: m.icon,
    capabilities: m.capabilities,
    aspect_ratios: m.aspect_ratios,
    resolutions: m.resolutions,
    duration_seconds: m.duration_seconds,
    max_reference_images: m.max_reference_images,
    max_prompt_length: m.max_prompt_length,
    unit: m.unit,
    unit_cost_pence: m.unit_cost_pence,
    video: m.video ?? null,
    /** Not yet checked with a real request and bill: shown to the adult as such. */
    unverified: m.video?.verified_live === false,
    configuration_pricing: Boolean(m.pricing),
  };
}
