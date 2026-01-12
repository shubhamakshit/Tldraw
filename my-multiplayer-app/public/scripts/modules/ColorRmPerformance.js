/**
 * ColorRM Performance Module
 * SOTA optimizations for infinite canvas rendering
 *
 * Features:
 * - Quadtree spatial indexing for O(log n) stroke lookup
 * - Ramer-Douglas-Peucker stroke simplification for LOD
 * - Chunked/tiled rendering with caching
 * - Dirty region tracking for partial updates
 * - Stroke batching for GPU-efficient rendering
 */

// ============================================
// QUADTREE SPATIAL INDEX
// ============================================

class QuadTreeNode {
    constructor(bounds, capacity = 10, depth = 0, maxDepth = 8) {
        this.bounds = bounds; // {x, y, w, h}
        this.capacity = capacity;
        this.depth = depth;
        this.maxDepth = maxDepth;
        this.strokes = [];
        this.divided = false;
        this.children = null; // {nw, ne, sw, se}
    }

    contains(point) {
        return point.x >= this.bounds.x &&
               point.x < this.bounds.x + this.bounds.w &&
               point.y >= this.bounds.y &&
               point.y < this.bounds.y + this.bounds.h;
    }

    intersects(range) {
        return !(range.x > this.bounds.x + this.bounds.w ||
                 range.x + range.w < this.bounds.x ||
                 range.y > this.bounds.y + this.bounds.h ||
                 range.y + range.h < this.bounds.y);
    }

    subdivide() {
        const { x, y, w, h } = this.bounds;
        const hw = w / 2;
        const hh = h / 2;

        this.children = {
            nw: new QuadTreeNode({ x, y, w: hw, h: hh }, this.capacity, this.depth + 1, this.maxDepth),
            ne: new QuadTreeNode({ x: x + hw, y, w: hw, h: hh }, this.capacity, this.depth + 1, this.maxDepth),
            sw: new QuadTreeNode({ x, y: y + hh, w: hw, h: hh }, this.capacity, this.depth + 1, this.maxDepth),
            se: new QuadTreeNode({ x: x + hw, y: y + hh, w: hw, h: hh }, this.capacity, this.depth + 1, this.maxDepth)
        };
        this.divided = true;

        // Redistribute existing strokes
        for (const stroke of this.strokes) {
            this._insertIntoChildren(stroke);
        }
        this.strokes = [];
    }

    _insertIntoChildren(stroke) {
        const strokeBounds = this._getStrokeBounds(stroke);
        for (const child of Object.values(this.children)) {
            if (child.intersects(strokeBounds)) {
                child.insert(stroke);
            }
        }
    }

    _getStrokeBounds(stroke) {
        if (stroke._cachedBounds) return stroke._cachedBounds;

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

        if (stroke.tool === 'pen' && stroke.pts) {
            for (const pt of stroke.pts) {
                minX = Math.min(minX, pt.x);
                minY = Math.min(minY, pt.y);
                maxX = Math.max(maxX, pt.x);
                maxY = Math.max(maxY, pt.y);
            }
            // Add stroke size padding
            const pad = (stroke.size || 5) / 2;
            minX -= pad; minY -= pad; maxX += pad; maxY += pad;
        } else if (stroke.x !== undefined) {
            minX = stroke.x;
            minY = stroke.y;
            maxX = stroke.x + (stroke.w || 0);
            maxY = stroke.y + (stroke.h || 0);
        }

        stroke._cachedBounds = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
        return stroke._cachedBounds;
    }

    insert(stroke) {
        const strokeBounds = this._getStrokeBounds(stroke);
        if (!this.intersects(strokeBounds)) return false;

        if (!this.divided && (this.strokes.length < this.capacity || this.depth >= this.maxDepth)) {
            this.strokes.push(stroke);
            return true;
        }

        if (!this.divided) {
            this.subdivide();
        }

        this._insertIntoChildren(stroke);
        return true;
    }

