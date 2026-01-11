/// <reference types="vite/client" />

declare global {
    interface Window {
        handleSharedFile?: (uri: string) => void
        handleSharedFiles?: (uris: string[]) => void
        handleSharedUrl?: (url: string) => void
        pendingFileUri?: string | null
        pendingUrl?: string | null
        AndroidNative?: {
            readContentUri: (uri: string) => string
            getFileName: (uri: string) => string | null
            saveBlob: (base64: string, filename: string, mimeType: string) => void
            writeLog: (level: string, message: string) => void
            getLogFilePath: () => string
            getPendingFileUri: () => string | null
            getPendingFileUris: () => string | null
            getPendingSharedText: () => string | null
        }
        Capacitor?: any
        Logger?: any
    }
}

export {}