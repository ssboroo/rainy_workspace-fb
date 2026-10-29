FROM nginx:1.28-alpine
COPY index.html style.css app.js icon.svg /usr/share/nginx/html/
COPY guides/ /usr/share/nginx/html/guides/
COPY downloads/ /usr/share/nginx/html/downloads/
EXPOSE 80
