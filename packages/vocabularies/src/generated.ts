// GENERATED FILE — do not edit.
// Source: packages/vocabularies/vocabularies.json
// Regenerate with: npm run codegen -w @storyboard/vocabularies

export const SCHEMA_VERSION = "1.0.0" as const;

export type ShotType = "extreme_wide" | "establishing" | "wide" | "full" | "medium_wide" | "medium" | "medium_close" | "close_up" | "extreme_close_up" | "over_the_shoulder" | "two_shot" | "point_of_view" | "insert" | "cutaway";
export const SHOT_TYPE_VALUES = ["extreme_wide", "establishing", "wide", "full", "medium_wide", "medium", "medium_close", "close_up", "extreme_close_up", "over_the_shoulder", "two_shot", "point_of_view", "insert", "cutaway"] as const satisfies readonly ShotType[];
export const SHOT_TYPE = [
  {
    "value": "extreme_wide",
    "prompt_phrase": "extreme wide shot, subject small in frame",
    "label": "Extreme wide",
    "friendlyLabel": "Tiny in a big place",
    "help": "The character is small and the world is huge. Good for showing somewhere new, or someone feeling alone.",
    "icon": "shot-extreme-wide"
  },
  {
    "value": "establishing",
    "prompt_phrase": "wide establishing shot",
    "label": "Establishing",
    "friendlyLabel": "Show the whole place",
    "help": "Start a scene with this so we know where we are.",
    "icon": "shot-establishing"
  },
  {
    "value": "wide",
    "prompt_phrase": "wide shot",
    "label": "Wide",
    "friendlyLabel": "Everyone and the room",
    "help": "You can see the characters and what's around them.",
    "icon": "shot-wide"
  },
  {
    "value": "full",
    "prompt_phrase": "full shot, full body in frame",
    "label": "Full shot",
    "friendlyLabel": "Head to toe",
    "help": "The whole character fits in the picture. Good for showing what they're wearing or doing.",
    "icon": "shot-full"
  },
  {
    "value": "medium_wide",
    "prompt_phrase": "medium wide shot, knees up",
    "label": "Medium wide",
    "friendlyLabel": "From the knees up",
    "help": "Close enough to see faces, far enough to see body language.",
    "icon": "shot-medium-wide"
  },
  {
    "value": "medium",
    "prompt_phrase": "medium shot, waist up",
    "label": "Medium",
    "friendlyLabel": "From the waist up",
    "help": "The everyday shot. Use it when people are talking.",
    "icon": "shot-medium"
  },
  {
    "value": "medium_close",
    "prompt_phrase": "medium close-up, chest up",
    "label": "Medium close-up",
    "friendlyLabel": "From the chest up",
    "help": "Closer in. We start paying attention to their face.",
    "icon": "shot-medium-close"
  },
  {
    "value": "close_up",
    "prompt_phrase": "close-up on face",
    "label": "Close-up",
    "friendlyLabel": "Just their face",
    "help": "Fills the picture with a face. Use it for a big feeling.",
    "icon": "shot-close-up"
  },
  {
    "value": "extreme_close_up",
    "prompt_phrase": "extreme close-up",
    "label": "Extreme close-up",
    "friendlyLabel": "Really, really close",
    "help": "Just the eyes, or one small thing. Very intense.",
    "icon": "shot-extreme-close-up"
  },
  {
    "value": "over_the_shoulder",
    "prompt_phrase": "over-the-shoulder shot",
    "label": "Over the shoulder",
    "friendlyLabel": "From behind someone's shoulder",
    "help": "We look past one character at another. Great for arguments.",
    "icon": "shot-ots"
  },
  {
    "value": "two_shot",
    "prompt_phrase": "two shot, both subjects in frame",
    "label": "Two shot",
    "friendlyLabel": "Two people together",
    "help": "Both characters in one picture, so we see how they feel about each other.",
    "icon": "shot-two"
  },
  {
    "value": "point_of_view",
    "prompt_phrase": "POV shot, first person perspective",
    "label": "POV",
    "friendlyLabel": "Through their eyes",
    "help": "We see exactly what the character sees.",
    "icon": "shot-pov"
  },
  {
    "value": "insert",
    "prompt_phrase": "insert shot, tight detail",
    "label": "Insert",
    "friendlyLabel": "Close on one thing",
    "help": "A close look at an object that matters — a note, a key, a torn parcel.",
    "icon": "shot-insert"
  },
  {
    "value": "cutaway",
    "prompt_phrase": "cutaway shot to a secondary subject",
    "label": "Cutaway",
    "friendlyLabel": "Look at something else",
    "help": "Jump away to something happening nearby. Good for a joke or a reaction.",
    "icon": "shot-cutaway"
  }
] as const;

