FROM node:24.18-alpine3.24

RUN apk add --no-cache python3 make g++ pixman-dev cairo-dev pango-dev jpeg-dev giflib-dev openssl

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install

COPY . .

EXPOSE 80

CMD ["npm", "start"]
