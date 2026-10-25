FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY prisma ./prisma
RUN npm ci
COPY apps/web apps/web
COPY packages/shared packages/shared
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ARG NEXT_PUBLIC_SIGNAL_URL=http://localhost:4000
ARG NEXT_PUBLIC_STUN_URL=stun:stun.l.google.com:19302
ARG NEXT_PUBLIC_TURN_URL=
ARG NEXT_PUBLIC_TURN_USERNAME=
ARG NEXT_PUBLIC_TURN_CREDENTIAL=
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_SIGNAL_URL=$NEXT_PUBLIC_SIGNAL_URL
ENV NEXT_PUBLIC_STUN_URL=$NEXT_PUBLIC_STUN_URL
ENV NEXT_PUBLIC_TURN_URL=$NEXT_PUBLIC_TURN_URL
ENV NEXT_PUBLIC_TURN_USERNAME=$NEXT_PUBLIC_TURN_USERNAME
ENV NEXT_PUBLIC_TURN_CREDENTIAL=$NEXT_PUBLIC_TURN_CREDENTIAL
RUN npm run build -w @holoconnect/web
EXPOSE 3000
CMD ["npm", "run", "start", "-w", "@holoconnect/web"]
