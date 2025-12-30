import { useEditor } from 'tldraw'
import { useSPen } from '../hooks/useSPen'

export function SPenController() {
    const editor = useEditor()
    useSPen(editor)
    return null
}
