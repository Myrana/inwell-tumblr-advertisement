FROM node:22-bookworm-slim AS web-build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY index.html tsconfig.json tsconfig.node.json vite.config.ts ./
COPY src ./src
RUN npm run build

FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOST=0.0.0.0 \
    PORT=8021

WORKDIR /app

RUN addgroup --system inwell \
    && adduser --system --ingroup inwell --home /app inwell \
    && chown -R inwell:inwell /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

RUN apt-get update \
    && apt-get install -y --no-install-recommends nodejs npm \
    && rm -rf /var/lib/apt/lists/*

COPY --from=web-build /app/dist ./dist
COPY --from=web-build /app/node_modules ./node_modules
COPY backend ./backend
COPY scripts ./scripts
COPY package.json package-lock.json ./

RUN chown -R inwell:inwell /app

USER inwell

EXPOSE 8021

CMD ["python", "backend/app.py"]
