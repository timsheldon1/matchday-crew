# Matchday Crew: API + live overlay in one container.

# 1. Build the React overlay
FROM node:22-slim AS web
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# 2. Runtime: Node server that streams matches, runs the AI crew and serves the overlay
FROM node:22-slim
ENV NODE_ENV=production PORT=4000
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY --from=web /app/web/dist ./web/dist
EXPOSE 4000
USER node
CMD ["node", "src/server.js"]
