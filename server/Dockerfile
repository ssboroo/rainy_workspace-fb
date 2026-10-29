FROM python:3.12-slim
WORKDIR /app
COPY app.py ./
RUN mkdir -p /data
ENV DB_PATH=/data/rainy.sqlite3 PORT=8080
EXPOSE 8080
CMD ["python", "-u", "app.py"]
