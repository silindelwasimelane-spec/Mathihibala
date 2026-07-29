FROM node:18-alpine
WORKDIR /app

# Install git for dependencies that require it during npm install
RUN apk add --no-cache git

# Install only production deps
COPY package.json package-lock.json* ./
RUN npm install --production --no-audit --no-fund

# Copy app
COPY . .

EXPOSE 3000
CMD ["npm", "start"]
