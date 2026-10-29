# Be Voiced, as three images from one build: the web app, the worker that transcribes, and a
# one-shot that applies migrations.
#
# App and worker are separate because they fail and scale differently. The web app must stay
# responsive however much work is queued; the worker is allowed to saturate a core for minutes.
# Splitting them is what lets a thousand people upload at once without the site going down.
#
#   docker compose -f docker-compose.prod.yml up -d --scale worker=3
#
# The model is baked into the worker image rather than fetched at boot: downloading it on every
# start multiplies the cost of every short job, and most jobs are short.

ARG WHISPER_MODEL=ggml-base.en.bin

# ---- whisper.cpp -------------------------------------------------------------------------------
FROM debian:bookworm-slim AS whisper

ARG WHISPER_REF=v1.9.5
RUN apt-get update && apt-get install -y --no-install-recommends \
      git build-essential cmake ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
RUN git clone --depth 1 --branch ${WHISPER_REF} https://github.com/ggml-org/whisper.cpp.git .
RUN cmake -B build -DCMAKE_BUILD_TYPE=Release -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_EXAMPLES=ON \
    && cmake --build build --config Release -j "$(nproc)" \
    && find build -name "whisper-cli" -type f -exec cp {} /usr/local/bin/whisper-cli \;

# ---- the model ---------------------------------------------------------------------------------
FROM debian:bookworm-slim AS model

ARG WHISPER_MODEL
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /models
# tinydiarize models live in their own repository; everything else is in whisper.cpp's.
RUN set -eux; \
    case "${WHISPER_MODEL}" in \
      *tdrz*) BASE="https://huggingface.co/akashmjn/tinydiarize-whisper.cpp/resolve/main" ;; \
      *)      BASE="https://huggingface.co/ggerganov/whisper.cpp/resolve/main" ;; \
    esac; \
    curl -fL --retry 3 -o "${WHISPER_MODEL}" "${BASE}/${WHISPER_MODEL}"

# ---- build every half ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS build

WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --no-frozen-lockfile
COPY . .
RUN pnpm build && pnpm build:worker
# Drop dev dependencies; the worker and the migrator run from plain Node and need only what they
# import. Done after the build because the build needs TypeScript and Tailwind.
RUN pnpm prune --prod

# ---- migrations ----------------------------------------------------------------------------------
# A one-shot container, run to completion before the app and workers start. Migrating from inside
# the app image is not possible — `output: "standalone"` contains the server bundle and nothing
# else, so neither the script nor the .sql files are in it.
FROM node:22-bookworm-slim AS migrate

ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules                   ./node_modules
COPY --from=build /app/package.json                   ./package.json
COPY --from=build /app/scripts                        ./scripts
COPY --from=build /app/src/server/db/migrations       ./src/server/db/migrations
CMD ["node", "scripts/migrate.mjs"]

# ---- the web app ---------------------------------------------------------------------------------
FROM node:22-bookworm-slim AS app

ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0

# yt-dlp is what turns a pasted link into media, and it shells out to ffmpeg to mux the streams it
# downloads — most sites hand it audio and video separately, so without ffmpeg those links fail at
# the last step. The app still never transcodes anything itself; that is the worker's job.
RUN apt-get update && apt-get install -y --no-install-recommends \
      yt-dlp ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public

EXPOSE 3000
CMD ["node", "server.js"]

# ---- the worker -----------------------------------------------------------------------------------
FROM node:22-bookworm-slim AS worker

ARG WHISPER_MODEL
ENV NODE_ENV=production \
    WHISPER_MODEL=${WHISPER_MODEL} \
    WHISPER_MODEL_PATH=/app/models/${WHISPER_MODEL}

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=whisper /usr/local/bin/whisper-cli /usr/local/bin/whisper-cli
COPY --from=model   /models/${WHISPER_MODEL}   /app/models/${WHISPER_MODEL}
COPY --from=build   /app/dist                  ./dist
COPY --from=build   /app/node_modules          ./node_modules
COPY --from=build   /app/package.json          ./package.json

# One job at a time per worker: whisper already uses every thread it is given, so two at once on
# the same cores makes both slower rather than the pair faster. Run more workers instead.
ENV WORKER_CONCURRENCY=1
CMD ["node", "dist/server/worker.js"]