export type CameraAngle = "eye_level" | "low_angle" | "high_angle" | "birds_eye" | "worms_eye" | "dutch_tilt" | "overhead" | "profile" | "three_quarter";
export const CAMERA_ANGLE_VALUES = ["eye_level", "low_angle", "high_angle", "birds_eye", "worms_eye", "dutch_tilt", "overhead", "profile", "three_quarter"] as const satisfies readonly CameraAngle[];
export const CAMERA_ANGLE = [
  {
    "value": "eye_level",
    "prompt_phrase": "eye level angle",
    "label": "Eye level",
    "friendlyLabel": "Straight on",
    "help": "Normal and calm. The camera is where your eyes would be.",
    "icon": "angle-eye-level"
  },
  {
    "value": "low_angle",
    "prompt_phrase": "low angle looking up at the subject",
    "label": "Low angle",
    "friendlyLabel": "Looking up at them",
    "help": "Makes a character feel big, powerful or scary.",
    "icon": "angle-low"
  },
  {
    "value": "high_angle",
    "prompt_phrase": "high angle looking down at the subject",
    "label": "High angle",
    "friendlyLabel": "Looking down at them",
    "help": "Makes a character feel small, weak or in trouble.",
    "icon": "angle-high"
  },
  {
    "value": "birds_eye",
    "prompt_phrase": "top-down bird's eye view",
    "label": "Bird's eye",
    "friendlyLabel": "From way up high",
    "help": "Like a bird flying over. Shows the whole layout.",
    "icon": "angle-birds-eye"
  },
  {
    "value": "worms_eye",
    "prompt_phrase": "extreme low worm's eye view from ground level",
    "label": "Worm's eye",
    "friendlyLabel": "From the ground",
    "help": "Down at floor level, looking up. Everything towers over us.",
    "icon": "angle-worms-eye"
  },
  {
    "value": "dutch_tilt",
    "prompt_phrase": "dutch angle, tilted horizon",
    "label": "Dutch angle",
    "friendlyLabel": "Tilted, like something's wrong",
    "help": "The whole picture leans over. Use it when things get weird or chaotic.",
    "icon": "angle-dutch"
  },
  {
    "value": "overhead",
    "prompt_phrase": "directly overhead flat lay angle",
    "label": "Overhead",
    "friendlyLabel": "Straight down from above",
    "help": "Looking down flat, like at a table. Good for showing objects laid out.",
    "icon": "angle-overhead"
  },
  {
    "value": "profile",
    "prompt_phrase": "side profile view",
    "label": "Profile",
    "friendlyLabel": "From the side",
    "help": "We see the side of their face, not the front.",
    "icon": "angle-profile"
  },
  {
    "value": "three_quarter",
    "prompt_phrase": "three-quarter view",
    "label": "Three-quarter",
    "friendlyLabel": "Turned slightly away",
    "help": "Halfway between front and side. The most natural-looking angle.",
    "icon": "angle-three-quarter"
  }
] as const;

