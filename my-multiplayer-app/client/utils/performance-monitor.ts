export class PerformanceMonitor {
    private metrics = {
        touchLatency: [] as number[],
        toolSwitchLatency: [] as number[],
        frameDrops: 0,
        totalFrames: 0,
        lastFrameTime: performance.now()
    }

    private static instance: PerformanceMonitor

    static getInstance(): PerformanceMonitor {
        if (!PerformanceMonitor.instance) {
            PerformanceMonitor.instance = new PerformanceMonitor()
        }
        return PerformanceMonitor.instance
    }

    trackTouchEvent(startTime: number) {
        const latency = performance.now() - startTime
        this.metrics.touchLatency.push(latency)

        if (latency > 10) {
            console.warn(`❌ Slow touch event: ${latency.toFixed(2)}ms`)
        }
    }

    trackFrame() {
        const now = performance.now()
        const frameDuration = now - this.metrics.lastFrameTime
        this.metrics.totalFrames++

        // 60fps = 16.67ms, anything > 20ms is a drop
        if (frameDuration > 20) {
            this.metrics.frameDrops++
            if (frameDuration > 34) { // > 2 frames dropped
                 console.warn(`❌ Frame drop: ${frameDuration.toFixed(2)}ms`)
            }
        }

        this.metrics.lastFrameTime = now
    }

    report() {
        const avgTouch = this.metrics.touchLatency.length > 0
            ? this.metrics.touchLatency.reduce((a, b) => a + b, 0) / this.metrics.touchLatency.length
            : 0

        const dropRate = this.metrics.totalFrames > 0
            ? (this.metrics.frameDrops / this.metrics.totalFrames) * 100
            : 0

        console.log(`📊 Performance Report:
            Avg Touch Latency: ${avgTouch.toFixed(2)}ms
            Frame Drop Rate: ${dropRate.toFixed(2)}%
            Total Frames: ${this.metrics.totalFrames}
        `)

        // Reset
        this.metrics.touchLatency = []
        this.metrics.frameDrops = 0
        this.metrics.totalFrames = 0
        this.metrics.lastFrameTime = performance.now()
    }

    startMonitoring() {
        const loop = () => {
            this.trackFrame()
            requestAnimationFrame(loop)
        }
        requestAnimationFrame(loop)

        // Report every 10 seconds
        setInterval(() => this.report(), 10000)
    }
}

export const perfMonitor = PerformanceMonitor.getInstance()
