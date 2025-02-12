FROM oven/bun:1.2.2 AS base

WORKDIR /usr/src/app

FROM base AS install 

RUN mkdir -p /temp/prod
COPY bun.lock package.json /temp/prod/
COPY . /temp/prod/
RUN cd /temp/prod && bun install

FROM base AS runner
COPY --from=install /temp/prod/node_modules node_modules
COPY . .

EXPOSE 9000

ENTRYPOINT ["bun", "run", "apps/backend/index.ts"]