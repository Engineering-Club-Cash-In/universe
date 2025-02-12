FROM oven/bun:1.2.2 
WORKDIR /app

COPY package.json bun.lock ./

RUN bun install

COPY . .

RUN cd apps/landing && bun install && bun run build

ENV HOST=0.0.0.0
ENV PORT=4321
EXPOSE 4321

CMD bun run apps/landing/dist/server/entry.mjs

