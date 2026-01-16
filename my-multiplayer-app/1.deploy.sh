#!/usr/bin/env bash

# --- CONFIGURATION ---
WORKFLOW_ID="221629785" # Build Android (Bundled HuggingFace)
ARTIFACT_NAME="tldraw-bundled-hf-debug.apk"
TARGET_DIR="/storage/emulated/0/Download/MY-T-APP"
COUNTER_FILE=".build_counter"

# 1. RUN HUGGING FACE UPLOAD
echo "🚀 Starting Hugging Face Upload..."
~/.hf-cli/venv/bin/hf upload Jaimodiji/my-multiplayer-app . . \
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

# 2. GIT INCREMENTAL COMMIT
if [ ! -f "$COUNTER_FILE" ]; then echo 0 > "$COUNTER_FILE"; fi
CURRENT_COUNT=$(cat "$COUNTER_FILE")
NEXT_COUNT=$((CURRENT_COUNT + 1))
echo "$NEXT_COUNT" > "$COUNTER_FILE"

COMMIT_MSG="test-dev-$NEXT_COUNT"
echo "📦 Committing to Git with message: '$COMMIT_MSG'..."

git add .
git commit -m "$COMMIT_MSG"
git push

# 3. TRIGGER GITHUB ACTION
echo "🎬 Triggering GitHub Action..."
gh workflow run "$WORKFLOW_ID"
echo "⏳ Waiting for run to start..."
sleep 5
RUN_ID=$(gh run list --workflow "$WORKFLOW_ID" --limit 1 --json databaseId -q '.[0].databaseId')
echo "👀 Watching Run ID: $RUN_ID"

gh run watch "$RUN_ID" --exit-status
if [ $? -ne 0 ]; then
    echo "❌ Build Failed on GitHub! Check logs."
    exit 1
fi

# 4. DOWNLOAD AND MOVE ARTIFACT
echo "📥 Downloading artifact..."
mkdir -p "$TARGET_DIR"
mkdir -p temp_artifact

# gh run download AUTOMATICALLY unzips the file into the directory
gh run download "$RUN_ID" -n "$ARTIFACT_NAME" --dir temp_artifact

echo "📂 Moving APK to Android storage..."
# Find the apk (wherever it is inside the artifact) and move it
FOUND_COUNT=$(find temp_artifact -name "*.apk" -exec mv {} "$TARGET_DIR/" \; -print | wc -l)

# Cleanup
rm -rf temp_artifact

if [ "$FOUND_COUNT" -eq "0" ]; then
    echo "❌ ERROR: No APK file was found in the downloaded artifact."
    exit 1
else
    echo "✅ SUCCESS! $FOUND_COUNT APK(s) moved to: $TARGET_DIR"
fi
