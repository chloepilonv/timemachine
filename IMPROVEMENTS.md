# Improvements

## Past & Future Splat Quality (Fuzzy Rendering)

The past and future gaussian splats look noticeably fuzzier than the present. Root cause: Gemini's image editing API outputs tiles at ~1070x1000 (~0.8MB) while the present tiles are ~1250x1180 (~1.7MB). Fewer pixels and less detail per pixel → fewer gaussians in the World Labs splat → fuzzy rendering.

Splat file sizes confirm this: present.spz is 29MB vs 21MB for past/future.

### Fix Options (ranked)

#### 1. Add `imageSize` parameter to Gemini config (quick try)

Gemini supports `imageConfig: { imageSize: "2K" }` in `generationConfig`. One-line change in `generate_past.py` / `generate_future.py`:

```json
"generationConfig": {
  "responseModalities": ["TEXT", "IMAGE"],
  "imageConfig": { "imageSize": "2K" }
}
```

**Caveat:** Multiple developers report this parameter is ignored during image *editing* (works for text-to-image only). Known bug. Worth trying since it's free — may work via raw REST even if SDKs have issues.

#### 2. Switch to FLUX.2 for image editing (best quality)

FLUX.2 [pro] natively supports up to 4MP output — our 1.5MP tiles are well within range. `flux-canny-pro` can lock architectural edges exactly while restyling, which is ideal for preserving the Ferry Building structure.

- Available via Replicate, fal.ai, or BFL API
- No resolution loss — outputs at input resolution
- Canny/depth conditioning provides strong structural preservation
- Would replace Gemini in `generate_past.py` / `generate_future.py`

#### 3. Upscale existing Gemini outputs with Real-ESRGAN (quickest fix)

Use Real-ESRGAN (x2 model) to upscale Gemini's ~1070x1000 output to ~2140x2000, then Lanczos downsample to ~1250x1180. Then re-run World Labs generation.

- `pip install py-real-esrgan torch torchvision` (local, free)
- Or use Replicate's hosted Real-ESRGAN (~$0.01/image)
- Won't recover detail Gemini lost, but produces sharper splats
- Good for architectural scenes (edges, brickwork, windows)

Plain Pillow Lanczos resize is also acceptable for this modest 1.17x scale factor, but won't recover any lost detail.
