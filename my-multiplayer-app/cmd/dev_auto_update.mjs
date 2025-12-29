
import { spawn } from 'child_process';
import { execSync } from 'child_process';
import fs from 'fs';

const CHECK_INTERVAL = 60000; // Check every 60 seconds
let devProcess = null;

function log(msg) {
    console.log(`[Auto-Update Dev] ${new Date().toLocaleTimeString()} - ${msg}`);
}

function startDevServer() {
    if (devProcess) {
        log("Stopping current dev server...");
        devProcess.kill();
    }

    log("Starting dev server (npm run dev)...");
    devProcess = spawn('npm', ['run', 'dev'], { 
        stdio: 'inherit',
        shell: true 
    });

    devProcess.on('close', (code) => {
        if (code !== 0 && code !== null) {
            log(`Dev server exited with code ${code}. Restarting in 5s...`);
            setTimeout(startDevServer, 5000);
        }
    });
}

async function checkUpdates() {
    try {
        log("Checking for git updates...");
        execSync('git remote update');
        const status = execSync('git status -uno').toString();

        if (status.includes('Your branch is behind')) {
            log("🚀 New updates detected! Pulling changes...");
            
            // Get current package.json hash to see if we need npm install
            const pkgHashBefore = fs.readFileSync('package.json', 'utf8');
            
            execSync('git pull');
            log("✅ Pull successful.");

            const pkgHashAfter = fs.readFileSync('package.json', 'utf8');
            if (pkgHashBefore !== pkgHashAfter) {
                log("📦 package.json changed. Running npm install...");
                execSync('npm install', { stdio: 'inherit' });
            }

            log("🔄 Restarting dev server to apply changes...");
            startDevServer();
        } else {
            log("🟢 Up to date.");
        }
    } catch (err) {
        log(`❌ Error during update check: ${err.message}`);
    }
}

// 1. Initial Start
startDevServer();

// 2. Set up polling loop
setInterval(checkUpdates, CHECK_INTERVAL);

log("Self-updating dev server is active.");
log("It will poll git every 60s and restart on changes.");
