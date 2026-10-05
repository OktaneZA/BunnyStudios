# Character library: requirements (draft, 5 October 2026)

Status: **built 5 October 2026** (CL-01–CL-08), fake-verified in the browser suite (`e2e/library.spec.ts`) and the API suite (`test/character-studio.test.ts`); the story match checked once against the real finder on the dev server. Not run on a tablet. Mockup: [prototypes/character-library.html](prototypes/character-library.html).

Routes: `GET /characters/library`, `POST /projects/:id/cast/from-library`, and `library_match` on each found name in `POST /projects/:id/cast/proposals` with `use_library` on accept. Web: `/characters` (Library.tsx), the cast sheet's match choices and "From your characters" tab.

## Why

Every cartoon starts with no characters, so Timmy gets drawn again for every new story. The
teen already has an approved look for him in another cartoon. They should be able to reuse it,
and the app should spot the name in the words and offer it without being asked.

## What the creator sees

**CL-01 One library, no extra work.** Every character with a chosen look, in any cartoon that is
not in the bin, is in "Your characters". Nothing has to be "saved to the library". A character
without a look is not offered (there is nothing to reuse).

**CL-02 A page of their own.** "Your characters" is reachable from My cartoons. Each card: the
look picture, the name, which cartoons they are in, when the look was chosen. Opening a card
shows the look's pictures and a "Use in…" button listing the cartoons.

**CL-03 Auto-match from the words.** When the cast finder reads a story and finds a name that
matches a library character (same name, ignoring case and spaces), the proposal says
"Timmy — you have a Timmy in Sunny Beach Catch" with his face, and offers **Use that Timmy**
(default) or **Make a new Timmy**. The creator always chooses; nothing is copied silently.

**CL-04 Add from the library by hand.** On the cover, "+ Add a character" offers "From your
characters" beside "New character". Picking one adds them to this cartoon.

**CL-05 Reuse is a copy, with lineage.** Using a library character makes a new character in this
cartoon with the same traits and the same chosen look: the same pinned pictures, byte-identical,
so the clip makers receive exactly what they did before. The copy remembers where it came from.
Changing the copy (new look, new traits) never changes the original, and the other way round.
"Same in every cartoon until you change it here" is the sentence on the card.

**CL-06 Several of the same name.** If two cartoons each have a Timmy, the match shows the one
whose look was chosen most recently, with "Another Timmy?" to pick the other.

**CL-07 Looks follow the cartoon's style.** If the library character's look was chosen in a
different cartoon look (say watercolour) and this cartoon is 3D film, the card says so:
"Drawn in Watercolour; this cartoon is 3D film. You can use it as it is, or make new pictures
from it on the character's sheet." It is still offered.

**CL-08 The bin.** A library character from a binned cartoon is not shown; restoring the
cartoon brings it back. Copies already made keep working (the pictures are pinned by the look).

## Rules that do not change

- `account_id` on everything; the library is one account's, never shared across accounts.
- A pinned picture cannot be binned (already enforced), so a copy's look can never lose a picture.
- No new "library" table: the library is a read over `characters` with a look, grouped by name.
  Lineage is one nullable column, `characters.source_character_id`.
- Teen-friendly words only: "your characters", "use that Timmy", never "asset library".

## Out of scope for the first cut

- Sharing characters between accounts.
- Editing a character once for every cartoon at the same time.
- Matching by nickname or description ("the stick boy" → Timmy). Exact name only.
