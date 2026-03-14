# timemachine_worldgen

Turn any Google Maps location into a navigable 3D world.

Drop a Google Maps link, place name, or coordinates. The tool extracts high-res 360° panorama tiles from Google Street View, then feeds them to [WorldLabs](https://worldlabs.ai) to generate a 3D Gaussian splat world you can explore.

## How it works

1. **Find panoramas** — paste a Google Maps URL, place name, or `lat,lng`. Discovers all nearby Street View panoramas via the Tiles API.
2. **Extract tiles** — stitches panorama tiles into a full equirectangular image, then slices it into flat perspective views (configurable count + zoom level).
3. **Generate 3D world** — sends the perspective tiles to WorldLabs Marble API, which generates a navigable 3D scene (~20-30s).

## Setup

```bash
pip install httpx python-dotenv pillow fastapi uvicorn
```

Add API keys to `.env`:
```
GOOGLE_API_KEY=...    # Google Cloud — Places, Map Tiles, Street View APIs enabled
WORLDLABS_API_KEY=... # https://worldlabs.ai
```

### Required Google APIs

Enable these in [Google Cloud Console](https://console.cloud.google.com/apis/library):
- Places API (New)
- Map Tiles API
- Street View Static API

## Usage

### Web UI

```bash
python -m uvicorn server:app --port 8000
```

Open `http://localhost:8000`. Paste a location, extract tiles, generate a world.

### CLI

```bash
# extract panorama + tiles from a place name
python pano.py "Ferry Building, San Francisco" --zoom 4 --tiles 4

# from a Google Maps URL (extracts pano ID + walks connected panos)
python pano.py "https://www.google.com/maps/place/...!1sPANO_ID!2e0..." --all

# from coordinates
python pano.py 48.8719,2.3430

# higher resolution (zoom 5 = full res) with more tiles
python pano.py "Colosseum, Rome" --zoom 5 --tiles 7

# generate a world from extracted tiles
python world_creator/create_world.py image panoramas/Ferry_Building/tile_1_000.jpg
```

Output goes to `panoramas/<place_name>/`.

## Files

```
pano.py              — panorama extraction (CLI)
server.py            — web UI (FastAPI)
world_creator/
  create_world.py    — WorldLabs API client
.env                 — API keys
```