export type LensFocalLength = "ultra_wide_14mm" | "wide_24mm" | "normal_50mm" | "portrait_85mm" | "telephoto_135mm" | "macro";
export const LENS_FOCAL_LENGTH_VALUES = ["ultra_wide_14mm", "wide_24mm", "normal_50mm", "portrait_85mm", "telephoto_135mm", "macro"] as const satisfies readonly LensFocalLength[];
export const LENS_FOCAL_LENGTH = [
  {
    "value": "ultra_wide_14mm",
    "prompt_phrase": "shot on a 14mm ultra-wide lens, exaggerated perspective",
    "label": "14mm ultra-wide",
    "friendlyLabel": "Super wide and stretchy",
    "help": "Fits loads in, but bends things at the edges. Fun and cartoony.",
    "icon": "lens-ultra-wide"
  },
  {
    "value": "wide_24mm",
    "prompt_phrase": "shot on a 24mm wide lens",
    "label": "24mm wide",
    "friendlyLabel": "Wide",
    "help": "Sees plenty of the room without looking strange.",
    "icon": "lens-wide"
  },
  {
    "value": "normal_50mm",
    "prompt_phrase": "shot on a 50mm lens, natural perspective",
    "label": "50mm normal",
    "friendlyLabel": "Normal",
    "help": "Looks the way your own eyes see. Safe choice if you're unsure.",
    "icon": "lens-normal"
  },
  {
    "value": "portrait_85mm",
    "prompt_phrase": "shot on an 85mm portrait lens, compressed perspective",
    "label": "85mm portrait",
    "friendlyLabel": "Good for faces",
    "help": "Flattering close-ups with a soft background.",
    "icon": "lens-portrait"
  },
  {
    "value": "telephoto_135mm",
    "prompt_phrase": "shot on a 135mm telephoto lens, flattened depth",
    "label": "135mm telephoto",
    "friendlyLabel": "Zoomed in from far away",
    "help": "Squashes everything together so far things look close.",
    "icon": "lens-telephoto"
  },
  {
    "value": "macro",
    "prompt_phrase": "macro lens, extreme close detail",
    "label": "Macro",
    "friendlyLabel": "Tiny detail, huge",
    "help": "For very small things — an ant, a crumb, a keyhole.",
    "icon": "lens-macro"
  }
] as const;

export type DepthOfField = "deep_focus" | "shallow_bokeh" | "rack_focus" | "tilt_shift";
export const DEPTH_OF_FIELD_VALUES = ["deep_focus", "shallow_bokeh", "rack_focus", "tilt_shift"] as const satisfies readonly DepthOfField[];
export const DEPTH_OF_FIELD = [
  {
    "value": "deep_focus",
    "prompt_phrase": "deep focus, foreground and background both sharp",
    "label": "Deep focus",
    "friendlyLabel": "Everything sharp",
    "help": "Near and far are both clear.",
    "icon": "dof-deep"
  },
  {
    "value": "shallow_bokeh",
    "prompt_phrase": "shallow depth of field, soft bokeh background",
    "label": "Shallow",
    "friendlyLabel": "Background blurry",
    "help": "The character is sharp and everything behind them goes soft.",
    "icon": "dof-shallow"
  },
  {
    "value": "rack_focus",
    "prompt_phrase": "rack focus shifting between planes",
    "label": "Rack focus",
    "friendlyLabel": "Focus moves",
    "help": "Sharpness shifts from one thing to another.",
    "icon": "dof-rack"
  },
  {
    "value": "tilt_shift",
    "prompt_phrase": "tilt-shift effect, miniature look",
    "label": "Tilt-shift",
    "friendlyLabel": "Looks like a toy model",
    "help": "Makes a real place look like a tiny model village.",
    "icon": "dof-tilt-shift"
  }
] as const;

