/**
 * Which models this deployment can actually run: the catalogue filtered by which adapter
 * has a key (DM-3). Tests inject a fake provider and a fake catalogue.
 */
import { ALL_MODELS, type GenerationModel, type ModelKind } from '@storyboard/models';
import type { GenerationProvider } from './provider.ts';

export interface Catalogue {
  providers: Map<string, GenerationProvider>;
  models: GenerationModel[];
  enabled(): GenerationModel[];
  find(id: string): GenerationModel | undefined;
  providerFor(model: GenerationModel): GenerationProvider | undefined;
  cheapest(kind: ModelKind): GenerationModel | undefined;
}

export function createCatalogue(providers: GenerationProvider[], models: GenerationModel[] = ALL_MODELS as GenerationModel[]): Catalogue {
  const map = new Map(providers.map((p) => [p.name, p]));
  const catalogue: Catalogue = {
    providers: map,
    models,
    enabled: () => models.filter((m) => m.enabled && map.get(m.provider)?.enabled),
    find: (id) => models.find((m) => m.id === id),
    providerFor: (model) => map.get(model.provider),
    cheapest: (kind) => catalogue.enabled().filter((m) => m.kind === kind).sort((a, b) => a.unit_cost_pence - b.unit_cost_pence)[0],
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
  };
}
