/**
 * TWIWCS Importer for Phaser 3
 * ----------------------------
 * Loads `.twiwcs` scene archives into a running Phaser 3 game.
 *
 * A `.twiwcs` file bundles sprite sheets (PNG, embedded as base64), TexturePacker
 * frame metadata, and layout/position data into a single JSON document. This class
 * decodes that archive entirely client-side (no server, no preload step) and
 * reconstructs the scene as Phaser GameObjects.
 *
 * Because the PNG data is embedded as base64 and the atlas frames use the
 * TexturePacker JSON-array format, this maps directly onto Phaser's
 * `textures.addAtlas()` API — the same data Godot turns into AtlasTextures.
 *
 * Usage (inside a Phaser.Scene):
 *
 *   // In preload(): fetch the .twiwcs JSON like any other file
 *   this.load.json('myscene', 'examples/cyberpunk-project-001.twiwcs');
 *
 *   // In create(): decode + build
 *   const importer = new TwiwcsImporter(this);
 *   await importer.loadTextures(this.cache.json.get('myscene'));   // register atlases
 *   const container = importer.buildScene(this.cache.json.get('myscene')); // place sprites
 *
 * Or do it in one call:
 *
 *   const importer = new TwiwcsImporter(this);
 *   const { container, sprites } = await importer.import(
 *       this.cache.json.get('myscene'), { x: 480, y: 400 }
 *   );
 *
 * The importer is engine-agnostic about *where* the archive comes from — pass it a
 * parsed object (from this.cache.json, fetch(), a drag-and-drop FileReader, etc).
 */
class TwiwcsImporter {
    /**
     * @param {Phaser.Scene} scene - the scene textures/sprites get added to.
     * @param {object} [options]
     * @param {string} [options.keyPrefix='twiwcs'] - texture-key namespace to avoid collisions.
     * @param {boolean} [options.verbose=true] - console.log progress (helps debugging in DevTools).
     */
    constructor(scene, options = {}) {
        this.scene = scene;
        this.keyPrefix = options.keyPrefix || 'twiwcs';
        this.verbose = options.verbose !== false;
        // set_id -> { textureKey, frameNames:Set } registered with this scene
        this._sets = {};
    }

    _log(...args) {
        if (this.verbose) console.log('[TWIWCS]', ...args);
    }

    /**
     * Decode every asset_set's embedded PNG and register it as a Phaser atlas.
     * Safe to await — image decode is async via HTMLImageElement.onload.
     *
     * @param {object} archive - parsed .twiwcs object.
     * @returns {Promise<void>}
     */
    async loadTextures(archive) {
        const assetSets = archive.asset_sets || [];
        for (let i = 0; i < assetSets.length; i++) {
            await this._registerAtlas(assetSets[i], i);
        }
    }

    /**
     * Register a single asset_set as a Phaser atlas.
     * @private
     */
    async _registerAtlas(asset, index) {
        const setId = asset.set_id != null ? asset.set_id : index;
        const filename = asset.filename || ('set_' + setId);
        const b64 = asset.png_base64 || '';
        if (!b64) {
            console.warn('[TWIWCS] asset_set', setId, 'has no png_base64 — skipping');
            return;
        }

        // Build the Phaser atlas frame map from the TexturePacker metadata.
        const frameData = this._parseFrames(asset.json_metadata);
        if (!frameData.frames || frameData.frames.length === 0) {
            console.warn('[TWIWCS] asset_set', setId, 'has no frames — skipping');
            return;
        }

        const textureKey = this.keyPrefix + '_set_' + setId;

        // Decode base64 PNG into an Image element.
        const img = await this._decodeImage(b64);

        // If this scene already had the key (re-import), clear it first.
        if (this.scene.textures.exists(textureKey)) {
            this.scene.textures.remove(textureKey);
        }

        // Phaser's TexturePacker JSON-Hash/Array loader expects { frames: [...], meta: {...} }.
        // addAtlas(key, source, data) registers the image + all named frames in one call.
        const atlasData = {
            frames: frameData.frames,
            meta: frameData.meta || { image: filename, scale: '1' },
        };
        this.scene.textures.addAtlas(textureKey, img, atlasData);

        const frameNames = new Set(frameData.frames.map(f => f.filename));
        this._sets[setId] = { textureKey, frameNames, filename };
        this._log('registered atlas', textureKey, 'with', frameNames.size, 'frames from', filename);
    }