export type LightingPreset = "natural_daylight" | "golden_hour" | "blue_hour" | "harsh_noon" | "overcast_soft" | "moonlight" | "candlelight" | "firelight" | "neon_night" | "single_key_dramatic" | "high_key" | "low_key" | "backlit_silhouette" | "rim_light" | "underlight_spooky" | "flat_cartoon" | "practical_source";
export const LIGHTING_PRESET_VALUES = ["natural_daylight", "golden_hour", "blue_hour", "harsh_noon", "overcast_soft", "moonlight", "candlelight", "firelight", "neon_night", "single_key_dramatic", "high_key", "low_key", "backlit_silhouette", "rim_light", "underlight_spooky", "flat_cartoon", "practical_source"] as const satisfies readonly LightingPreset[];
export const LIGHTING_PRESET = [
  {
    "value": "natural_daylight",
    "prompt_phrase": "natural daylight, soft even illumination",
    "label": "Natural daylight",
    "friendlyLabel": "Normal daytime",
    "help": "Ordinary daylight. Nothing dramatic.",
    "icon": "light-daylight"
  },
  {
    "value": "golden_hour",
    "prompt_phrase": "warm golden hour light, long soft shadows",
    "label": "Golden hour",
    "friendlyLabel": "Warm evening glow",
    "help": "Just before sunset. Everything looks golden and lovely.",
    "icon": "light-golden-hour"
  },
  {
    "value": "blue_hour",
    "prompt_phrase": "cool blue twilight light just after sunset",
    "label": "Blue hour",
    "friendlyLabel": "Just after sunset",
    "help": "The sky's gone blue but it isn't dark yet. Quiet and a bit sad.",
    "icon": "light-blue-hour"
  },
  {
    "value": "harsh_noon",
    "prompt_phrase": "harsh overhead midday sun, short hard shadows",
    "label": "Harsh noon",
    "friendlyLabel": "Blazing midday sun",
    "help": "Bright and hot with hard little shadows straight underneath.",
    "icon": "light-harsh-noon"
  },
  {
    "value": "overcast_soft",
    "prompt_phrase": "flat overcast light, soft diffused shadows",
    "label": "Overcast",
    "friendlyLabel": "Cloudy day",
    "help": "Flat grey light with barely any shadows.",
    "icon": "light-overcast"
  },
  {
    "value": "moonlight",
    "prompt_phrase": "pale blue moonlight, deep cool shadows",
    "label": "Moonlight",
    "friendlyLabel": "Moonlight",
    "help": "Pale blue night light with deep shadows.",
    "icon": "light-moonlight"
  },
  {
    "value": "candlelight",
    "prompt_phrase": "flickering warm candlelight, small pool of light",
    "label": "Candlelight",
    "friendlyLabel": "Candlelight",
    "help": "One small warm flickering light in the dark.",
    "icon": "light-candlelight"
  },
  {
    "value": "firelight",
    "prompt_phrase": "orange firelight, dancing shadows",
    "label": "Firelight",
    "friendlyLabel": "Firelight",
    "help": "Orange glow with shadows that jump about.",
    "icon": "light-firelight"
  },
  {
    "value": "neon_night",
    "prompt_phrase": "saturated neon light at night, magenta and cyan spill",
    "label": "Neon night",
    "friendlyLabel": "Neon signs at night",
    "help": "Bright pink and blue city lights in the dark.",
    "icon": "light-neon"
  },
  {
    "value": "single_key_dramatic",
    "prompt_phrase": "single hard key light, deep shadows, high contrast",
    "label": "Single key",
    "friendlyLabel": "One harsh light",
    "help": "One strong light and lots of shadow. Very dramatic.",
    "icon": "light-single-key"
  },
  {
    "value": "high_key",
    "prompt_phrase": "high key lighting, bright, minimal shadows",
    "label": "High key",
    "friendlyLabel": "Bright and cheerful",
    "help": "Everything lit up, hardly any shadows. Happy and light.",
    "icon": "light-high-key"
  },
  {
    "value": "low_key",
    "prompt_phrase": "low key lighting, mostly shadow, small highlights",
    "label": "Low key",
    "friendlyLabel": "Mostly dark",
    "help": "Mostly shadow with just a few bright bits. Moody.",
    "icon": "light-low-key"
  },
  {
    "value": "backlit_silhouette",
    "prompt_phrase": "strong backlight, subject in silhouette",
    "label": "Backlit",
    "friendlyLabel": "Dark shape against light",
    "help": "The light is behind them so they become a black outline.",
    "icon": "light-backlit"
  },
  {
    "value": "rim_light",
    "prompt_phrase": "rim lighting outlining the subject's edge",
    "label": "Rim light",
    "friendlyLabel": "Glowing edges",
    "help": "A bright line traces around the character's edge.",
    "icon": "light-rim"
  },
  {
    "value": "underlight_spooky",
    "prompt_phrase": "lit from below, eerie upward shadows",
    "label": "Underlight",
    "friendlyLabel": "Lit from underneath",
    "help": "Like holding a torch under your chin. Spooky.",
    "icon": "light-underlight"
  },
  {
    "value": "flat_cartoon",
    "prompt_phrase": "flat even cartoon lighting, minimal shadow",
    "label": "Flat cartoon",
    "friendlyLabel": "Simple cartoon light",
    "help": "Even light with almost no shadows, like a Saturday-morning cartoon.",
    "icon": "light-flat-cartoon"
  },
  {
    "value": "practical_source",
    "prompt_phrase": "lit by a visible in-scene practical source",
    "label": "Practical source",
    "friendlyLabel": "Lit by something we can see",
    "help": "The light comes from a lamp or a telly that's actually in the picture.",
    "icon": "light-practical"
  }
] as const;

