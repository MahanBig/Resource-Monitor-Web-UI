FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY RicohReader.py .

RUN useradd --system --uid 10001 monitor && mkdir -p /data && chown monitor /data
USER monitor

# Printers.json and (optionally) config.json are mounted into /app at runtime.
ENTRYPOINT ["python", "RicohReader.py"]
CMD ["run"]
