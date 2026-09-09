# Variant B — Character Builder references instead of inline description

Identical to Variant A in every respect **except** that each character's full `prompt_token` is
replaced by their name plus expression note, with the visual identity carried by an OpenArt
Character Builder reference attached to the panel.

The A/B difference is the whole experiment. If B holds character and A does not, the product's
design changes materially — see the outcome table in `README.md`.

## Step 1 — Build the characters first

Create these three in OpenArt's Character Builder before generating anything.

**MILO**
```
A scruffy 9-year-old boy, oversized round glasses, mop of brown hair, red knitted scarf, green dungarees, always barefoot. 2D flat vector cartoon, clean geometric shapes, uniform outlines, 2px black outline.
```

**GRIGGS**
```
A tall thin postman in his fifties, navy blue uniform with brass buttons, peaked cap two sizes too big, bushy grey moustache, heavy leather satchel. 2D flat vector cartoon, clean geometric shapes, uniform outlines, 2px black outline.
```

**SCRAPS**
```
A small scruffy terrier, wiry grey fur, one ear permanently folded flat, red collar. 2D flat vector cartoon, clean geometric shapes, uniform outlines, 2px black outline.
```

Save the reference name or ID OpenArt gives each one — that value is exactly what
`Character.openart_character_ref` (§3.5) is for, and what EX-8's handoff sheet emits.

## Step 2 — Generate

Same aspect ratio (`16:9`) and same negative prompt as Variant A. Attach the Character Builder
reference for every character named in each panel.

| Panel | Attach references |
|---|---|
| 01 | none |
| 02 | MILO, GRIGGS |
| 03 | MILO |
| 04 | GRIGGS |
| 05 | MILO, GRIGGS |
| 06 | none |
| 07 | SCRAPS |
| 08 | MILO, GRIGGS, SCRAPS |
| 09 | MILO |
| 10 | MILO, GRIGGS |

---

## 01 — Establishing

*Identical to Variant A prompt 01 — no characters. Generate it anyway as a style control.*

## 02 — The stand-off

```
2D flat vector cartoon, clean geometric shapes, uniform outlines, 2px black outline, no line weight variation. Medium wide shot, knees up, eye level angle, shot on a 50mm lens, natural perspective, deep focus, foreground and background both sharp. MILO, chin lifted, stubborn. GRIGGS, arm outstretched, exasperated. Milo clutches the parcel to his chest while Griggs reaches for it. Milo screen-left on the top step; Griggs screen-right at the bottom of the steps, looking up. The front porch of a narrow terraced house, peeling yellow paint, three wooden steps, a rusted letterbox, an overgrown potted fern. Morning light across the porch, the fern casting long shadows on the steps, a scatter of unopened letters on the boards. A battered brown paper parcel tied with string, one corner torn open. In the morning. Natural daylight, soft even illumination. Chaotic slapstick comic energy. Colour palette: red #E63946, blue #457B9D, cream #F1FAEE, navy shadows #1D3557, pale blue highlights #A8DADC. Clean, high detail, no text artifacts.
```

## 03 — Milo, close

```
2D flat vector cartoon, clean geometric shapes, uniform outlines, 2px black outline, no line weight variation. Close-up on face, low angle looking up at the subject, shot on an 85mm portrait lens, compressed perspective, shallow depth of field, soft bokeh background. MILO, jaw set, eyes narrowed behind his glasses, utterly unmoved. Milo tilts his chin up and refuses. Milo fills the frame, slightly off-centre screen-left. The front porch of a narrow terraced house, peeling yellow paint, three wooden steps, a rusted letterbox, an overgrown potted fern. Morning light across the porch, the fern casting long shadows on the steps, a scatter of unopened letters on the boards. In the morning. Natural daylight, soft even illumination. Chaotic slapstick comic energy. Colour palette: red #E63946, blue #457B9D, cream #F1FAEE, navy shadows #1D3557, pale blue highlights #A8DADC. Clean, high detail, no text artifacts.
```

## 04 — Griggs, close

```
2D flat vector cartoon, clean geometric shapes, uniform outlines, 2px black outline, no line weight variation. Close-up on face, high angle looking down at the subject, shot on an 85mm portrait lens, compressed perspective, shallow depth of field, soft bokeh background. GRIGGS, moustache bristling, one eyebrow climbing, patience entirely gone. Griggs looks down at the boy and exhales slowly through his nose. Griggs centred, cap brim cutting the top of frame. The front porch of a narrow terraced house, peeling yellow paint, three wooden steps, a rusted letterbox, an overgrown potted fern. Morning light across the porch, the fern casting long shadows on the steps, a scatter of unopened letters on the boards. In the morning. Natural daylight, soft even illumination. Chaotic slapstick comic energy. Colour palette: red #E63946, blue #457B9D, cream #F1FAEE, navy shadows #1D3557, pale blue highlights #A8DADC. Clean, high detail, no text artifacts.
```

## 05 — Over the shoulder

