# Spike Fixture Project — "Milo and the Parcel"

The structured source data. Every prompt in `variant-a-inline.md` is compiled from these values in
the §5.2 assembly order, by hand, exactly as the compiler will do it. This file is also the seed for
`packages/compiler/test/fixtures/` in Phase 2 — the hand-written prompts become the expected output
of the first unit tests.

## SeriesBible

| Field | Value |
|---|---|
| `art_style` | `2D flat vector cartoon, clean geometric shapes, uniform outlines` (preset `2d_flat_vector`) |
| `line_treatment` | `2px black outline, no line weight variation` |
| `render_quality_tokens` | `clean, high detail, no text artifacts` |
| `negative_prompt` | `no speech bubbles, no motion lines` |
| `aspect_ratio` | `16:9` |
| `default_lighting` | `flat even cartoon lighting` |
| `colour_palette` | primary `#E63946` red · secondary `#457B9D` blue · accent `#F1FAEE` cream · shadow `#1D3557` navy · highlight `#A8DADC` pale blue |
| `continuity_rules` | `Milo never appears without his red scarf`, `Griggs never removes his cap` |

**Compiled negative prompt** (bible negative + standard cartoon exclusions, per §5.2):

```
no speech bubbles, no motion lines, text, watermark, signature, extra limbs, deformed hands, photorealistic, blurry
```

## Characters

**MILO** — `protagonist`
```
MILO: a scruffy 9-year-old boy, oversized round glasses, mop of brown hair, red knitted scarf, green dungarees, always barefoot
```

**GRIGGS** — `antagonist`
```
POSTMAN GRIGGS: a tall thin postman in his fifties, navy blue uniform with brass buttons, peaked cap two sizes too big, bushy grey moustache, heavy leather satchel
```

**SCRAPS** — `supporting`
```
SCRAPS: a small scruffy terrier, wiry grey fur, one ear permanently folded flat, red collar
```

## Location — `EXT. FRONT PORCH`
```
the front porch of a narrow terraced house, peeling yellow paint, three wooden steps, a rusted letterbox, an overgrown potted fern
```
`default_lighting`: `soft morning light from the left`

## Prop — `PARCEL` (`plot_critical`)
```
a battered brown paper parcel tied with string, one corner torn open
```

## Scene 1 — "The Parcel"

| Field | Value |
|---|---|
| `slugline` | `EXT. FRONT PORCH — MORNING` |
| `time_of_day` | `morning` → *in the morning* |
| `lighting_preset` | `natural_daylight` → *natural daylight, soft even illumination* |
| `mood_atmosphere` | `chaotic_comic` → *chaotic slapstick comic energy* |
| `character_ids` | MILO, GRIGGS, SCRAPS |
| `scenery_description` | `morning light across the porch, the fern casting long shadows on the steps, a scatter of unopened letters on the boards` |
| `scene_intent` | Milo refuses to hand back a parcel that was never his |

## Shot list

| # | `shot_type` | `camera_angle` | lens | DoF | subjects | notes |
|---|---|---|---|---|---|---|
| 01 | `establishing` | `eye_level` | `wide_24mm` | `deep_focus` | — | tests empty-subject sections |
| 02 | `medium_wide` | `eye_level` | `normal_50mm` | `deep_focus` | MILO, GRIGGS | |
| 03 | `close_up` | `low_angle` | `portrait_85mm` | `shallow_bokeh` | MILO | |
| 04 | `close_up` | `high_angle` | `portrait_85mm` | `shallow_bokeh` | GRIGGS | |
| 05 | `over_the_shoulder` | `eye_level` | `normal_50mm` | `shallow_bokeh` | MILO, GRIGGS | |
| 06 | `insert` | `overhead` | `macro` | `shallow_bokeh` | — | **`lighting_override` set** — tests fallback level 1 |
| 07 | `cutaway` | `worms_eye` | `wide_24mm` | `deep_focus` | SCRAPS | |
| 08 | `two_shot` | `dutch_tilt` | `wide_24mm` | `deep_focus` | MILO, GRIGGS, SCRAPS | longest prompt — use for the length test |
| 09 | `full` | `eye_level` | `normal_50mm` | `deep_focus` | MILO | |
| 10 | `extreme_wide` | `high_angle` | `ultra_wide_14mm` | `deep_focus` | MILO, GRIGGS | |

**MILO appears in 7 of 10 panels (02, 03, 05, 08, 09, 10 — and by implication 01's setting).** That
is the consistency measurement. GRIGGS appears in 5.

## Lighting fallback coverage

The fixture deliberately exercises the §5.2 step 8 chain so Phase 2's PC-2 test matrix has real data:

| Level | Source | Exercised by |
|---|---|---|
| 1 | `Shot.lighting_override` | shot 06 |
| 2 | `Scene.lighting_preset` | shots 01–05, 07–10 |
| 3 | `Scene.lighting` free text | *(clear the preset to test)* |
| 4 | `Location.default_lighting` | *(clear scene lighting to test)* |
| 5 | `SeriesBible.default_lighting` | *(clear location lighting to test)* |
