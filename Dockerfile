FROM node:24-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY src ./src

RUN npm ci --no-audit --no-fund \
  && npm run build

FROM build AS prod-deps
RUN npm prune --omit=dev

FROM mambaorg/micromamba:2.9.0-debian12-slim AS runtime-base

USER root
RUN micromamba install --yes --name base --channel conda-forge \
      nodejs=24 \
      wgrib2=3.8.0 \
      bzip2=1.0.8 \
  && micromamba clean --all --yes

ENV PATH=/opt/conda/bin:${PATH}
WORKDIR /app

FROM runtime-base AS live-test
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY tsconfig.json tsconfig.scripts.json ./
COPY src ./src
COPY scripts ./scripts
USER $MAMBA_USER
CMD ["npm", "run", "test:live:all"]

FROM runtime-base AS runtime
COPY --from=prod-deps /app/package.json ./package.json
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY docker-entrypoint.sh /usr/local/bin/wfg-entrypoint
RUN chmod +x /usr/local/bin/wfg-entrypoint

EXPOSE 3000
USER $MAMBA_USER
ENTRYPOINT ["wfg-entrypoint"]
CMD ["--help"]
