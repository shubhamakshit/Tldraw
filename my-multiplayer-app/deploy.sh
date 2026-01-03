#!/bin/bash
set -e # Exit on error

echo "🚀 Starting deployment process..."

# 1. Build the project
echo "📦 Building project..."
npm run build

# 2. Deploy to Cloudflare
echo "☁️ Deploying to Cloudflare..."
npx wrangler deploy

# 3. Upload to Hugging Face
echo "🤗 Uploading to Hugging Face..."
/home/u0_a369/.local/bin/hf upload Jaimodiji/my-multiplayer-app . . \
  --repo-type space \
  --exclude "node_modules/*" \
  --exclude "dist/*" \
  --exclude ".wrangler/*" \
  --exclude ".git/*" \
  --exclude ".env" \
  --exclude ".dev.vars" \
  --exclude "temp/*" \
  --exclude "restored_files/*" \
  --exclude "*.sqlite" \
  --exclude "*.log"

echo "✅ Deployment completed successfully!"
