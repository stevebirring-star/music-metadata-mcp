# Image used by Glama's build/introspection sandbox (and anyone who wants to run
# the stdio server in a container). The server talks to the hosted FreqBlog Music
# API over HTTPS and keeps no local state, so this is deliberately minimal.
FROM node:22-alpine

WORKDIR /app

# Install deps first so the layer caches independently of the server source.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY index.js ./

# index.js exits(1) with no API key, which would fail an introspection-only probe
# before it could answer tools/list. This placeholder lets the server BOOT and
# describe itself; it is not a credential and every real API call with it will
# 401. Pass a genuine key at run time to actually use the tools:
#   docker run -e MUSIC_API_KEY=fb_live_... <image>
# Free key: https://freqblog.com/?utm_source=github&utm_medium=readme#pricing
ENV MUSIC_API_KEY=placeholder-introspection-only

ENTRYPOINT ["node", "index.js"]