    query(range, found = []) {
        if (!this.intersects(range)) return found;

        for (const stroke of this.strokes) {
            const strokeBounds = this._getStrokeBounds(stroke);
            if (this._boundsIntersect(strokeBounds, range)) {
                found.push(stroke);
            }
        }

        if (this.divided) {
            for (const child of Object.values(this.children)) {
                child.query(range, found);
            }
        }

        return found;
    }

    _boundsIntersect(a, b) {
        return !(a.x > b.x + b.w || a.x + a.w < b.x ||
                 a.y > b.y + b.h || a.y + a.h < b.y);
    }

    clear() {
        this.strokes = [];
        this.divided = false;
        this.children = null;
    }
}

// ============================================
// STROKE SIMPLIFICATION (Ramer-Douglas-Peucker)
// ============================================

class StrokeSimplifier {
    /**
     * Simplify a stroke using Ramer-Douglas-Peucker algorithm
     * @param {Array} points - Array of {x, y} points
     * @param {number} epsilon - Tolerance (higher = more simplification)
     * @returns {Array} Simplified points
     */
    static simplify(points, epsilon = 1.0) {
        if (points.length < 3) return points;

        // Find the point with maximum distance from line between first and last
        let maxDist = 0;
        let maxIdx = 0;
        const start = points[0];
        const end = points[points.length - 1];

        for (let i = 1; i < points.length - 1; i++) {
            const dist = this._perpendicularDistance(points[i], start, end);
            if (dist > maxDist) {
                maxDist = dist;
                maxIdx = i;
            }
        }

        // If max distance is greater than epsilon, recursively simplify
        if (maxDist > epsilon) {
            const left = this.simplify(points.slice(0, maxIdx + 1), epsilon);
            const right = this.simplify(points.slice(maxIdx), epsilon);
            return left.slice(0, -1).concat(right);
        }

        return [start, end];
    }

    static _perpendicularDistance(point, lineStart, lineEnd) {
        const dx = lineEnd.x - lineStart.x;
        const dy = lineEnd.y - lineStart.y;

        if (dx === 0 && dy === 0) {
            return Math.hypot(point.x - lineStart.x, point.y - lineStart.y);
        }

        const t = ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / (dx * dx + dy * dy);
        const nearestX = lineStart.x + t * dx;
        const nearestY = lineStart.y + t * dy;

        return Math.hypot(point.x - nearestX, point.y - nearestY);
    }

    /**
     * Get LOD-appropriate epsilon based on zoom level
     * @param {number} zoom - Current zoom level
     * @returns {number} Epsilon value for simplification
     */
    static getEpsilonForZoom(zoom) {
        if (zoom >= 1.0) return 0; // Full detail at 100%+ zoom
        if (zoom >= 0.5) return 1.0; // Slight simplification at 50-100%
        if (zoom >= 0.25) return 2.0; // More simplification at 25-50%
        if (zoom >= 0.1) return 4.0; // Aggressive at 10-25%
        return 8.0; // Very aggressive below 10%
    }
}

// ============================================
// CHUNKED TILE RENDERER
// ============================================

class TileRenderer {
    constructor(tileSize = 512) {
        this.tileSize = tileSize;
        this.tileCache = new Map(); // key: "x_y" -> {canvas, lastUsed, version}
        this.maxCachedTiles = 64;
        this.version = 0;
    }

    /**
     * Get tile key for a position
     */
    getTileKey(x, y) {
        const tx = Math.floor(x / this.tileSize);
        const ty = Math.floor(y / this.tileSize);
        return `${tx}_${ty}`;
    }

