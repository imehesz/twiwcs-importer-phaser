# TWIWCS Importer for Phaser 3

Import `.twiwcs` scene archives into a running [Phaser 3](https://phaser.io) game
as ready-to-use sprites — entirely client-side, no build step or server required.

[TWIWCS (Two-Wall Isometric World Terrain Constructor Kit)](https://mehesz.net/sites/@twiwcs/) is a
portable scene format that bundles sprite sheets (PNG), frame metadata
(TexturePacker JSON), and layout/position data into a single `.twiwcs` JSON file.
This importer decodes that archive and reconstructs the scene at runtime.

This is the Phaser counterpart to the Godot editor plugin. Where the Godot version
generates `.tres`/`.tscn` files at edit time, Phaser is a runtime engine — so here
the importer is a reusable JavaScript class you call from inside a Phaser scene.

## What It Does

Given a parsed `.twiwcs` object, `TwiwcsImporter`:

1. **Decodes embedded base64 PNG sprite sheets** into `Image` elements.
2. **Registers each sheet as a Phaser atlas** via `scene.textures.addAtlas()`,
   mapping every TexturePacker frame to a named frame.
3. **Instantiates `Sprite` objects** at their layout positions, applying scale,
   rotation, horizontal/vertical flip, and z-order (sprites are sorted by
   `z_index` and added to a `Container` in draw order).
4. **Returns the container + sprite list** so you can pan, zoom, animate, or
   attach physics/logic to any sprite.

## Files

```
twiwcs-importer-phaser/
├── index.html                        # Standalone demo (Phaser via CDN)
├── src/
│   └── TwiwcsImporter.js             # The importer class (the reusable part)
├── examples/
│   └── cyberpunk-project-001.twiwcs  # Test archive: 59 frames, 28 placed sprites
└── README.md
```

## Quick Start (Demo)

The demo is fully client-side but `fetch()` needs an HTTP origin, so serve the
folder rather than opening the file directly:

```bash
cd src/twiwcs-importer-phaser
python3 -m http.server 8000
# open http://localhost:8000
```

The demo loads the bundled example automatically. You can also:

- Click **Load example archive** to reload it.
- Click **Open .twiwcs file** to pick a local archive.
- **Drag and drop** any `.twiwcs` file onto the page.
- **Drag** to pan, **scroll** to zoom (large layouts auto-fit on import).

## Using It In Your Own Game

Copy `src/TwiwcsImporter.js` into your project and include it before your scene
code. It exports as a global (`<script>` tag) or via CommonJS (`require`).

```html
<script src="https://cdn.jsdelivr.net/npm/phaser@3.80.1/dist/phaser.min.js"></script>
<script src="TwiwcsImporter.js"></script>
```

### Minimal scene

```javascript
class MyScene extends Phaser.Scene {
    preload() {
        // A .twiwcs file is just JSON — load it like any other JSON asset.
        this.load.json('level1', 'levels/level1.twiwcs');
    }

    async create() {
        const archive = this.cache.json.get('level1');
        const importer = new TwiwcsImporter(this);

        // One-shot: decode textures + place all sprites, centered at (480, 320).
        const { container, sprites } = await importer.import(archive, { x: 480, y: 320 });

        // `sprites` is a flat array of Phaser.GameObjects.Sprite you can drive.
        console.log('placed', sprites.length, 'sprites');
    }
}
```

### Two-step (if you want to preload textures separately)

```javascript
const importer = new TwiwcsImporter(this, { keyPrefix: 'level1' });
await importer.loadTextures(archive);              // register atlases only
const { container } = importer.buildScene(archive, { x: 480, y: 320 });
```

## API

### `new TwiwcsImporter(scene, options?)`

| Option | Default | Description |
|--------|---------|-------------|
| `keyPrefix` | `'twiwcs'` | Texture-key namespace. Use a unique value per archive to avoid collisions on re-import. |
| `verbose` | `true` | Log progress to the console (handy for debugging in DevTools). |

### `await importer.loadTextures(archive)`
Decodes every `asset_set`'s base64 PNG and registers it as a Phaser atlas.
Returns a `Promise` (image decode is async).

### `importer.buildScene(archive, origin?)`
Places a `Sprite` for each `layout.objects` entry. `origin` (`{x, y}`, default
`{0,0}`) is the world position the layout is centered on. Returns
`{ container, sprites }`. Call `loadTextures()` first.

### `await importer.import(archive, origin?)`
Convenience: `loadTextures()` + `buildScene()` in one call.

## TWIWCS File Format

A `.twiwcs` file is a JSON document:

```json
{
  "twiwcs_version": 1,
  "asset_sets": [
    {
      "set_id": 2,
      "filename": "web_upload.png",
      "png_base64": "<base64-encoded PNG, no data: prefix>",
      "json_metadata": "<TexturePacker JSON string: { frames:[...], meta:{...} }>"
    }
  ],
  "layout": {
    "layout_version": 1,
    "objects": [
      {
        "set_id": 2,
        "asset_id": "sprite47",
        "position": { "x": -21.67, "y": -123.74 },
        "scale": { "x": 1, "y": 1 },
        "rotation": 0,
        "flip_h": false,
        "z_index": 877,
        "locked": false
      }
    ]
  }
}
```

- **asset_sets** — sprite sheets with embedded PNG data and TexturePacker frame
  metadata. `json_metadata` may be a JSON **string** or an already-parsed object;
  the importer handles array form, `{frames:[]}` form, and `{frames:{}}` hash form.
- **layout.objects** — positioned references to frames. `asset_id` matches a frame
  `filename` in the referenced `set_id`. Objects are drawn in ascending `z_index`.

## Notes & Limitations

- **Serve over HTTP** — `fetch()` of the `.twiwcs` file won't work from a
  `file://` origin. Drag-and-drop (FileReader) works without a server.
- **Static sprites** — the importer creates static `Sprite`s. Add `AnimationPlayer`-
  style logic yourself; each frame is available by name on the registered atlas.
- **Coordinates are layout-relative** — TWIWCS positions are relative to `(0,0)`.
  Pass an `origin` (e.g. screen center) to place the scene on-screen.
- **Re-import** — pass a fresh `keyPrefix` (e.g. `'twiwcs_' + Date.now()`) per
  import so texture keys never collide, and `destroy(true)` the old container.

## License

MIT
