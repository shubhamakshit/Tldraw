#!/usr/bin/env bash

# --- CONFIGURATION ---
WORKFLOW_ID="221629785" # ID for 'Build Android (Bundled HuggingFace)'
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
# Check/Create counter file
if [ ! -f "$COUNTER_FILE" ]; then echo 0 > "$COUNTER_FILE"; fi
# Read, Increment, Save
CURRENT_COUNT=$(cat "$COUNTER_FILE")
NEXT_COUNT=$((CURRENT_COUNT + 1))
echo "$NEXT_COUNT" > "$COUNTER_FILE"

COMMIT_MSG="test-dev-$NEXT_COUNT"
echo "📦 Committing to Git with message: '$COMMIT_MSG'..."

git add .
git commit -m "$COMMIT_MSG"
git push

# 3. TRIGGER GITHUB ACTION
echo "🎬 Triggering GitHub Action (ID: $WORKFLOW_ID)..."
gh workflow run "$WORKFLOW_ID"

# Give GitHub a moment to register the run
echo "⏳ Waiting for run to start..."
sleep 5

# Get the ID of the run we just triggered (the most recent one)
RUN_ID=$(gh run list --workflow "$WORKFLOW_ID" --limit 1 --json databaseId -q '.[0].databaseId')
echo "👀 Watching Run ID: $RUN_ID"

# Watch the run until it finishes. If it fails, exit script.
gh run watch "$RUN_ID" --exit-status
if [ $? -ne 0 ]; then
    echo "❌ Build Failed on GitHub! Check logs."
    exit 1
fi

# 4. DOWNLOAD AND MOVE ARTIFACT
echo "📥 Downloading artifact..."
# Create target directory if it doesn't exist
mkdir -p "$TARGET_DIR"

# Download to a temporary folder
mkdir -p temp_artifact
gh run download "$RUN_ID" -n "$ARTIFACT_NAME" --dir temp_artifact

# Unzip and Move
# GitHub wraps artifacts in a zip. We unzip it and move the .apk file.
echo "📂 Extracting and moving to Android storage..."
unzip -o temp_artifact/*.zip -d temp_artifact/
find temp_artifact -name "*.apk" -exec mv {} "$TARGET_DIR/" \;

# Cleanup
rm -rf temp_artifact

echo "✅ DONE! APK saved to: $TARGET_DIR"
