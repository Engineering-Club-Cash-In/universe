FROM oven/bun:1.2.2 AS base

WORKDIR /usr/src/app

FROM base AS install 
RUN mkdir -p /temp/dev 
COPY bun.lock package.json /temp/dev/
RUN cd /temp/dev && bun install

RUN mkdir -p /temp/prod
COPY bun.lock package.json /temp/prod/
COPY package.json /temp/prod/
RUN cd /temp/prod && bun install

FROM base AS runner
COPY --from=install /temp/dev/node_modules node_modules
COPY . .

ENTRYPOINT ["bun", "run", "apps/backend/index.ts"]