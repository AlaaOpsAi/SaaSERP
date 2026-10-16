# Single image: API + built web app.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
# LibreOffice turns issued contracts (Word) into PDF; Liberation and Noto fonts cover the
# Arial / Times layouts of Word templates and Arabic text.
RUN apt-get update \
 && apt-get install -y --no-install-recommends libreoffice-writer-nogui fonts-liberation fonts-noto-core fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production WEB_DIST=/app/apps/web/dist PORT=4000 UPLOAD_DIR=/app/uploads
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev -w apps/api
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/migrations apps/api/migrations
COPY --from=build /app/apps/api/templates apps/api/templates
COPY --from=build /app/apps/web/dist apps/web/dist
EXPOSE 4000
# Run migrations, then start the server.
CMD ["sh", "-c", "cd apps/api && node dist/scripts/migrate.js && node dist/src/index.js"]
