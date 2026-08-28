# Whistle — production image.
#
# Based on the official Playwright image because the scraper drives headless
# Chromium (server/lib/browser-pool.ts, nil-scraper.ts, job-board-scraper.ts).
# That browser and its system libraries are why this app cannot run on a
# serverless host. The tag must stay in step with the "playwright" version in
# package.json — a mismatch makes Playwright refuse to start at runtime.
FROM mcr.microsoft.com/playwright:v1.62.1-noble

ENV NODE_ENV=production
WORKDIR /app

# Install dependencies first so this layer caches across code-only changes.
# devDependencies are needed here because the build runs vite + esbuild.
COPY package*.json ./
RUN npm ci --include=dev

COPY . .
RUN npm run build

# Drop the build-only dependencies from the shipped image.
RUN npm prune --omit=dev

# The Playwright image provides this unprivileged user with a working
# browser sandbox already configured.
USER pwuser

EXPOSE 5001
CMD ["node", "dist/index.js"]
