FROM node:20-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates python3 python3-pip ffmpeg \
 && pip3 install --break-system-packages yt-dlp \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

EXPOSE 4000

CMD ["node", "server.js"]
