# Optional: run the same app as a long-lived container (Deplexo, Railway,
# Fly, ...). Not needed for Vercel. Requires DATABASE_URL (Neon Postgres)
# at runtime -- there is no local database file any more.

FROM node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npm run build

FROM node:22-alpine
RUN addgroup -S studylog && adduser -S studylog -G studylog
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY --from=build /src/dist ./dist
COPY views ./views
COPY public ./public
USER studylog
EXPOSE 8080
CMD ["node", "dist/src/server.js"]
