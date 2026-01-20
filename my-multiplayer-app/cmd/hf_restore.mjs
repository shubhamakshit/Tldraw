import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const REPO_ID = 'Jaimodiji/colorrm-test-storage';
const TOKEN = process.env.HF_TOKEN;
const LOCAL_STATE_DIR = '.wrangler/state/v3';

async function restore() {
    console.log(`[${new Date().toISOString()}] Checking for existing backup on HF Dataset...`);
    
    if (!TOKEN) {
        console.error('HF_TOKEN environment variable is not set. Skipping restore.');
        return;
    }

    try {
        const tempRestoreDir = '.wrangler_restore_temp';
        
        if (!fs.existsSync('.wrangler/state')) {
            fs.mkdirSync('.wrangler/state', { recursive: true });
        }

        const command = `hf download ${REPO_ID} --include ".wrangler_backup/*" --local-dir ${tempRestoreDir} --repo-type dataset --token ${TOKEN} --quiet`;
        
        console.log(`[${new Date().toISOString()}] Executing download command...`);
        
        let success = false;
        for (let i = 1; i <= 3; i++) {
            try {
                execSync(command, { stdio: 'inherit' });
                success = true;
                break;
            } catch (e) {
                console.warn(`[${new Date().toISOString()}] Download attempt ${i} failed: ${e.message}`);
                if (i < 3) {
                    console.log(`[${new Date().toISOString()}] Retrying in 5 seconds...`);
                    // Synchronous sleep
                    const start = Date.now();
                    while (Date.now() - start < 5000) {} 
                } else {
                    console.error(`[${new Date().toISOString()}] All download attempts failed.`);
                    throw e;
                }
            }
        }

        const actualRestoredDir = path.join(tempRestoreDir, '.wrangler_backup');

        if (fs.existsSync(actualRestoredDir)) {
            console.log(`[${new Date().toISOString()}] Backup found. Restoring to ${LOCAL_STATE_DIR}...`);
            
            if (fs.existsSync(LOCAL_STATE_DIR)) {
                const timestamp = Date.now();
                fs.renameSync(LOCAL_STATE_DIR, `${LOCAL_STATE_DIR}_old_${timestamp}`);
            }

            fs.renameSync(actualRestoredDir, LOCAL_STATE_DIR);
            try { fs.rmSync(tempRestoreDir, { recursive: true, force: true }); } catch(e) {}
            console.log(`[${new Date().toISOString()}] Restore complete!`);
        } else {
            console.log(`[${new Date().toISOString()}] No backup found in dataset. Starting fresh.`);
        }
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Restore failed (possibly no backup exists):`, error.message);
    }
}

restore();