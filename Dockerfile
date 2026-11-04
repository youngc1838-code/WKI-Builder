FROM node:22-alpine

WORKDIR /app
COPY server ./server
COPY dist ./dist

ENV WKI_DATA_DIR=/data
ENV WKI_DIST_DIR=/app/dist
ENV WKI_HOST=0.0.0.0
ENV WKI_PORT=4173

EXPOSE 4173
CMD ["node", "server/index.mjs"]
