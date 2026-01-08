import fs from 'fs';
import path from 'path';

const CAPACITOR_ENV = process.env.CAPACITOR_SERVER_IP_ENV || '';
console.log(`[Post-Build] CAPACITOR_SERVER_IP_ENV: ${CAPACITOR_ENV}`);

const DIST_CONFIG_PATH = path.join(process.cwd(), 'dist/client/scripts/config.js');

if (fs.existsSync(DIST_CONFIG_PATH)) {
    let content = fs.readFileSync(DIST_CONFIG_PATH, 'utf-8');

    // We are looking for "const defaultBackend = 'cloudflare'; // REPLACED_BY_BUILD_SCRIPT"
    // Or we can just search for "const defaultBackend = 'cloudflare'" inside isBundledMode

    let backend = 'cloudflare';
    if (CAPACITOR_ENV === 'bundled-hf') {
        backend = 'hf';
    }

    console.log(`[Post-Build] Setting default backend to: ${backend}`);

    // Check if we can find the marker
    if (content.includes('REPLACED_BY_BUILD_SCRIPT')) {
        content = content.replace(
            "const defaultBackend = 'cloudflare'; // REPLACED_BY_BUILD_SCRIPT",
            `const defaultBackend = '${backend}'; // REPLACED_BY_BUILD_SCRIPT`
        );
        fs.writeFileSync(DIST_CONFIG_PATH, content, 'utf-8');
        console.log(`[Post-Build] Updated ${DIST_CONFIG_PATH}`);
    } else {
        console.warn(`[Post-Build] Marker not found in ${DIST_CONFIG_PATH}. Skipping update.`);
    }
} else {
    console.error(`[Post-Build] File not found: ${DIST_CONFIG_PATH}`);
}
