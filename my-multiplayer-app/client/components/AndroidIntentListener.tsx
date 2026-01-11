import { useEditor } from 'tldraw'
import { useAndroidIntent } from '../hooks/useAndroidIntent'

export function AndroidIntentListener() {
    const editor = useEditor()
    
    // We use the hook to handle the actual file processing (images) on the canvas
    // The Global Handler (in main.tsx) populates the buffer that this hook consumes.
    useAndroidIntent(editor)
    
    return null
}