    /**
     * Get visible tiles for current viewport
     */
    getVisibleTiles(viewport, zoom, pan) {
        const tiles = [];

        // Calculate viewport in canvas coordinates
        const left = -pan.x / zoom;
        const top = -pan.y / zoom;
        const right = left + viewport.width / zoom;
        const bottom = top + viewport.height / zoom;

        // Get tile indices
        const startTileX = Math.floor(left / this.tileSize);
        const startTileY = Math.floor(top / this.tileSize);
        const endTileX = Math.ceil(right / this.tileSize);
        const endTileY = Math.ceil(bottom / this.tileSize);

        for (let tx = startTileX; tx <= endTileX; tx++) {
            for (let ty = startTileY; ty <= endTileY; ty++) {
                tiles.push({
                    key: `${tx}_${ty}`,
                    x: tx * this.tileSize,
                    y: ty * this.tileSize,
                    w: this.tileSize,
                    h: this.tileSize
                });
            }
        }

        return tiles;
    }

    /**
     * Get or create a tile canvas
     */
    getTile(key, strokes, renderFn) {
        const cached = this.tileCache.get(key);

        if (cached && cached.version === this.version) {
            cached.lastUsed = Date.now();
            return cached.canvas;
        }

        // Parse tile coordinates
        const [tx, ty] = key.split('_').map(Number);
        const tileX = tx * this.tileSize;
        const tileY = ty * this.tileSize;

        // Create new tile canvas
        const canvas = document.createElement('canvas');
        canvas.width = this.tileSize;
        canvas.height = this.tileSize;
        const ctx = canvas.getContext('2d');

        // Translate to tile space
        ctx.translate(-tileX, -tileY);

        // Render strokes that intersect this tile
        const tileBounds = { x: tileX, y: tileY, w: this.tileSize, h: this.tileSize };
        for (const stroke of strokes) {
            if (this._strokeIntersectsTile(stroke, tileBounds)) {
                renderFn(ctx, stroke, 0, 0);
            }
        }

        // Cache the tile
        this.tileCache.set(key, {
            canvas,
            lastUsed: Date.now(),
            version: this.version
        });

        // Evict old tiles if cache is full
        this._evictOldTiles();

        return canvas;
    }

    _strokeIntersectsTile(stroke, tile) {
        if (!stroke._cachedBounds) {
            // Quick bounds calculation
            if (stroke.tool === 'pen' && stroke.pts && stroke.pts.length > 0) {
                let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                for (const pt of stroke.pts) {
                    minX = Math.min(minX, pt.x);
                    minY = Math.min(minY, pt.y);
                    maxX = Math.max(maxX, pt.x);
                    maxY = Math.max(maxY, pt.y);
                }
                const pad = (stroke.size || 5) / 2;
                stroke._cachedBounds = { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
            } else if (stroke.x !== undefined) {
                stroke._cachedBounds = { x: stroke.x, y: stroke.y, w: stroke.w || 0, h: stroke.h || 0 };
            } else {
                return true; // Unknown stroke type, assume it intersects
            }
        }

        const b = stroke._cachedBounds;
        return !(b.x > tile.x + tile.w || b.x + b.w < tile.x ||
                 b.y > tile.y + tile.h || b.y + b.h < tile.y);
    }

    _evictOldTiles() {
        if (this.tileCache.size <= this.maxCachedTiles) return;

        // Sort by last used and remove oldest
        const entries = [...this.tileCache.entries()]
            .sort((a, b) => a[1].lastUsed - b[1].lastUsed);

        const toRemove = entries.slice(0, entries.length - this.maxCachedTiles);
        for (const [key] of toRemove) {
            this.tileCache.delete(key);
        }
    }

    invalidate() {
        this.version++;
    }

    invalidateTile(key) {
        this.tileCache.delete(key);
    }

    clear() {
        this.tileCache.clear();
        this.version++;
    }
}

// ============================================
// DIRTY REGION TRACKER
// ============================================

class DirtyRegionTracker {
    constructor() {
        this.dirtyRegions = [];
        this.fullRedraw = true;
    }

