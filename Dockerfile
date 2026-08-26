FROM node:22-alpine

WORKDIR /app

# Install build dependencies for better-sqlite3 (node-gyp)
RUN apk add --no-cache python3 make g++ redis

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci

# Copy source code
COPY . .

EXPOSE 3000