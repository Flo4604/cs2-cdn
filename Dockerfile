# Use a lightweight Bun base image
FROM oven/bun:canary-alpine

# Install git and depotdownloader dependency
RUN apk add --no-cache git gcompat icu-libs

# Set working directory
WORKDIR /app

# Clone the repository
RUN git clone https://github.com/Flo4604/cs2-cdn.git .

# Install dependencies using Bun
RUN bun install

# Specify the default command to generate files
CMD ["bun", "run", "src/index.ts"]