    /**
     * Normalize TexturePacker metadata (which can be a JSON string, an array, or
     * an object with a `frames` key) into Phaser's expected { frames:[], meta:{} }.
     * @private
     */
    _parseFrames(jsonMetadata) {
        let meta = jsonMetadata;
        if (typeof meta === 'string') {
            try {
                meta = JSON.parse(meta);
            } catch (e) {
                console.warn('[TWIWCS] could not parse json_metadata:', e);
                return { frames: [] };
            }
        }
        if (!meta) return { frames: [] };

        // TexturePacker "Hash" format: { frames: {...}, meta: {...} }  -> already fine if array
        // TexturePacker "Array" format: { frames: [...], meta: {...} }
        // Bare array: [ {filename, frame}, ... ]
        if (Array.isArray(meta)) {
            return { frames: meta, meta: { scale: '1' } };
        }
        if (Array.isArray(meta.frames)) {
            return { frames: meta.frames, meta: meta.meta };
        }
        // Hash form: convert { name: {frame}, ... } -> [ {filename, frame}, ... ]
        if (meta.frames && typeof meta.frames === 'object') {
            const arr = Object.keys(meta.frames).map(name => {
                const f = meta.frames[name];
                return Object.assign({ filename: name }, f);
            });
            return { frames: arr, meta: meta.meta };
        }
        return { frames: [] };
    }

    /**
     * Decode a base64 PNG string into a loaded HTMLImageElement.
     * @private
     * @returns {Promise<HTMLImageElement>}
     */
    _decodeImage(b64) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = (e) => reject(new Error('PNG decode failed: ' + e));
            // The archive stores raw base64 without a data-URI prefix.
            img.src = b64.startsWith('data:') ? b64 : ('data:image/png;base64,' + b64);
        });
    }

    /**
     * Instantiate Sprites for every object in archive.layout.objects.
     * Call loadTextures() first (or use import()).
     *
     * @param {object} archive - parsed .twiwcs object.
     * @param {object} [origin] - { x, y } world position the layout is centered on.
     *                            TWIWCS layout coordinates are relative to (0,0);
     *                            pass a screen-center origin to place the scene on-screen.
     * @returns {{ container: Phaser.GameObjects.Container, sprites: Phaser.GameObjects.Sprite[] }}
     */
    buildScene(archive, origin = { x: 0, y: 0 }) {
        const layout = archive.layout || {};
        const objects = layout.objects || [];

        const container = this.scene.add.container(origin.x, origin.y);
        const sprites = [];

        // Sort by z_index so draw order is correct inside the container.
        const ordered = objects.slice().sort((a, b) => (a.z_index || 0) - (b.z_index || 0));

        let placed = 0, skipped = 0;
        for (const obj of ordered) {
            const setId = obj.set_id;
            const assetId = obj.asset_id;
            const set = this._sets[setId];

            if (!set || !set.frameNames.has(assetId)) {
                skipped++;
                console.warn('[TWIWCS] no frame', assetId, 'in set', setId, '— skipping object');
                continue;
            }

            const pos = obj.position || { x: 0, y: 0 };
            const scl = obj.scale || { x: 1, y: 1 };

            const sprite = this.scene.add.sprite(pos.x, pos.y, set.textureKey, assetId);
            sprite.setScale(scl.x != null ? scl.x : 1, scl.y != null ? scl.y : 1);
            if (obj.rotation) sprite.setAngle(obj.rotation);
            if (obj.flip_h) sprite.setFlipX(true);
            if (obj.flip_v) sprite.setFlipY(true);
            // Phaser draws by insertion order within a container; we pre-sorted by z_index.
            sprite.setData('twiwcs', { assetId, setId, zIndex: obj.z_index || 0, locked: !!obj.locked });

            container.add(sprite);
            sprites.push(sprite);
            placed++;
        }

        this._log('built scene:', placed, 'sprites placed,', skipped, 'skipped');
        return { container, sprites };
    }

    /**
     * Convenience one-shot: decode textures + build the scene.
     * @param {object} archive - parsed .twiwcs object.
     * @param {object} [origin] - { x, y } world position for the layout center.
     * @returns {Promise<{ container, sprites }>}
     */
    async import(archive, origin = { x: 0, y: 0 }) {
        await this.loadTextures(archive);
        return this.buildScene(archive, origin);
    }
}

// UMD-ish export: works as a global (script tag) or CommonJS/ES module.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = TwiwcsImporter;
}
