FROM python:3.12-slim
WORKDIR /app
COPY app.py ./
RUN useradd -u 10001 -m rainy && mkdir -p /data && chown rainy:rainy /data
USER rainy
ENV DB_PATH=/data/rainy.sqlite3 PORT=8080
EXPOSE 8080
VOLUME /data
CMD ["python", "-u", "app.py"]
