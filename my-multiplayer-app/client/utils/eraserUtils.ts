export const getEraserSettings = () => {
    const saved = localStorage.getItem('tldraw_eraser_settings')
    return saved ? JSON.parse(saved) : {
        scribble: true,
        text: true,
        shapes: true,
        images: true
    }
}
