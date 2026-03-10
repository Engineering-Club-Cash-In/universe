FROM node:20-slim

WORKDIR /app

RUN npm install -g bun

# Copy the entire CRM workspace (both web and server)
COPY ../../ ./

# Install deps with copyfile backend to avoid symlink issues with Vite/Rollup
RUN bun install --frozen-lockfile --backend=copyfile

# Build web app
WORKDIR /app/apps/web
RUN bun run build

EXPOSE 3001

CMD ["bun", "run", "serve", "--host", "0.0.0.0", "--port", "3001"]