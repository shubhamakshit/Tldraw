import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const REPO_ID = 'Jaimodiji/colorrm-test-storage';
const TOKEN = process.env.HF_TOKEN;
const BACKUP_INTERVAL = 60 * 1000; // 1 minute
const LOCAL_STATE_DIR = '.wrangler/state/v3';

async function backup() {
    console.log(`[${new Date().toISOString()}] Starting backup to HF Dataset...`);
    
    if (!TOKEN) {
        console.error('HF_TOKEN environment variable is not set. Skipping backup.');
        return;
    }

    if (!fs.existsSync(LOCAL_STATE_DIR)) {
        console.log(`[${new Date().toISOString()}] Local state directory not found yet. Skipping...`);
        return;
    }

    try {
        const command = `hf upload ${REPO_ID} ${LOCAL_STATE_DIR} .wrangler_backup --repo-type dataset --token ${TOKEN} --commit-message "Automated backup ${new Date().toISOString()}" --quiet`;
        
        execSync(command, { stdio: 'inherit' });
        console.log(`[${new Date().toISOString()}] Backup successful.`);
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Backup failed:`, error.message);
    }
}

console.log('HF Backup Worker started.');
setInterval(backup, BACKUP_INTERVAL);
backup();