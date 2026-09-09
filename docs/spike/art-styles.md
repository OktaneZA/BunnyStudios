# Art-style preset images — picker artwork

17 images, one per `art_style` preset in §4.7. These become the cards in the Phase 1 style picker.
The point is that a 10-year-old choosing a look sees **what it actually looks like** rather than
reading "1930s rubber hose animation, black and white, bouncing curves".

Same subject, same framing, same lighting for all 17. **Only the leading style sentence changes** —
that is the whole design of the test, and the reason the resulting cards are comparable.

## Settings

Aspect ratio `1:1` (square cards read better in a picker grid than 16:9).

Negative prompt, constant across all 17:
```
text, watermark, signature, extra limbs, deformed hands, blurry
```

> Note: `photorealistic` is deliberately **absent** from this negative prompt, unlike the shot
> prompts. Several presets here (`3d_pixar_style`, `claymation_look`) legitimately move toward
> rendered realism, and excluding it would fight the style being demonstrated.

## Template

Paste this, replacing `<<STYLE PHRASE>>` with each row from the table below:

```
<<STYLE PHRASE>>. Full shot, full body in frame, eye level angle. A scruffy 9-year-old boy in oversized round glasses, a red knitted scarf and green dungarees, standing barefoot on a wooden porch step, three-quarter view, facing camera, cheerful. Natural daylight, soft even illumination.
```

## The 17 style phrases

Each is the `prompt_phrase` from §4.7, verbatim. Save each result as
`results/art-styles/<value>.png`.

| `value` (filename) | `<<STYLE PHRASE>>` |
|---|---|
| `2d_flat_vector` | 2D flat vector cartoon, clean geometric shapes, uniform outlines |
| `classic_cel_animation` | classic hand-drawn cel animation, painted backgrounds |
| `saturday_morning_retro` | 1980s Saturday morning cartoon style, bold outlines, limited palette |
| `anime_shonen` | shonen anime style, dynamic angular linework, speed lines |
| `anime_ghibli_soft` | soft painterly anime style, watercolour backgrounds, gentle light |
| `chibi` | chibi style, oversized heads, tiny bodies, simplified features |
| `comic_book_ink` | comic book ink style, heavy black spotting, halftone shading |
| `newspaper_strip` | newspaper comic strip style, simple line art, flat colour |
| `watercolour_storybook` | children's storybook watercolour illustration, soft edges |
| `crayon_childlike` | crayon and coloured pencil childlike drawing style |
| `paper_cutout` | paper cutout collage animation style, layered flat shapes |
| `claymation_look` | claymation stop-motion look, visible fingerprints and clay texture |
| `3d_pixar_style` | stylised 3D animated film look, soft global illumination |
| `low_poly` | low poly 3D style, faceted geometry, flat shading |
| `pixel_art` | pixel art style, limited palette, visible pixel grid |
| `rubber_hose_1930s` | 1930s rubber hose animation, black and white, bouncing curves |
| `noir_high_contrast` | high contrast noir style, hard shadows, near-monochrome |

## Two things to watch while running these

1. **Any preset whose image doesn't clearly differ from its neighbours** is a preset whose
   `prompt_phrase` is too weak. Note it — the phrase gets strengthened in `vocabularies.json`
   before Phase 2, and this is the only chance to catch it cheaply.
2. **Any preset that produces something a 10-year-old wouldn't want** (`noir_high_contrast` and
   `rubber_hose_1930s` are the likely candidates for a young audience) should be flagged — not
   removed, but possibly ordered lower in the picker grid.