export type TimeOfDay = "dawn" | "morning" | "midday" | "afternoon" | "dusk" | "night" | "unspecified";
export const TIME_OF_DAY_VALUES = ["dawn", "morning", "midday", "afternoon", "dusk", "night", "unspecified"] as const satisfies readonly TimeOfDay[];
export const TIME_OF_DAY = [
  {
    "value": "dawn",
    "prompt_phrase": "at dawn, first pale light",
    "label": "Dawn",
    "friendlyLabel": "Just getting light",
    "help": "Very early, before the sun is properly up.",
    "icon": "time-dawn"
  },
  {
    "value": "morning",
    "prompt_phrase": "in the morning",
    "label": "Morning",
    "friendlyLabel": "Morning",
    "help": "Before lunch.",
    "icon": "time-morning"
  },
  {
    "value": "midday",
    "prompt_phrase": "at midday",
    "label": "Midday",
    "friendlyLabel": "Middle of the day",
    "help": "Sun straight overhead.",
    "icon": "time-midday"
  },
  {
    "value": "afternoon",
    "prompt_phrase": "in the afternoon",
    "label": "Afternoon",
    "friendlyLabel": "Afternoon",
    "help": "After lunch, before tea.",
    "icon": "time-afternoon"
  },
  {
    "value": "dusk",
    "prompt_phrase": "at dusk",
    "label": "Dusk",
    "friendlyLabel": "Getting dark",
    "help": "The sun is going down.",
    "icon": "time-dusk"
  },
  {
    "value": "night",
    "prompt_phrase": "at night",
    "label": "Night",
    "friendlyLabel": "Night",
    "help": "Properly dark.",
    "icon": "time-night"
  },
  {
    "value": "unspecified",
    "prompt_phrase": "",
    "emitsNothing": true,
    "label": "Unspecified",
    "friendlyLabel": "Doesn't matter",
    "help": "Leave the time of day out of the picture entirely.",
    "icon": "time-unspecified"
  }
] as const;

