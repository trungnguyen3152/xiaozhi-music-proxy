FROM node:20-slim

# ffmpeg for transcoding, python3+pip for yt-dlp (installed as a pip package
# so it tracks upstream fixes for YouTube's frequently-changing extraction),
# curl to install Deno. yt-dlp needs a JS runtime to solve YouTube's
# signature challenges - without one it warns "some formats may be missing"
# and extraction gets less reliable over time as YouTube changes things.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg python3 python3-pip curl unzip \
    && pip3 install --no-cache-dir --break-system-packages yt-dlp \
    && curl -fsSL https://deno.land/install.sh | sh -s -- -y \
    && ln -s /root/.deno/bin/deno /usr/local/bin/deno \
    && apt-get purge -y python3-pip curl unzip \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY server.js ./

ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.js"]
