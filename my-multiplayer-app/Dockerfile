FROM node:20

# Create app directory
WORKDIR /app

# Install dependencies for HF CLI
RUN apt-get update && apt-get install -y curl python3-venv && rm -rf /var/lib/apt/lists/*

# Install HF CLI
RUN curl -LsSf https://hf.co/cli/install.sh | bash
ENV PATH="/root/.local/bin:$PATH"

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy app source
COPY . .

# Set environment variables
ENV PORT=7860
ENV NODE_ENV=development

# Expose port 7860
EXPOSE 7860

# Run init, restore, then start dev server and backup worker concurrently
CMD ["sh", "-c", "node cmd/hf_init.mjs && node cmd/hf_restore.mjs && npx concurrently \"npm run dev\" \"node cmd/hf_backup.mjs\""]