    markDirty(bounds) {
        // Merge overlapping regions
        for (let i = 0; i < this.dirtyRegions.length; i++) {
            if (this._regionsOverlap(this.dirtyRegions[i], bounds)) {
                this.dirtyRegions[i] = this._mergeRegions(this.dirtyRegions[i], bounds);
                return;
            }
        }
        this.dirtyRegions.push({ ...bounds });
    }

    markFullRedraw() {
        this.fullRedraw = true;
        this.dirtyRegions = [];
    }

    getDirtyRegions() {
        if (this.fullRedraw) return null; // Indicates full redraw needed
        return this.dirtyRegions;
    }

    clear() {
        this.dirtyRegions = [];
        this.fullRedraw = false;
    }

    _regionsOverlap(a, b) {
        return !(a.x > b.x + b.w || a.x + a.w < b.x ||
                 a.y > b.y + b.h || a.y + a.h < b.y);
    }

    _mergeRegions(a, b) {
        const x = Math.min(a.x, b.x);
        const y = Math.min(a.y, b.y);
        const maxX = Math.max(a.x + a.w, b.x + b.w);
        const maxY = Math.max(a.y + a.h, b.y + b.h);
        return { x, y, w: maxX - x, h: maxY - y };
    }
}

// ============================================
// STROKE BATCHER (for GPU-efficient rendering)
// ============================================

class StrokeBatcher {
    constructor() {
        this.batches = new Map(); // color+size -> strokes[]
    }

    /**
     * Group strokes by rendering properties for batch processing
     */
    batch(strokes) {
        this.batches.clear();

        for (const stroke of strokes) {
            if (stroke.deleted) continue;

            const key = this._getBatchKey(stroke);
            if (!this.batches.has(key)) {
                this.batches.set(key, []);
            }
            this.batches.get(key).push(stroke);
        }

        return this.batches;
    }

    _getBatchKey(stroke) {
        if (stroke.tool === 'pen') {
            return `pen_${stroke.color}_${stroke.size}`;
        } else if (stroke.tool === 'eraser') {
            return `eraser_${stroke.size}`;
        } else if (stroke.tool === 'shape') {
            return `shape_${stroke.shapeType}_${stroke.border}_${stroke.fill}_${stroke.width}`;
        } else if (stroke.tool === 'text') {
            return `text_${stroke.color}_${stroke.size}`;
        }
        return 'other';
    }

    /**
     * Render a batch of strokes efficiently
     */
    renderBatch(ctx, key, strokes, renderFn) {
        if (strokes.length === 0) return;

        // Parse batch key for shared properties
        const [tool, ...rest] = key.split('_');

        if (tool === 'pen') {
            const color = rest[0];
            const size = parseFloat(rest[1]);

            ctx.save();
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.strokeStyle = color;
            ctx.lineWidth = size;

            // Draw all strokes in one path for better GPU batching
            ctx.beginPath();
            for (const stroke of strokes) {
                if (!stroke.pts || stroke.pts.length < 2) continue;
                ctx.moveTo(stroke.pts[0].x, stroke.pts[0].y);
                for (let i = 1; i < stroke.pts.length; i++) {
                    ctx.lineTo(stroke.pts[i].x, stroke.pts[i].y);
                }
            }
            ctx.stroke();
            ctx.restore();
        } else {
            // Fall back to individual rendering for other types
            for (const stroke of strokes) {
                renderFn(ctx, stroke, 0, 0);
            }
        }
    }
}

// ============================================
// PERFORMANCE STATS TRACKER
// ============================================

class PerformanceStats {
    constructor(sampleSize = 60) {
        this.sampleSize = sampleSize;
        this.frameTimes = [];
        this.lastFrameTime = 0;
        this.strokeCounts = [];
        this.visibleStrokeCounts = [];
    }

    startFrame() {
        this.lastFrameTime = performance.now();
    }

