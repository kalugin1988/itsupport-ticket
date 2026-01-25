FROM node:20-alpine
WORKDIR /app
RUN apk add git
RUN git clone https://github.com/kalugin1988/itsupport-ticket .
RUN npm i
COPY .env .
EXPOSE 3000
CMD ["npm", "start"]
