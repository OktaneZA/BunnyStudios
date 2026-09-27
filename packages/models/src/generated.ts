// GENERATED FILE — do not edit.
// Source: packages/models/models.json
// Regenerate with: npm run codegen -w @storyboard/models

export const MODELS = [
  {
    "id": "quick_picture",
    "provider": "fal",
    "provider_model": "fal-ai/flux/schnell",
    "kind": "image",
    "label": "FLUX Schnell",
    "friendlyLabel": "Quick Picture",
    "help": "Fast and cheap. Good for trying ideas.",
    "icon": "model-image",
    "capabilities": {
      "reference_images": false,
      "start_frame": false,
      "end_frame": false,
      "audio": false,
      "multi_shot": false,
      "image_to_video": false,
      "text_to_video": false
    },
    "aspect_ratios": [
      "16:9",
      "9:16",
      "1:1"
    ],
    "resolutions": [
      "1024"
    ],
    "duration_seconds": null,
    "max_reference_images": 0,
    "max_prompt_length": 2000,
    "unit": "image",
    "unit_cost_pence": 0.4,
    "request_shape": {
      "prompt": "prompt",
      "count": "num_images",
      "aspect_ratio": "image_size",
      "aspect_ratio_format": "flux_size",
      "safety": "enable_safety_checker"
    },
    "result_shape": {
      "files": "images"
    },
    "enabled": true
  },
  {
    "id": "cast_picture",
    "provider": "fal",
    "provider_model": "fal-ai/nano-banana/edit",
    "kind": "image",
    "label": "Nano Banana (edit)",
    "friendlyLabel": "Cast Picture",
    "help": "Uses your cast pictures so people look the same in every scene.",
    "icon": "model-image",
    "capabilities": {
      "reference_images": true,
      "requires_reference_images": true,
      "start_frame": false,
      "end_frame": false,
      "audio": false,
      "multi_shot": false,
      "image_to_video": false,
      "text_to_video": false
    },
    "aspect_ratios": [
      "16:9",
      "9:16",
      "1:1"
    ],
    "resolutions": [
      "1024"
    ],
    "duration_seconds": null,
    "max_reference_images": 4,
    "max_prompt_length": 2000,
    "unit": "image",
    "unit_cost_pence": 3.2,
    "request_shape": {
      "prompt": "prompt",
      "count": "num_images",
      "reference_images": "image_urls",
      "aspect_ratio": "aspect_ratio",
      "aspect_ratio_format": "ratio"
    },
    "result_shape": {
      "files": "images"
    },
    "enabled": true
  },
  {
    "id": "careful_picture",
    "provider": "fal",
    "provider_model": "fal-ai/flux/dev",
    "kind": "image",
    "label": "FLUX Dev",
    "friendlyLabel": "Careful Picture",
    "help": "Sharper and more detailed. Takes a little longer.",
    "icon": "model-image",
    "capabilities": {
      "reference_images": false,
      "start_frame": false,
      "end_frame": false,
      "audio": false,
      "multi_shot": false,
      "image_to_video": false,
      "text_to_video": false
    },
    "aspect_ratios": [
      "16:9",
      "9:16",
      "1:1"
    ],
    "resolutions": [
      "1024"
    ],
    "duration_seconds": null,
    "max_reference_images": 0,
    "max_prompt_length": 2000,
    "unit": "image",
    "unit_cost_pence": 2,
    "request_shape": {
      "prompt": "prompt",
      "count": "num_images",
      "aspect_ratio": "image_size",
      "aspect_ratio_format": "flux_size",
      "safety": "enable_safety_checker"
    },
    "result_shape": {
      "files": "images"
    },
    "enabled": true
  },
  {
    "id": "move_maker",
    "provider": "fal",
    "provider_model": "fal-ai/kling-video/v2.1/standard/image-to-video",
    "kind": "video",
    "label": "Kling 2.1 Standard",
    "friendlyLabel": "Move Maker",
    "help": "Makes your picture move. Smooth and reliable. (Off: clips are made straight from the scene now.)",
    "icon": "model-video",
    "capabilities": {
      "reference_images": false,
      "start_frame": true,
      "end_frame": false,
      "audio": false,
      "multi_shot": false,
      "image_to_video": true,
      "text_to_video": false
    },
    "aspect_ratios": [
      "16:9",
      "9:16",
      "1:1"
    ],
    "resolutions": [
      "720p"
    ],
    "duration_seconds": {
      "min": 5,
      "max": 10,
      "step": 5
    },
    "max_reference_images": 0,
    "max_prompt_length": 2000,
    "unit": "second",
    "unit_cost_pence": 4,
    "request_shape": {
      "prompt": "prompt",
      "start_frame": "image_url",
      "duration": "duration",
      "duration_format": "string_seconds",
      "aspect_ratio": "aspect_ratio",
      "aspect_ratio_format": "ratio",
      "negative_prompt": "negative_prompt"
    },
    "result_shape": {
      "files": "video"
    },
    "enabled": false
  },
  {
    "id": "sound_mover",
    "provider": "fal",
    "provider_model": "fal-ai/veo3/fast/image-to-video",
    "kind": "video",
    "label": "Veo 3 Fast",
    "friendlyLabel": "Sound Mover",
    "help": "Makes your picture move and adds sounds. Costs more. (Off: clips are made straight from the scene now.)",
    "icon": "model-video",
    "capabilities": {
      "reference_images": false,
      "start_frame": true,
      "end_frame": false,
      "audio": true,
      "multi_shot": false,
      "image_to_video": true,
      "text_to_video": false
    },
    "aspect_ratios": [
      "16:9",
      "9:16"
    ],
    "resolutions": [
      "720p",
      "1080p"
    ],
    "duration_seconds": {
      "min": 4,
      "max": 8,
      "step": 2
    },
    "max_reference_images": 0,
    "max_prompt_length": 2000,
    "unit": "second",
    "unit_cost_pence": 8,
    "request_shape": {
      "prompt": "prompt",
      "start_frame": "image_url",
      "duration": "duration",
      "duration_format": "string_seconds_suffix",
      "aspect_ratio": "aspect_ratio",
      "aspect_ratio_format": "ratio",
      "audio": "generate_audio",
      "resolution": "resolution"
    },
    "result_shape": {
      "files": "video"
    },
    "enabled": false
  },
  {
    "id": "budget_mover",
    "provider": "fal",
    "provider_model": "fal-ai/wan/v2.2-5b/image-to-video",
    "kind": "video",
    "label": "Wan 2.2 5B",
    "friendlyLabel": "Budget Mover",
    "help": "The cheapest way to make a picture move. Simpler motion. (Off: clips are made straight from the scene now.)",
    "icon": "model-video",
    "capabilities": {
      "reference_images": false,
      "start_frame": true,
      "end_frame": false,
      "audio": false,
      "multi_shot": false,
      "image_to_video": true,
      "text_to_video": false
    },
    "aspect_ratios": [
      "16:9",
      "9:16",
      "1:1"
    ],
    "resolutions": [
      "580p",
      "720p"
    ],
    "duration_seconds": {
      "min": 5,
      "max": 5,
      "step": 5
    },
    "max_reference_images": 0,
    "max_prompt_length": 2000,
    "unit": "second",
    "unit_cost_pence": 1.6,
    "request_shape": {
      "prompt": "prompt",
      "start_frame": "image_url",
      "aspect_ratio": "aspect_ratio",
      "aspect_ratio_format": "ratio",
      "resolution": "resolution",
      "negative_prompt": "negative_prompt"
    },
    "result_shape": {
      "files": "video"
    },
    "enabled": false
  },
  {
    "id": "clip_low",
    "provider": "fal",
    "provider_model": "fal-ai/wan/v2.2-5b/text-to-video",
    "kind": "video",
    "tier": "low",
    "label": "Wan 2.2 5B (text to video)",
    "friendlyLabel": "Low cost",
    "help": "The cheapest clip. Simple motion, no sounds.",
    "icon": "model-video",
    "capabilities": {
      "reference_images": false,
      "start_frame": false,
      "end_frame": false,
      "audio": false,
      "multi_shot": false,
      "image_to_video": false,
      "text_to_video": true
    },
    "aspect_ratios": [
      "16:9",
      "9:16",
      "1:1"
    ],
    "resolutions": [
      "580p",
      "720p"
    ],
    "duration_seconds": {
      "min": 5,
      "max": 5,
      "step": 5
    },
    "max_reference_images": 0,
    "max_prompt_length": 2000,
    "unit": "second",
    "unit_cost_pence": 1.6,
    "request_shape": {
      "prompt": "prompt",
      "aspect_ratio": "aspect_ratio",
      "aspect_ratio_format": "ratio",
      "resolution": "resolution",
      "negative_prompt": "negative_prompt"
    },
    "result_shape": {
      "files": "video"
    },
    "enabled": true
  },
  {
    "id": "clip_medium",
    "provider": "fal",
    "provider_model": "fal-ai/minimax/hailuo-02/standard/text-to-video",
    "kind": "video",
    "tier": "medium",
    "label": "Hailuo 02 Standard (text to video)",
    "friendlyLabel": "Medium",
    "help": "Better motion and detail. No sounds.",
    "icon": "model-video",
    "capabilities": {
      "reference_images": false,
      "start_frame": false,
      "end_frame": false,
      "audio": false,
      "multi_shot": false,
      "image_to_video": false,
      "text_to_video": true
    },
    "aspect_ratios": [
      "16:9"
    ],
    "resolutions": [
      "768p"
    ],
    "duration_seconds": {
      "min": 6,
      "max": 10,
      "step": 4
    },
    "max_reference_images": 0,
    "max_prompt_length": 2000,
    "unit": "second",
    "unit_cost_pence": 4,
    "request_shape": {
      "prompt": "prompt",
      "duration": "duration",
      "duration_format": "string_seconds"
    },
    "result_shape": {
      "files": "video"
    },
    "enabled": true
  },
  {
    "id": "clip_high",
    "provider": "fal",
    "provider_model": "fal-ai/veo3/fast",
    "kind": "video",
    "tier": "high",
    "label": "Veo 3 Fast (text to video)",
    "friendlyLabel": "High",
    "help": "The best clips, with sounds. Costs the most.",
    "icon": "model-video",
    "capabilities": {
      "reference_images": false,
      "start_frame": false,
      "end_frame": false,
      "audio": true,
      "multi_shot": false,
      "image_to_video": false,
      "text_to_video": true
    },
    "aspect_ratios": [
      "16:9",
      "9:16"
    ],
    "resolutions": [
      "720p",
      "1080p"
    ],
    "duration_seconds": {
      "min": 4,
      "max": 8,
      "step": 2
    },
    "max_reference_images": 0,
    "max_prompt_length": 2000,
    "unit": "second",
    "unit_cost_pence": 20,
    "request_shape": {
      "prompt": "prompt",
      "duration": "duration",
      "duration_format": "string_seconds_suffix",
      "aspect_ratio": "aspect_ratio",
      "aspect_ratio_format": "ratio",
      "audio": "generate_audio",
      "resolution": "resolution",
      "negative_prompt": "negative_prompt"
    },
    "result_shape": {
      "files": "video"
    },
    "enabled": true
  },
  {
    "id": "seedance_25",
    "provider": "fal",
    "provider_model": "bytedance/seedance-2.5/text-to-video",
    "kind": "video",
    "tier": "high",
    "label": "Seedance 2.5",
    "friendlyLabel": "Seedance 2.5",
    "help": "Longer clips with sound. Check the price: this is a premium choice.",
    "icon": "model-video",
    "capabilities": {
      "reference_images": false,
      "start_frame": false,
      "end_frame": false,
      "audio": true,
      "multi_shot": false,
      "image_to_video": false,
      "text_to_video": true
    },
    "aspect_ratios": [
      "16:9",
      "9:16"
    ],
    "resolutions": [
      "720p",
      "1080p"
    ],
    "duration_seconds": {
      "min": 4,
      "max": 30,
      "step": 1
    },
    "max_reference_images": 0,
    "max_prompt_length": 2000,
    "unit": "second",
    "unit_cost_pence": 46.224,
    "request_shape": {
      "prompt": "prompt",
      "duration": "duration",
      "duration_format": "string_seconds",
      "resolution": "resolution",
      "aspect_ratio": "aspect_ratio",
      "audio": "generate_audio",
      "defaults": {
        "codec": "H264",
        "draft": false
      }
    },
    "result_shape": {
      "files": "video"
    },
    "enabled": true,
    "video": {
      "family": "seedance_25",
      "categories": [
        "recommended",
        "cinematic"
      ],
      "audio_mode": "optional",
      "documentation": "https://fal.ai/models/bytedance/seedance-2.5/text-to-video/api"
    },
    "pricing": {
      "strategy": "video_tokens",
      "rates": {
        "720p": 0.0214,
        "1080p": 0.0234
      },
      "pence_per_usd": 100,
      "verified_on": "2026-09-27",
      "source": "https://fal.ai/models/bytedance/seedance-2.5/text-to-video",
      "pixels_per_frame": {
        "720p": 921600,
        "1080p": 2073600
      },
      "fps": 24
    }
  },
  {
    "id": "seedance_25_refs",
    "provider": "fal",
    "provider_model": "bytedance/seedance-2.5/reference-to-video",
    "kind": "video",
    "tier": "high",
    "label": "Seedance 2.5 · Cast pictures",
    "friendlyLabel": "Seedance 2.5 · Cast pictures",
    "help": "Uses the main pictures of the characters in this scene. Pictures guide the result; check the finished characters.",
    "icon": "model-video",
    "capabilities": {
      "reference_images": true,
      "start_frame": false,
      "end_frame": false,
      "audio": true,
      "multi_shot": false,
      "image_to_video": false,
      "text_to_video": false,
      "requires_reference_images": true
    },
    "aspect_ratios": [
      "16:9",
      "9:16"
    ],
    "resolutions": [
      "720p",
      "1080p"
    ],
    "duration_seconds": {
      "min": 4,
      "max": 30,
      "step": 1
    },
    "max_reference_images": 30,
    "max_prompt_length": 2000,
    "unit": "second",
    "unit_cost_pence": 46.224,
    "request_shape": {
      "prompt": "prompt",
      "duration": "duration",
      "duration_format": "string_seconds",
      "resolution": "resolution",
      "aspect_ratio": "aspect_ratio",
      "audio": "generate_audio",
      "defaults": {
        "codec": "H264",
        "draft": false,
        "task": "reference"
      },
      "reference_images": "image_urls",
      "reference_token_prefix": "@Image"
    },
    "result_shape": {
      "files": "video"
    },
    "enabled": true,
    "video": {
      "family": "seedance_25",
      "categories": [
        "references"
      ],
      "audio_mode": "optional",
      "documentation": "https://fal.ai/models/bytedance/seedance-2.5/reference-to-video/api"
    },
    "pricing": {
      "strategy": "video_tokens",
      "rates": {
        "720p": 0.0214,
        "1080p": 0.0234
      },
      "pence_per_usd": 100,
      "verified_on": "2026-09-27",
      "source": "https://fal.ai/models/bytedance/seedance-2.5/reference-to-video",
      "pixels_per_frame": {
        "720p": 921600,
        "1080p": 2073600
      },
      "fps": 24
    }
  },
  {
    "id": "wan_30",
    "provider": "fal",
    "provider_model": "alibaba/wan-3.0/text-to-video",
    "kind": "video",
    "tier": "high",
    "label": "Wan 3.0",
    "friendlyLabel": "Wan 3.0",
    "help": "Choose the length and size, then check the price before making a clip.",
    "icon": "model-video",
    "capabilities": {
      "reference_images": false,
      "start_frame": false,
      "end_frame": false,
      "audio": true,
      "multi_shot": false,
      "image_to_video": false,
      "text_to_video": true
    },
    "aspect_ratios": [
      "16:9",
      "9:16",
      "1:1"
    ],
    "resolutions": [
      "720p",
      "480p",
      "1080p"
    ],
    "duration_seconds": {
      "min": 2,
      "max": 30,
      "step": 1
    },
    "max_reference_images": 0,
    "max_prompt_length": 2000,
    "unit": "second",
    "unit_cost_pence": 10,
    "request_shape": {
      "prompt": "prompt",
      "duration": "duration",
      "duration_format": "number",
      "resolution": "resolution",
      "aspect_ratio": "aspect_ratio",
      "audio": "audio",
      "safety": "enable_safety_checker",
      "defaults": {
        "enable_prompt_expansion": false
      }
    },
    "result_shape": {
      "files": "video"
    },
    "enabled": true,
    "video": {
      "family": "wan_30",
      "categories": [
        "cinematic"
      ],
      "audio_mode": "optional",
      "documentation": "https://fal.ai/models/alibaba/wan-3.0/text-to-video/api"
    },
    "pricing": {
      "strategy": "per_second",
      "rates": {
        "720p": 0.1,
        "480p": 0.05,
        "1080p": 0.2
      },
      "pence_per_usd": 100,
      "verified_on": "2026-09-27",
      "source": "https://fal.ai/models/alibaba/wan-3.0/text-to-video"
    }
  },
  {
    "id": "wan_30_prime",
    "provider": "fal",
    "provider_model": "alibaba/wan-3.0-prime/text-to-video",
    "kind": "video",
    "tier": "high",
    "label": "Wan 3.0 Prime",
    "friendlyLabel": "Wan 3.0 Prime",
    "help": "Choose the length and size, then check the price before making a clip.",
    "icon": "model-video",
    "capabilities": {
      "reference_images": false,
      "start_frame": false,
      "end_frame": false,
      "audio": true,
      "multi_shot": false,
      "image_to_video": false,
      "text_to_video": true
    },
    "aspect_ratios": [
      "16:9",
      "9:16",
      "1:1"
    ],
    "resolutions": [
      "720p",
      "480p",
      "1080p"
    ],
    "duration_seconds": {
      "min": 2,
      "max": 30,
      "step": 1
    },
    "max_reference_images": 0,
    "max_prompt_length": 2000,
    "unit": "second",
    "unit_cost_pence": 14.000000000000002,
    "request_shape": {
      "prompt": "prompt",
      "duration": "duration",
      "duration_format": "number",
      "resolution": "resolution",
      "aspect_ratio": "aspect_ratio",
      "audio": "audio",
      "safety": "enable_safety_checker",
      "defaults": {
        "enable_prompt_expansion": false
      }
    },
    "result_shape": {
      "files": "video"
    },
    "enabled": true,
    "video": {
      "family": "wan_30",
      "categories": [
        "cinematic"
      ],
      "audio_mode": "optional",
      "documentation": "https://fal.ai/models/alibaba/wan-3.0-prime/text-to-video/api"
    },
    "pricing": {
      "strategy": "per_second",
      "rates": {
        "720p": 0.14,
        "480p": 0.068,
        "1080p": 0.28
      },
      "pence_per_usd": 100,
      "verified_on": "2026-09-27",
      "source": "https://fal.ai/models/alibaba/wan-3.0-prime/text-to-video"
    }
  },
  {
    "id": "wan_30_refs",
    "provider": "fal",
    "provider_model": "alibaba/wan-3.0/reference-to-video",
    "kind": "video",
    "tier": "high",
    "label": "Wan 3.0 · Cast pictures",
    "friendlyLabel": "Wan 3.0 · Cast pictures",
    "help": "Uses the main pictures of the characters in this scene. Pictures guide the result; check the finished characters.",
    "icon": "model-video",
    "capabilities": {
      "reference_images": true,
      "start_frame": false,
      "end_frame": false,
      "audio": true,
      "multi_shot": false,
      "image_to_video": false,
      "text_to_video": false,
      "requires_reference_images": true
    },
    "aspect_ratios": [
      "16:9",
      "9:16",
      "1:1"
    ],
    "resolutions": [
      "720p",
      "480p",
      "1080p"
    ],
    "duration_seconds": {
      "min": 2,
      "max": 30,
      "step": 1
    },
    "max_reference_images": 10,
    "max_prompt_length": 2000,
    "unit": "second",
    "unit_cost_pence": 10,
    "request_shape": {
      "prompt": "prompt",
      "duration": "duration",
      "duration_format": "number",
      "resolution": "resolution",
      "aspect_ratio": "aspect_ratio",
      "audio": "audio",
      "safety": "enable_safety_checker",
      "defaults": {
        "enable_prompt_expansion": false
      },
      "reference_images": "reference_image_urls",
      "reference_token_prefix": "Image "
    },
    "result_shape": {
      "files": "video"
    },
    "enabled": true,
    "video": {
      "family": "wan_30",
      "categories": [
        "references"
      ],
      "audio_mode": "optional",
      "documentation": "https://fal.ai/models/alibaba/wan-3.0/reference-to-video/api"
    },
    "pricing": {
      "strategy": "per_second",
      "rates": {
        "720p": 0.1,
        "480p": 0.05,
        "1080p": 0.2
      },
      "pence_per_usd": 100,
      "verified_on": "2026-09-27",
      "source": "https://fal.ai/models/alibaba/wan-3.0/reference-to-video"
    }
  },
  {
    "id": "minimax_h3_max",
    "provider": "fal",
    "provider_model": "minimax/h3-max/text-to-video",
    "kind": "video",
    "tier": "high",
    "label": "MiniMax H3 Max",
    "friendlyLabel": "MiniMax H3 Max",
    "help": "An alternative for 5–15 second clips. Sound is always included. 1080P is refined from 768P.",
    "icon": "model-video",
    "capabilities": {
      "reference_images": false,
      "start_frame": false,
      "end_frame": false,
      "audio": true,
      "multi_shot": false,
      "image_to_video": false,
      "text_to_video": true
    },
    "aspect_ratios": [
      "16:9",
      "9:16",
      "1:1"
    ],
    "resolutions": [
      "768P",
      "480P",
      "1080P"
    ],
    "duration_seconds": {
      "min": 5,
      "max": 15,
      "step": 1
    },
    "max_reference_images": 0,
    "max_prompt_length": 2000,
    "unit": "second",
    "unit_cost_pence": 8,
    "request_shape": {
      "prompt": "prompt",
      "duration": "duration",
      "duration_format": "number",
      "resolution": "resolution",
      "aspect_ratio": "aspect_ratio",
      "safety": "enable_safety_checker",
      "defaults": {
        "prompt_expansion_mode": "disabled"
      }
    },
    "result_shape": {
      "files": "video"
    },
    "enabled": true,
    "video": {
      "family": "minimax_h3",
      "categories": [
        "fast"
      ],
      "audio_mode": "always",
      "documentation": "https://fal.ai/models/minimax/h3-max/text-to-video/api"
    },
    "pricing": {
      "strategy": "per_second",
      "rates": {
        "768P": 0.08,
        "480P": 0.05,
        "1080P": 0.16
      },
      "pence_per_usd": 100,
      "verified_on": "2026-09-27",
      "source": "https://fal.ai/models/minimax/h3-max/text-to-video"
    }
  },
  {
    "id": "ltx_25_fast",
    "provider": "fal",
    "provider_model": "lightricks/ltx-2.5/text-to-video/fast",
    "kind": "video",
    "tier": "high",
    "label": "LTX 2.5 Fast",
    "friendlyLabel": "LTX 2.5 Fast",
    "help": "For trying an idea. A later Pro render makes a new take and may change the composition.",
    "icon": "model-video",
    "capabilities": {
      "reference_images": false,
      "start_frame": false,
      "end_frame": false,
      "audio": true,
      "multi_shot": false,
      "image_to_video": false,
      "text_to_video": true
    },
    "aspect_ratios": [
      "16:9",
      "9:16"
    ],
    "resolutions": [
      "720p",
      "1080p"
    ],
    "duration_seconds": {
      "min": 6,
      "max": 20,
      "step": 2
    },
    "max_reference_images": 0,
    "max_prompt_length": 2000,
    "unit": "second",
    "unit_cost_pence": 9,
    "request_shape": {
      "prompt": "prompt",
      "duration": "duration",
      "duration_format": "string_seconds",
      "resolution": "resolution",
      "aspect_ratio": "aspect_ratio",
      "audio": "generate_audio",
      "defaults": {
        "fps": 25
      }
    },
    "result_shape": {
      "files": "video"
    },
    "enabled": true,
    "video": {
      "family": "ltx_25",
      "categories": [
        "fast"
      ],
      "audio_mode": "optional",
      "documentation": "https://fal.ai/models/lightricks/ltx-2.5/text-to-video/fast/api",
      "final_model_id": "ltx_25_pro"
    },
    "pricing": {
      "strategy": "per_second",
      "rates": {
        "720p": 0.09,
        "1080p": 0.13
      },
      "pence_per_usd": 100,
      "verified_on": "2026-09-27",
      "source": "https://fal.ai/models/lightricks/ltx-2.5/text-to-video/fast"
    }
  },
  {
    "id": "ltx_25_pro",
    "provider": "fal",
    "provider_model": "lightricks/ltx-2.5/text-to-video/pro",
    "kind": "video",
    "tier": "high",
    "label": "LTX 2.5 Pro",
    "friendlyLabel": "LTX 2.5 Pro",
    "help": "A quality-focused alternative. Generates 6, 8 or 10 seconds per take.",
    "icon": "model-video",
    "capabilities": {
      "reference_images": false,
      "start_frame": false,
      "end_frame": false,
      "audio": true,
      "multi_shot": false,
      "image_to_video": false,
      "text_to_video": true
    },
    "aspect_ratios": [
      "16:9",
      "9:16"
    ],
    "resolutions": [
      "720p",
      "1080p"
    ],
    "duration_seconds": {
      "min": 6,
      "max": 10,
      "step": 2
    },
    "max_reference_images": 0,
    "max_prompt_length": 2000,
    "unit": "second",
    "unit_cost_pence": 12,
    "request_shape": {
      "prompt": "prompt",
      "duration": "duration",
      "duration_format": "string_seconds",
      "resolution": "resolution",
      "aspect_ratio": "aspect_ratio",
      "audio": "generate_audio",
      "defaults": {
        "fps": 25
      }
    },
    "result_shape": {
      "files": "video"
    },
    "enabled": true,
    "video": {
      "family": "ltx_25",
      "categories": [
        "cinematic"
      ],
      "audio_mode": "optional",
      "documentation": "https://fal.ai/models/lightricks/ltx-2.5/text-to-video/pro/api"
    },
    "pricing": {
      "strategy": "per_second",
      "rates": {
        "720p": 0.12,
        "1080p": 0.17
      },
      "pence_per_usd": 100,
      "verified_on": "2026-09-27",
      "source": "https://fal.ai/models/lightricks/ltx-2.5/text-to-video/pro"
    }
  },
  {
    "id": "hailuo_23",
    "provider": "fal",
    "provider_model": "fal-ai/minimax/hailuo-2.3/standard/text-to-video",
    "kind": "video",
    "tier": "high",
    "label": "Hailuo 2.3",
    "friendlyLabel": "Hailuo 2.3",
    "help": "A silent 768p alternative. Each 6 or 10 second take has its own price.",
    "icon": "model-video",
    "capabilities": {
      "reference_images": false,
      "start_frame": false,
      "end_frame": false,
      "audio": false,
      "multi_shot": false,
      "image_to_video": false,
      "text_to_video": true
    },
    "aspect_ratios": [
      "16:9"
    ],
    "resolutions": [
      "768p"
    ],
    "duration_seconds": {
      "min": 6,
      "max": 10,
      "step": 4
    },
    "max_reference_images": 0,
    "max_prompt_length": 2000,
    "unit": "second",
    "unit_cost_pence": 5.6,
    "request_shape": {
      "prompt": "prompt",
      "duration": "duration",
      "duration_format": "string_seconds",
      "defaults": {
        "prompt_optimizer": false
      }
    },
    "result_shape": {
      "files": "video"
    },
    "enabled": true,
    "video": {
      "family": "hailuo_23",
      "categories": [
        "more"
      ],
      "audio_mode": "none",
      "documentation": "https://fal.ai/models/fal-ai/minimax/hailuo-2.3/standard/text-to-video/api"
    },
    "pricing": {
      "strategy": "per_clip",
      "rates": {
        "6": 0.28,
        "10": 0.56
      },
      "pence_per_usd": 100,
      "verified_on": "2026-09-27",
      "source": "https://fal.ai/models/fal-ai/minimax/hailuo-2.3/standard/text-to-video"
    }
  },
  {
    "id": "flux_3_video",
    "provider": "fal",
    "provider_model": "blackforestlabs/flux-3/text-to-video",
    "kind": "video",
    "tier": "high",
    "label": "FLUX 3 Video",
    "friendlyLabel": "FLUX 3 Video",
    "help": "Choose the length and size, then check the price before making a clip.",
    "icon": "model-video",
    "capabilities": {
      "reference_images": false,
      "start_frame": false,
      "end_frame": false,
      "audio": true,
      "multi_shot": false,
      "image_to_video": false,
      "text_to_video": true
    },
    "aspect_ratios": [
      "16:9",
      "9:16",
      "1:1"
    ],
    "resolutions": [
      "720p",
      "1080p"
    ],
    "duration_seconds": {
      "min": 5,
      "max": 20,
      "step": 1
    },
    "max_reference_images": 0,
    "max_prompt_length": 2000,
    "unit": "second",
    "unit_cost_pence": 17,
    "request_shape": {
      "prompt": "prompt",
      "duration": "duration",
      "duration_format": "string_seconds",
      "resolution": "resolution",
      "aspect_ratio": "aspect_ratio",
      "audio": "generate_audio",
      "defaults": {
        "safety_tolerance": 0
      }
    },
    "result_shape": {
      "files": "video"
    },
    "enabled": true,
    "video": {
      "family": "flux_3",
      "categories": [
        "more"
      ],
      "audio_mode": "optional",
      "documentation": "https://fal.ai/models/blackforestlabs/flux-3/text-to-video/api"
    },
    "pricing": {
      "strategy": "per_second",
      "rates": {
        "720p": 0.17,
        "1080p": 0.29
      },
      "pence_per_usd": 100,
      "verified_on": "2026-09-27",
      "source": "https://fal.ai/models/blackforestlabs/flux-3/text-to-video"
    }
  }
] as const;

export type ModelId = (typeof MODELS)[number]['id'];
export type ProviderName = (typeof MODELS)[number]['provider'];