export type ArtStyle = "2d_flat_vector" | "classic_cel_animation" | "saturday_morning_retro" | "anime_shonen" | "anime_ghibli_soft" | "chibi" | "comic_book_ink" | "newspaper_strip" | "watercolour_storybook" | "crayon_childlike" | "paper_cutout" | "claymation_look" | "3d_pixar_style" | "low_poly" | "pixel_art" | "rubber_hose_1930s" | "noir_high_contrast";
export const ART_STYLE_VALUES = ["2d_flat_vector", "classic_cel_animation", "saturday_morning_retro", "anime_shonen", "anime_ghibli_soft", "chibi", "comic_book_ink", "newspaper_strip", "watercolour_storybook", "crayon_childlike", "paper_cutout", "claymation_look", "3d_pixar_style", "low_poly", "pixel_art", "rubber_hose_1930s", "noir_high_contrast"] as const satisfies readonly ArtStyle[];
export const ART_STYLE = [
  {
    "value": "2d_flat_vector",
    "prompt_phrase": "2D flat vector cartoon, clean geometric shapes, uniform outlines",
    "label": "2D flat vector",
    "friendlyLabel": "Clean and modern",
    "help": "Simple flat shapes with neat outlines. Like a lot of cartoons on telly now.",
    "icon": "style-2d-flat-vector"
  },
  {
    "value": "classic_cel_animation",
    "prompt_phrase": "classic hand-drawn cel animation, painted backgrounds",
    "label": "Classic cel",
    "friendlyLabel": "Old hand-drawn cartoon",
    "help": "Drawn by hand with painted backgrounds, like classic Disney films.",
    "icon": "style-classic-cel"
  },
  {
    "value": "saturday_morning_retro",
    "prompt_phrase": "1980s Saturday morning cartoon style, bold outlines, limited palette",
    "label": "80s Saturday morning",
    "friendlyLabel": "1980s cartoon",
    "help": "Bold outlines and a few strong colours. Retro.",
    "icon": "style-saturday-morning"
  },
  {
    "value": "anime_shonen",
    "prompt_phrase": "shonen anime style, dynamic angular linework, speed lines",
    "label": "Shonen anime",
    "friendlyLabel": "Action anime",
    "help": "Sharp angular lines and speed streaks. Made for fights and big moments.",
    "icon": "style-anime-shonen"
  },
  {
    "value": "anime_ghibli_soft",
    "prompt_phrase": "soft painterly anime style, watercolour backgrounds, gentle light",
    "label": "Soft anime",
    "friendlyLabel": "Gentle painted anime",
    "help": "Soft watercolour backgrounds and warm light. Calm and pretty.",
    "icon": "style-anime-soft"
  },
  {
    "value": "chibi",
    "prompt_phrase": "chibi style, oversized heads, tiny bodies, simplified features",
    "label": "Chibi",
    "friendlyLabel": "Big heads, tiny bodies",
    "help": "Cute and squashed. Everyone looks like a small toy.",
    "icon": "style-chibi"
  },
  {
    "value": "comic_book_ink",
    "prompt_phrase": "comic book ink style, heavy black spotting, halftone shading",
    "label": "Comic book ink",
    "friendlyLabel": "Comic book",
    "help": "Heavy black ink and dotty shading, like a superhero comic.",
    "icon": "style-comic-ink"
  },
  {
    "value": "newspaper_strip",
    "prompt_phrase": "newspaper comic strip style, simple line art, flat colour",
    "label": "Newspaper strip",
    "friendlyLabel": "Newspaper comic",
    "help": "Simple lines and flat colour, like a comic strip in a paper.",
    "icon": "style-newspaper"
  },
  {
    "value": "watercolour_storybook",
    "prompt_phrase": "children's storybook watercolour illustration, soft edges",
    "label": "Storybook watercolour",
    "friendlyLabel": "Storybook painting",
    "help": "Soft watery colours like a picture book.",
    "icon": "style-watercolour"
  },
  {
    "value": "crayon_childlike",
    "prompt_phrase": "crayon and coloured pencil childlike drawing style",
    "label": "Crayon",
    "friendlyLabel": "Crayon drawing",
    "help": "Looks hand-drawn with crayons and pencils.",
    "icon": "style-crayon"
  },
  {
    "value": "paper_cutout",
    "prompt_phrase": "paper cutout collage animation style, layered flat shapes",
    "label": "Paper cutout",
    "friendlyLabel": "Cut-out paper shapes",
    "help": "Flat paper shapes layered on top of each other.",
    "icon": "style-paper-cutout"
  },
  {
    "value": "claymation_look",
    "prompt_phrase": "claymation stop-motion look, visible fingerprints and clay texture",
    "label": "Claymation",
    "friendlyLabel": "Modelling clay",
    "help": "Looks sculpted from clay, fingerprints and all.",
    "icon": "style-claymation"
  },
  {
    "value": "3d_pixar_style",
    "prompt_phrase": "stylised 3D animated film look, soft global illumination",
    "label": "Stylised 3D",
    "friendlyLabel": "3D animated film",
    "help": "Rounded 3D characters with soft lighting, like a big animated film.",
    "icon": "style-3d"
  },
  {
    "value": "low_poly",
    "prompt_phrase": "low poly 3D style, faceted geometry, flat shading",
    "label": "Low poly",
    "friendlyLabel": "Chunky 3D shapes",
    "help": "3D made of flat triangles. A bit like an old video game.",
    "icon": "style-low-poly"
  },
  {
    "value": "pixel_art",
    "prompt_phrase": "pixel art style, limited palette, visible pixel grid",
    "label": "Pixel art",
    "friendlyLabel": "Pixel art",
    "help": "Made of visible square pixels, like a retro game.",
    "icon": "style-pixel-art"
  },
  {
    "value": "rubber_hose_1930s",
    "prompt_phrase": "1930s rubber hose animation, black and white, bouncing curves",
    "label": "1930s rubber hose",
    "friendlyLabel": "1930s black and white",
    "help": "Very old cartoon style — bendy arms and legs, no colour.",
    "icon": "style-rubber-hose"
  },
  {
    "value": "noir_high_contrast",
    "prompt_phrase": "high contrast noir style, hard shadows, near-monochrome",
    "label": "Noir",
    "friendlyLabel": "Shadowy detective film",
    "help": "Hard shadows and almost no colour. Mysterious.",
    "icon": "style-noir"
  }
] as const;

