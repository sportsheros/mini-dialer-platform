# ---- build the static dashboard ----
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Vite inlines VITE_* at build time; the API is reached same-origin through nginx below.
ARG VITE_API_KEY
ENV VITE_API_KEY=$VITE_API_KEY VITE_API_BASE_URL=
RUN npm run build

# ---- serve it with nginx, proxying /api and /socket.io to the api container ----
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
