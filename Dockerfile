# Multi-stage build: compile TypeScript, then ship only the compiled
# output + production dependencies. See explanation.md for how this is
# used with Deplexo/Railway/Fly.io.

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
# The data directory is where the SQLite file lives by default; a
# platform volume should be mounted here (or DATA_PATH pointed at the
# volume's mount path instead).
RUN mkdir -p /data && chown -R studylog:studylog /app /data
USER studylog

ENV DATA_PATH=/data/studylog.db
EXPOSE 8080

CMD ["node", "dist/server.js"]
