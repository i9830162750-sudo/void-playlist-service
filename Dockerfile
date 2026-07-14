FROM node:20-slim

# Install VLC (headless) for YouTube stream resolution
RUN apt-get update \
 && apt-get install -y --no-install-recommends vlc \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

EXPOSE 4000

CMD ["node", "server.js"]