    endFrame(totalStrokes, visibleStrokes) {
        const frameTime = performance.now() - this.lastFrameTime;

        this.frameTimes.push(frameTime);
        if (this.frameTimes.length > this.sampleSize) {
            this.frameTimes.shift();
        }

        this.strokeCounts.push(totalStrokes);
        this.visibleStrokeCounts.push(visibleStrokes);
        if (this.strokeCounts.length > this.sampleSize) {
            this.strokeCounts.shift();
            this.visibleStrokeCounts.shift();
        }
    }

    getStats() {
        if (this.frameTimes.length === 0) return null;

        const avgFrameTime = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
        const maxFrameTime = Math.max(...this.frameTimes);
        const minFrameTime = Math.min(...this.frameTimes);
        const fps = 1000 / avgFrameTime;

        const avgTotalStrokes = this.strokeCounts.reduce((a, b) => a + b, 0) / this.strokeCounts.length;
        const avgVisibleStrokes = this.visibleStrokeCounts.reduce((a, b) => a + b, 0) / this.visibleStrokeCounts.length;
        const cullPercentage = avgTotalStrokes > 0 ? ((avgTotalStrokes - avgVisibleStrokes) / avgTotalStrokes * 100) : 0;

        return {
            avgFrameTime: avgFrameTime.toFixed(2),
            maxFrameTime: maxFrameTime.toFixed(2),
            minFrameTime: minFrameTime.toFixed(2),
            fps: fps.toFixed(1),
            avgTotalStrokes: Math.round(avgTotalStrokes),
            avgVisibleStrokes: Math.round(avgVisibleStrokes),
            cullPercentage: cullPercentage.toFixed(1)
        };
    }

    reset() {
        this.frameTimes = [];
        this.strokeCounts = [];
        this.visibleStrokeCounts = [];
    }
}

// ============================================
// MAIN PERFORMANCE MANAGER
// ============================================

export class PerformanceManager {
    constructor() {
        this.quadTree = null;
        this.quadTreeBounds = null;
        this.tileRenderer = new TileRenderer(512);
        this.dirtyTracker = new DirtyRegionTracker();
        this.batcher = new StrokeBatcher();
        this.stats = new PerformanceStats();

        // LOD settings
        this.lodEnabled = true;
        this.lodCache = new Map(); // strokeId -> simplified points at various epsilons

        // Tile rendering settings
        this.tiledRenderingEnabled = true;
        this.tiledRenderingThreshold = 200; // Use tiles when stroke count exceeds this

        // Batching settings
        this.batchingEnabled = true;
        this.batchingThreshold = 50;
    }

    /**
     * Initialize or rebuild the quadtree for a page
     */
    buildSpatialIndex(strokes, bounds) {
        this.quadTree = new QuadTreeNode(bounds, 10, 0, 10);
        this.quadTreeBounds = bounds;

        for (const stroke of strokes) {
            if (!stroke.deleted) {
                this.quadTree.insert(stroke);
            }
        }

        // Invalidate tile cache when rebuilding index
        this.tileRenderer.invalidate();
    }

    /**
     * Add a stroke to the spatial index
     */
    addStroke(stroke) {
        if (this.quadTree && !stroke.deleted) {
            this.quadTree.insert(stroke);

            // Mark affected tiles as dirty
            if (stroke._cachedBounds) {
                const b = stroke._cachedBounds;
                this.dirtyTracker.markDirty(b);
            }
        }
    }

    /**
     * Query strokes visible in the given viewport
     */
    queryVisible(viewport, zoom, pan) {
        if (!this.quadTree) return [];

        // Calculate viewport in canvas coordinates
        const viewBounds = {
            x: -pan.x / zoom,
            y: -pan.y / zoom,
            w: viewport.width / zoom,
            h: viewport.height / zoom
        };

        return this.quadTree.query(viewBounds);
    }

