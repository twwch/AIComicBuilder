# HiDream-O1-Image Local Provider

## Prerequisites

- Python 3.11 with torch 2.11+cu126, CUDA 12.6+
- Model checkpoint downloaded to `I:\AIs\HiDream-O1-Image\models\HiDream-O1-Image-Dev` (~32 GB)
- Project dependencies: `flask`, `transformers`, `pillow`, `torch`, `python-dotenv`

## Start Server

```bash
python I:\AIs\HiDream-O1-Image\app.py \
  --model_path I:\AIs\HiDream-O1-Image\models\HiDream-O1-Image-Dev \
  --model_type dev \
  --host 0.0.0.0 \
  --port 7860
```

- `--model_type dev`: Dev model (28 steps, ~48s per image, 2048×2048)
- `--model_type full`: Full model (50 steps, ~3 min per image)
- Server uses `device_map="auto"` for 16 GB VRAM (model is 32 GB).
- Flash attention disabled (`models/pipeline.py:319`).

## Configure in Settings

- Protocol: `HiDream Image`
- Base URL: `http://localhost:7860`
- Model: `HiDream-O1-Image-Dev` (or `HiDream-O1-Image-Full`)

## Provider Behavior

`src/lib/ai/providers/hidream-image.ts`:
- Calls `POST /api/generate/start` with `{ mode: "t2i", prompt, width: 2048, height: 2048, seed: 32 }`
- Polls `GET /api/generate/stream/<job_id>` (SSE) for result
- Saves output PNG to `uploads/images/<id>.png`
- 30s timeout for start, 300s for stream polling
