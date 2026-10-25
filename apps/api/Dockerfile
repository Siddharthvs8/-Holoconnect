FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY prisma ./prisma
RUN npm ci
COPY apps/api apps/api
COPY packages/shared packages/shared
RUN npm run db:generate && npm run build -w @holoconnect/api
ENV API_PORT=4000
EXPOSE 4000
CMD ["sh", "-c", "npm run db:deploy && npm run start -w @holoconnect/api"]