    /**
     * Get LOD-simplified points for a stroke at current zoom
     */
    getSimplifiedPoints(stroke, zoom) {
        if (!this.lodEnabled || !stroke.pts || stroke.pts.length < 3) {
            return stroke.pts;
        }

        const epsilon = StrokeSimplifier.getEpsilonForZoom(zoom);
        if (epsilon === 0) return stroke.pts;

        // Check cache
        const cacheKey = `${stroke.id}_${epsilon}`;
        if (this.lodCache.has(cacheKey)) {
            return this.lodCache.get(cacheKey);
        }

        // Simplify and cache
        const simplified = StrokeSimplifier.simplify(stroke.pts, epsilon);
        this.lodCache.set(cacheKey, simplified);

        // Limit cache size
        if (this.lodCache.size > 1000) {
            const firstKey = this.lodCache.keys().next().value;
            this.lodCache.delete(firstKey);
        }

        return simplified;
    }

    /**
     * Optimized render using all performance features
     */
    renderOptimized(ctx, strokes, viewport, zoom, pan, renderFn) {
        this.stats.startFrame();

        const totalStrokes = strokes.length;
        let visibleStrokes = 0;

        // Query visible strokes using spatial index
        let strokesToRender;
        if (this.quadTree) {
            strokesToRender = this.queryVisible(viewport, zoom, pan);
        } else {
            strokesToRender = strokes.filter(s => !s.deleted);
        }

        visibleStrokes = strokesToRender.length;

        // Use tiled rendering for large stroke counts
        if (this.tiledRenderingEnabled && strokesToRender.length > this.tiledRenderingThreshold) {
            this._renderWithTiles(ctx, strokesToRender, viewport, zoom, pan, renderFn);
        }
        // Use batched rendering for medium stroke counts
        else if (this.batchingEnabled && strokesToRender.length > this.batchingThreshold) {
            this._renderWithBatching(ctx, strokesToRender, zoom, renderFn);
        }
        // Direct rendering for small stroke counts
        else {
            this._renderDirect(ctx, strokesToRender, zoom, renderFn);
        }

        this.stats.endFrame(totalStrokes, visibleStrokes);
    }

    _renderWithTiles(ctx, strokes, viewport, zoom, pan, renderFn) {
        const visibleTiles = this.tileRenderer.getVisibleTiles(viewport, zoom, pan);

        ctx.save();
        ctx.translate(pan.x, pan.y);
        ctx.scale(zoom, zoom);

        for (const tile of visibleTiles) {
            const tileCanvas = this.tileRenderer.getTile(tile.key, strokes, renderFn);
            ctx.drawImage(tileCanvas, tile.x, tile.y);
        }

        ctx.restore();
    }

    _renderWithBatching(ctx, strokes, zoom, renderFn) {
        const batches = this.batcher.batch(strokes);

        for (const [key, batchStrokes] of batches) {
            // Apply LOD to batch strokes
            const lodStrokes = batchStrokes.map(s => {
                if (s.tool === 'pen' && s.pts) {
                    return { ...s, pts: this.getSimplifiedPoints(s, zoom) };
                }
                return s;
            });

            this.batcher.renderBatch(ctx, key, lodStrokes, renderFn);
        }
    }

    _renderDirect(ctx, strokes, zoom, renderFn) {
        for (const stroke of strokes) {
            if (stroke.deleted) continue;

            // Apply LOD
            if (this.lodEnabled && stroke.tool === 'pen' && stroke.pts) {
                const simplifiedPts = this.getSimplifiedPoints(stroke, zoom);
                renderFn(ctx, { ...stroke, pts: simplifiedPts }, 0, 0);
            } else {
                renderFn(ctx, stroke, 0, 0);
            }
        }
    }

    /**
     * Invalidate all caches
     */
    invalidateAll() {
        this.tileRenderer.invalidate();
        this.dirtyTracker.markFullRedraw();
        this.lodCache.clear();
    }

