FROM node:20-slim

WORKDIR /app

RUN npm install -g bun

# Copy the entire monthly-goals workspace (both web and server)
COPY ../../ ./

# Navigate to web directory
WORKDIR /app/apps/web

# Install dependencies
RUN bun install --frozen-lockfile

# Build the application
RUN bun run build

EXPOSE 3001

CMD ["bun", "run", "serve", "--host", "0.0.0.0", "--port", "3001"]
