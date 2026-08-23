FROM node:24-bookworm-slim AS build

WORKDIR /app
COPY package.json tsconfig.json ./
COPY src ./src

RUN npm install --no-audit --no-fund \
  && npm run build \
  && npm prune --omit=dev

FROM mambaorg/micromamba:2.9.0-debian12-slim AS runtime

USER root
RUN micromamba install --yes --name base --channel conda-forge \
      nodejs=24 \
      wgrib2=3.8.0 \
  && micromamba clean --all --yes

ENV PATH=/opt/conda/bin:${PATH}
WORKDIR /app

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY docker-entrypoint.sh /usr/local/bin/wfg-entrypoint
RUN chmod +x /usr/local/bin/wfg-entrypoint

EXPOSE 3000
USER $MAMBA_USER
ENTRYPOINT ["wfg-entrypoint"]
CMD ["--help"]