    /**
     * Get performance statistics
     */
    getStats() {
        return this.stats.getStats();
    }

    /**
     * Run comprehensive benchmark
     */
    async runBenchmark(app, strokeCount = 1000, pointsPerStroke = 100) {
        console.log(`\n🚀 SOTA PERFORMANCE BENCHMARK`);
        console.log(`================================`);
        console.log(`Strokes: ${strokeCount}, Points/stroke: ${pointsPerStroke}`);
        console.log(`Total points: ${strokeCount * pointsPerStroke}\n`);

        const img = app.state.images[app.state.idx];
        const originalHistory = [...img.history];

        // Generate test strokes
        const testStrokes = [];
        const colors = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#8b5cf6'];
        const canvasW = app.state.viewW;
        const canvasH = app.state.viewH;

        for (let i = 0; i < strokeCount; i++) {
            const pts = [];
            let x = Math.random() * canvasW;
            let y = Math.random() * canvasH;

            for (let j = 0; j < pointsPerStroke; j++) {
                x += (Math.random() - 0.5) * 30;
                y += (Math.random() - 0.5) * 30;
                pts.push({ x, y });
            }

            testStrokes.push({
                id: `bench_${Date.now()}_${i}`,
                lastMod: Date.now(),
                tool: 'pen',
                pts: pts,
                color: colors[i % colors.length],
                size: 2 + Math.random() * 4,
                deleted: false
            });
        }

        img.history = [...originalHistory, ...testStrokes];

        // Build spatial index
        console.log('Building spatial index...');
        const indexStart = performance.now();
        this.buildSpatialIndex(img.history, {
            x: 0, y: 0, w: canvasW, h: canvasH
        });
        const indexTime = performance.now() - indexStart;
        console.log(`  Spatial index built in ${indexTime.toFixed(2)}ms`);

        // Test 1: Without optimizations
        console.log('\n📊 TEST 1: Baseline (no optimizations)');
        this.lodEnabled = false;
        this.tiledRenderingEnabled = false;
        this.batchingEnabled = false;

        const baselineResults = await this._benchmarkRender(app, 60);
        console.log(`  Avg frame time: ${baselineResults.avg.toFixed(2)}ms`);
        console.log(`  FPS: ${baselineResults.fps.toFixed(1)}`);

        // Test 2: With LOD only
        console.log('\n📊 TEST 2: LOD enabled');
        this.lodEnabled = true;
        this.lodCache.clear();

        const lodResults = await this._benchmarkRender(app, 60);
        console.log(`  Avg frame time: ${lodResults.avg.toFixed(2)}ms`);
        console.log(`  FPS: ${lodResults.fps.toFixed(1)}`);
        console.log(`  Improvement: ${((baselineResults.avg - lodResults.avg) / baselineResults.avg * 100).toFixed(1)}%`);

        // Test 3: With spatial indexing + LOD
        console.log('\n📊 TEST 3: Spatial Index + LOD');
        const viewport = { width: canvasW, height: canvasH };
        const spatialResults = await this._benchmarkSpatialRender(app, 60, viewport);
        console.log(`  Avg frame time: ${spatialResults.avg.toFixed(2)}ms`);
        console.log(`  FPS: ${spatialResults.fps.toFixed(1)}`);
        console.log(`  Avg visible strokes: ${spatialResults.avgVisible} / ${strokeCount}`);
        console.log(`  Improvement: ${((baselineResults.avg - spatialResults.avg) / baselineResults.avg * 100).toFixed(1)}%`);

        // Test 4: Full optimizations (tiles + batching + LOD + spatial)
        console.log('\n📊 TEST 4: Full SOTA optimizations');
        this.tiledRenderingEnabled = true;
        this.batchingEnabled = true;

        const fullResults = await this._benchmarkFullOptimized(app, 60, viewport);
        console.log(`  Avg frame time: ${fullResults.avg.toFixed(2)}ms`);
        console.log(`  FPS: ${fullResults.fps.toFixed(1)}`);
        console.log(`  Improvement: ${((baselineResults.avg - fullResults.avg) / baselineResults.avg * 100).toFixed(1)}%`);

        // Restore
        img.history = originalHistory;
        app.invalidateCache();
        app.render();
        this.invalidateAll();

        // Re-enable optimizations
        this.lodEnabled = true;
        this.tiledRenderingEnabled = true;
        this.batchingEnabled = true;

        console.log(`\n✅ Benchmark complete. Original state restored.`);
        console.log(`\n📈 SUMMARY:`);
        console.log(`  Baseline:        ${baselineResults.fps.toFixed(1)} FPS`);
        console.log(`  + LOD:           ${lodResults.fps.toFixed(1)} FPS (${((lodResults.fps - baselineResults.fps) / baselineResults.fps * 100).toFixed(1)}% faster)`);
        console.log(`  + Spatial:       ${spatialResults.fps.toFixed(1)} FPS (${((spatialResults.fps - baselineResults.fps) / baselineResults.fps * 100).toFixed(1)}% faster)`);
        console.log(`  + Full SOTA:     ${fullResults.fps.toFixed(1)} FPS (${((fullResults.fps - baselineResults.fps) / baselineResults.fps * 100).toFixed(1)}% faster)`);

        return {
            baseline: baselineResults,
            lod: lodResults,
            spatial: spatialResults,
            fullSota: fullResults
        };
    }

