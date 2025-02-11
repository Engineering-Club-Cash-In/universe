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

FROM base AS prerelease
COPY --from=install /temp/dev/node_modules node_modules
COPY . .

# Test step
# ENV NODE_ENV=TEST
# RUN bun test
RUN cd apps/landing && bun add astro && bun run build

USER bun
ENV PORT=4321
ENV HOST=0.0.0.0
EXPOSE 4321/tcp
ENTRYPOINT ["bun", "run", "apps/landing/dist/server/entry.mjs"]