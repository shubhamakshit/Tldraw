import { execSync } from 'child_process';

const TOKEN = process.env.HF_TOKEN;

try {
    if (!TOKEN) {
        throw new Error('HF_TOKEN environment variable is not set.');
    }
    console.log('Authenticating with Hugging Face Hub...');
    execSync(`hf auth login --token ${TOKEN} --add-to-git-credential`, { stdio: 'inherit' });
    console.log('Login successful.');
} catch (error) {
    console.error('Login failed, but continuing...', error.message);
}