export type MoodAtmosphere = "whimsical" | "tense" | "melancholy" | "triumphant" | "eerie" | "chaotic_comic" | "cosy" | "epic" | "dreamlike" | "mundane" | "menacing" | "bittersweet";
export const MOOD_ATMOSPHERE_VALUES = ["whimsical", "tense", "melancholy", "triumphant", "eerie", "chaotic_comic", "cosy", "epic", "dreamlike", "mundane", "menacing", "bittersweet"] as const satisfies readonly MoodAtmosphere[];
export const MOOD_ATMOSPHERE = [
  {
    "value": "whimsical",
    "prompt_phrase": "whimsical playful atmosphere",
    "label": "Whimsical",
    "friendlyLabel": "Playful and silly",
    "help": "Light-hearted and a bit odd, in a good way.",
    "icon": "mood-whimsical"
  },
  {
    "value": "tense",
    "prompt_phrase": "tense, taut atmosphere",
    "label": "Tense",
    "friendlyLabel": "Tense",
    "help": "Something's about to go wrong and everyone can feel it.",
    "icon": "mood-tense"
  },
  {
    "value": "melancholy",
    "prompt_phrase": "melancholy, wistful atmosphere",
    "label": "Melancholy",
    "friendlyLabel": "A bit sad",
    "help": "Quietly sad, missing something.",
    "icon": "mood-melancholy"
  },
  {
    "value": "triumphant",
    "prompt_phrase": "triumphant, uplifting atmosphere",
    "label": "Triumphant",
    "friendlyLabel": "They did it!",
    "help": "Winning, cheering, everything works out.",
    "icon": "mood-triumphant"
  },
  {
    "value": "eerie",
    "prompt_phrase": "eerie, unsettling atmosphere",
    "label": "Eerie",
    "friendlyLabel": "Creepy",
    "help": "Something feels wrong but you can't say what.",
    "icon": "mood-eerie"
  },
  {
    "value": "chaotic_comic",
    "prompt_phrase": "chaotic slapstick comic energy",
    "label": "Chaotic comic",
    "friendlyLabel": "Total chaos",
    "help": "Everything going wrong at once, and it's funny.",
    "icon": "mood-chaotic"
  },
  {
    "value": "cosy",
    "prompt_phrase": "cosy, warm, safe atmosphere",
    "label": "Cosy",
    "friendlyLabel": "Warm and safe",
    "help": "Snug and comfortable. Nothing bad can happen here.",
    "icon": "mood-cosy"
  },
  {
    "value": "epic",
    "prompt_phrase": "epic, grand scale atmosphere",
    "label": "Epic",
    "friendlyLabel": "Huge and important",
    "help": "Big, grand and sweeping.",
    "icon": "mood-epic"
  },
  {
    "value": "dreamlike",
    "prompt_phrase": "dreamlike, hazy, surreal atmosphere",
    "label": "Dreamlike",
    "friendlyLabel": "Like a dream",
    "help": "Hazy and strange, where things don't quite make sense.",
    "icon": "mood-dreamlike"
  },
  {
    "value": "mundane",
    "prompt_phrase": "mundane, everyday, unremarkable atmosphere",
    "label": "Mundane",
    "friendlyLabel": "Totally ordinary",
    "help": "Nothing special happening. Useful just before something does.",
    "icon": "mood-mundane"
  },
  {
    "value": "menacing",
    "prompt_phrase": "menacing, threatening atmosphere",
    "label": "Menacing",
    "friendlyLabel": "Threatening",
    "help": "Something dangerous is coming.",
    "icon": "mood-menacing"
  },
  {
    "value": "bittersweet",
    "prompt_phrase": "bittersweet atmosphere",
    "label": "Bittersweet",
    "friendlyLabel": "Happy and sad at once",
    "help": "A good ending that still hurts a bit.",
    "icon": "mood-bittersweet"
  }
] as const;

