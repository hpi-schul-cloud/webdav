FROM node:12

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

ENV PORT=1900

EXPOSE 1900

CMD [ 'npm', 'run', 'start' ]
