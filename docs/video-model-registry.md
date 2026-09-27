# Video model registry

> The next rollout follows [Character Studio requirements](character-studio-requirements.md)
> and [the build plan](character-studio-build-plan.md). A registered endpoint is not evidence
> that canonical visual versioning, full multimodal input or native draft promotion has shipped.

`packages/models/models.json` remains the single editable source of model metadata. The generated catalogue feeds the typed `VideoModelDefinition` registry in `@storyboard/models`; there is no parallel list of endpoint IDs.

The registry distinguishes endpoint definitions from deployment availability. `VIDEO_MODEL_REGISTRY` includes disabled definitions for inspection. API consumers use `catalogue.videoModels(requirements)`, which filters disabled endpoints and unavailable providers first. `/models/tiers` uses this path and retains catalogue order as its default priority.

```ts
const candidates = catalogue.videoModels({
  task: 'reference-to-video',
  referenceImageCount: 2,
  endFrame: true,
  nativeDurationSeconds: 10,
  resolution: '720p',
});
```

An empty result means no compatible endpoint. Callers must not silently discard requirements. Matching is capability selection, not complete request validation: the submission route must still validate required assets, ownership, budgets and request content.

Native duration is deliberately distinct from the existing assembly planner. A model that can generate 5 seconds does not match a native 30-second request just because the runner can join six clips. Existing 5/10/15/30-second simple-mode assembly remains unchanged.

Keep these responsibilities separate as integrations expand:

- Registry: endpoint metadata, limits and compatible selection.
- Request adapters: provider payload and result translation. Existing flat mappings remain in `request_shape`; nested character elements will need a typed adapter extension.
- Quote service: configuration-dependent pricing, reservation and settlement.
- Job planner/runner: orchestration, retries, safety checks, persistence and assembly.
- Character domain: approved looks, revisions and reference manifests.

The initial registry change connected simple-mode selection to capability matching. Subsequent
working-tree work adds six-family metadata, grouped selection, resolution-aware pricing and
Seedance/Wan cast-image payloads. These are foundations, not completed Character Studio:
canonical approval/versioning, a frame editor, mixed-media references and draft/final lineage
remain planned. The new build plan puts canonical characters ahead of production rollout and
reserves broad model choice for Advanced mode. No model IDs or provider-specific branches
belong in the runner.
