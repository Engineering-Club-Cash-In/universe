FROM oven/bun:1.3.1-slim

WORKDIR /app

# Cache packages installation
COPY package.json ./

RUN bun install --production

# Copy templates first (explicitly to ensure they're included)
COPY templates ./templates

# Copy source code
COPY . .

ENV NODE_ENV=production

EXPOSE 4000

CMD ["bun", "run", "index.ts"]
