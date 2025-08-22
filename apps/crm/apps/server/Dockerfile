FROM node:20-slim

WORKDIR /app

RUN npm install -g bun

COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile

COPY . .

RUN bun run build

EXPOSE 3000

CMD ["bun", "run", "start"]