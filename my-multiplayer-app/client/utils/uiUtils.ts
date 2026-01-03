import { showModal } from '../components/Modal'
import { showToast as showToastImpl } from '../components/Toast'

export const showToast = showToastImpl

export const customAlert = async (message: string, title?: string) => {
    await showModal({
        type: 'alert',
        message,
        title,
    })
}

export const customPrompt = async (message: string, defaultValue?: string, title?: string): Promise<string | null> => {
    const result = await showModal({
        type: 'prompt',
        message,
        defaultValue,
        title,
    })
    return result as string | null
}

// Reusing the modal for confirm (simulated as a prompt with buttons, 
// though our Modal logic currently treats 'alert' as OK-only. 
// We might need to enhance Modal for 'confirm' type later if we want a distinct Cancel button for non-prompts.
// For now, let's implement a specific confirm helper if we update Modal, 
// but based on current Modal code, 'alert' type doesn't show Cancel button.
// Let's UPDATE Modal.tsx to support 'confirm' type first.
export const customConfirm = async (message: string, title?: string): Promise<boolean> => {
    const result = await showModal({
        type: 'confirm',
        message,
        title,
    })
    return result as boolean
}
