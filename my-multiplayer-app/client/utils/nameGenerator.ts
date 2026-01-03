// client/utils/nameGenerator.ts

const ADJECTIVES = [
    'Cosmic', 'Azure', 'Silent', 'Misty', 'Solar', 'Lunar', 'Velvet', 'Golden',
    'Rapid', 'Digital', 'Crystal', 'Neon', 'Hyper', 'Sonic', 'Violet', 'Aqua',
    'Grand', 'Noble', 'Brave', 'Calm', 'Ethereal', 'Infinite', 'Prism', 'Wild'
]

const NOUNS = [
    'Meadow', 'Sky', 'Ocean', 'River', 'Mountain', 'Valley', 'Forest', 'Star',
    'Nebula', 'Canvas', 'Grid', 'Vector', 'Pixel', 'Wave', 'Horizon', 'Orbit',
    'Voyage', 'Haven', 'Oasis', 'Glade', 'Summit', 'Canyon', 'Reef', 'Dune'
]

// Fallback generator
const generateLocalName = (): string => {
    const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]
    const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)]
    return `${adj}-${noun}`
}

export const generateBoardName = async (): Promise<string> => {
    try {
        // Try to fetch from a simple API for variety
        // Using datamuse API which is quite reliable for specific types of words
        // Requesting an adjective commonly associated with 'design' or 'art' might be too specific
        // Let's try a simple random word API that supports type

        // Timeout to ensure we don't block UI
        const controller = new AbortController()
        const id = setTimeout(() => controller.abort(), 800)

        const response = await fetch('https://random-word-api.herokuapp.com/word?number=2&length=5', {
            signal: controller.signal
        })
        clearTimeout(id)

        if (response.ok) {
            const [word1, word2] = await response.json() as string[]
            // Capitalize
            const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
            return `${capitalize(word1)}-${capitalize(word2)}`
        }
    } catch (e) {
        // Ignore errors and use fallback
    }

    return generateLocalName()
}
