FROM node:20-slim

WORKDIR /app

# Copy dashboard package files and install dependencies
COPY dashboard/package*.json ./
RUN npm install --omit=dev

# Copy dashboard source code
COPY dashboard/ ./dashboard/

ENV PORT=8080
EXPOSE 8080

WORKDIR /app/dashboard
CMD ["node", "server.js"]
