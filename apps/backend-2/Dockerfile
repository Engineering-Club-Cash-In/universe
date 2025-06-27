FROM oven/bun:1.2.16 AS base

WORKDIR /usr/src/app

FROM base AS install 

RUN mkdir -p /temp/prod
COPY bun.lock package.json /temp/prod/
COPY . /temp/prod/
RUN cd /temp/prod && bun install

FROM base AS builder
COPY --from=install /temp/prod/node_modules node_modules
COPY . .
RUN bun build \
    --compile \
    --minify-whitespace \
    --minify-syntax \
    --target bun \
    --outfile server \
    apps/backend-2/src/index.ts

FROM base AS runner
COPY --from=builder /usr/src/app/server .

EXPOSE 9000

ENTRYPOINT ["./server"]