FROM node:18-alpine
WORKDIR /app

# Install only production deps
COPY package.json package-lock.json* ./
RUN npm install --production --no-audit --no-fund

# Copy app
COPY . .

EXPOSE 3000
CMD ["npm", "start"]
