FROM nginx:1.28-alpine
COPY index.html style.css app.js icon.svg /usr/share/nginx/html/
COPY downloads/ /usr/share/nginx/html/downloads/
EXPOSE 80
