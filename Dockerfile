FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build
RUN npx playwright install --with-deps chromium

ENV NODE_ENV=production
EXPOSE 43123

CMD ["npm", "start"]
