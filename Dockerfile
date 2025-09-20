FROM --platform=$BUILDPLATFORM docker.io/node:20-slim AS build
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
COPY . /app
WORKDIR /app
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm run build

FROM docker.io/node:20-slim AS prod-base
COPY . /app
WORKDIR /app

FROM prod-base AS prod-deps
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --prod --frozen-lockfile

FROM prod-base
ENV CONFIG_PATH="/config/config.toml"
COPY --from=prod-deps /app/node_modules /app/node_modules
COPY --from=build /app/build /app/build
ENTRYPOINT ["node", "/app/build"]