```
2D flat vector cartoon, clean geometric shapes, uniform outlines, 2px black outline, no line weight variation. Over-the-shoulder shot, eye level angle, shot on a 50mm lens, natural perspective, shallow depth of field, soft bokeh background. GRIGGS, seen from behind. MILO, defiant, holding the parcel away. Seen past Griggs's shoulder, Milo holds the parcel just out of reach. Griggs's shoulder and cap brim fill the left third of frame, back to camera; Milo small and centred beyond him. The front porch of a narrow terraced house, peeling yellow paint, three wooden steps, a rusted letterbox, an overgrown potted fern. Morning light across the porch, the fern casting long shadows on the steps, a scatter of unopened letters on the boards. A battered brown paper parcel tied with string, one corner torn open. In the morning. Natural daylight, soft even illumination. Chaotic slapstick comic energy. Colour palette: red #E63946, blue #457B9D, cream #F1FAEE, navy shadows #1D3557, pale blue highlights #A8DADC. Clean, high detail, no text artifacts.
```

## 06 — Insert: the parcel

*Identical to Variant A prompt 06 — no characters. Generate as a control.*

## 07 — Cutaway: Scraps

```
2D flat vector cartoon, clean geometric shapes, uniform outlines, 2px black outline, no line weight variation. Cutaway shot to a secondary subject, extreme low worm's eye view from ground level, shot on a 24mm wide lens, deep focus, foreground and background both sharp. SCRAPS, ears half up, deeply unimpressed. Scraps watches the argument from under the bottom step, only his head showing. Scraps low and centred, the underside of the step framing the top of the shot. The front porch of a narrow terraced house, peeling yellow paint, three wooden steps, a rusted letterbox, an overgrown potted fern. Morning light across the porch, the fern casting long shadows on the steps, a scatter of unopened letters on the boards. In the morning. Natural daylight, soft even illumination. Chaotic slapstick comic energy. Colour palette: red #E63946, blue #457B9D, cream #F1FAEE, navy shadows #1D3557, pale blue highlights #A8DADC. Clean, high detail, no text artifacts.
```

## 08 — Chaos

```
2D flat vector cartoon, clean geometric shapes, uniform outlines, 2px black outline, no line weight variation. Two shot, both subjects in frame, dutch angle, tilted horizon, shot on a 24mm wide lens, deep focus, foreground and background both sharp. MILO, mid-leap, delighted. GRIGGS, grabbing at empty air, horrified. SCRAPS, airborne, ecstatic. The parcel bursts, letters and string flying, Scraps launching himself into the middle of it. Milo screen-left mid-leap; Griggs screen-right grabbing at air; Scraps low and central, off the ground. The front porch of a narrow terraced house, peeling yellow paint, three wooden steps, a rusted letterbox, an overgrown potted fern. Morning light across the porch, the fern casting long shadows on the steps, a scatter of unopened letters on the boards. A battered brown paper parcel tied with string, one corner torn open. In the morning. Natural daylight, soft even illumination. Chaotic slapstick comic energy. Colour palette: red #E63946, blue #457B9D, cream #F1FAEE, navy shadows #1D3557, pale blue highlights #A8DADC. Clean, high detail, no text artifacts.
```

## 09 — Milo alone

```
2D flat vector cartoon, clean geometric shapes, uniform outlines, 2px black outline, no line weight variation. Full shot, full body in frame, eye level angle, shot on a 50mm lens, natural perspective, deep focus, foreground and background both sharp. MILO, quiet, a little uncertain now. Milo stands alone on the top step, the parcel hugged to his chest, bare feet on the warm boards. Milo centred, full body, the front door dark behind him. The front porch of a narrow terraced house, peeling yellow paint, three wooden steps, a rusted letterbox, an overgrown potted fern. Morning light across the porch, the fern casting long shadows on the steps, a scatter of unopened letters on the boards. A battered brown paper parcel tied with string, one corner torn open. In the morning. Natural daylight, soft even illumination. Chaotic slapstick comic energy. Colour palette: red #E63946, blue #457B9D, cream #F1FAEE, navy shadows #1D3557, pale blue highlights #A8DADC. Clean, high detail, no text artifacts.
```

## 10 — The whole street

```
2D flat vector cartoon, clean geometric shapes, uniform outlines, 2px black outline, no line weight variation. Extreme wide shot, subject small in frame, high angle looking down at the subject, shot on a 14mm ultra-wide lens, exaggerated perspective, deep focus, foreground and background both sharp. MILO, tiny in frame. GRIGGS, tiny in frame. The whole narrow street, two small figures still facing off on one porch among many. Both figures small and central, the terrace running away to both edges of frame. The front porch of a narrow terraced house, peeling yellow paint, three wooden steps, a rusted letterbox, an overgrown potted fern. Morning light across the porch, the fern casting long shadows on the steps, a scatter of unopened letters on the boards. In the morning. Natural daylight, soft even illumination. Chaotic slapstick comic energy. Colour palette: red #E63946, blue #457B9D, cream #F1FAEE, navy shadows #1D3557, pale blue highlights #A8DADC. Clean, high detail, no text artifacts.
```