export type MusicGenre = "orchestral" | "jazz" | "chiptune" | "synthwave" | "folk_acoustic" | "rock" | "hip_hop" | "ambient" | "circus_polka" | "lullaby" | "marching_band" | "silence";
export const MUSIC_GENRE_VALUES = ["orchestral", "jazz", "chiptune", "synthwave", "folk_acoustic", "rock", "hip_hop", "ambient", "circus_polka", "lullaby", "marching_band", "silence"] as const satisfies readonly MusicGenre[];
export const MUSIC_GENRE = [
  {
    "value": "orchestral",
    "label": "Orchestral",
    "friendlyLabel": "Big orchestra",
    "icon": "music-orchestral"
  },
  {
    "value": "jazz",
    "label": "Jazz",
    "friendlyLabel": "Jazz",
    "icon": "music-jazz"
  },
  {
    "value": "chiptune",
    "label": "Chiptune",
    "friendlyLabel": "Retro game music",
    "icon": "music-chiptune"
  },
  {
    "value": "synthwave",
    "label": "Synthwave",
    "friendlyLabel": "80s synth",
    "icon": "music-synthwave"
  },
  {
    "value": "folk_acoustic",
    "label": "Folk acoustic",
    "friendlyLabel": "Acoustic guitar",
    "icon": "music-folk"
  },
  {
    "value": "rock",
    "label": "Rock",
    "friendlyLabel": "Rock",
    "icon": "music-rock"
  },
  {
    "value": "hip_hop",
    "label": "Hip hop",
    "friendlyLabel": "Hip hop",
    "icon": "music-hip-hop"
  },
  {
    "value": "ambient",
    "label": "Ambient",
    "friendlyLabel": "Floaty background music",
    "icon": "music-ambient"
  },
  {
    "value": "circus_polka",
    "label": "Circus polka",
    "friendlyLabel": "Silly circus music",
    "icon": "music-circus"
  },
  {
    "value": "lullaby",
    "label": "Lullaby",
    "friendlyLabel": "Lullaby",
    "icon": "music-lullaby"
  },
  {
    "value": "marching_band",
    "label": "Marching band",
    "friendlyLabel": "Marching band",
    "icon": "music-marching"
  },
  {
    "value": "silence",
    "label": "Silence",
    "friendlyLabel": "No music at all",
    "icon": "music-silence"
  }
] as const;