    async _benchmarkRender(app, frames) {
        const times = [];
        for (let i = 0; i < frames; i++) {
            app.state.pan.x += 0.001;
            app.cache.hiResCache = null;
            const start = performance.now();
            app.render();
            times.push(performance.now() - start);
            await new Promise(r => setTimeout(r, 0));
        }
        app.state.pan.x -= frames * 0.001;
        const avg = times.reduce((a, b) => a + b, 0) / times.length;
        return { avg, fps: 1000 / avg, times };
    }

    async _benchmarkSpatialRender(app, frames, viewport) {
        const times = [];
        const visibleCounts = [];
        const strokes = app.state.images[app.state.idx].history.filter(s => !s.deleted);

        for (let i = 0; i < frames; i++) {
            const start = performance.now();
            const visible = this.queryVisible(viewport, app.state.zoom, app.state.pan);
            visibleCounts.push(visible.length);

            // Simulate rendering visible strokes only
            for (const stroke of visible) {
                if (stroke.tool === 'pen' && stroke.pts) {
                    this.getSimplifiedPoints(stroke, app.state.zoom);
                }
            }

            app.render();
            times.push(performance.now() - start);
            await new Promise(r => setTimeout(r, 0));
        }

        const avg = times.reduce((a, b) => a + b, 0) / times.length;
        const avgVisible = visibleCounts.reduce((a, b) => a + b, 0) / visibleCounts.length;
        return { avg, fps: 1000 / avg, avgVisible: Math.round(avgVisible), times };
    }

    async _benchmarkFullOptimized(app, frames, viewport) {
        const times = [];
        const canvas = app.getElement('canvas');
        const ctx = canvas.getContext('2d');
        const strokes = app.state.images[app.state.idx].history.filter(s => !s.deleted);

        for (let i = 0; i < frames; i++) {
            const start = performance.now();
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            this.renderOptimized(ctx, strokes, viewport, app.state.zoom, app.state.pan, app.renderObject.bind(app));
            times.push(performance.now() - start);
            await new Promise(r => setTimeout(r, 0));
        }

        const avg = times.reduce((a, b) => a + b, 0) / times.length;
        return { avg, fps: 1000 / avg, times };
    }
}

// Export classes for external use
export { QuadTreeNode, StrokeSimplifier, TileRenderer, DirtyRegionTracker, StrokeBatcher, PerformanceStats };
