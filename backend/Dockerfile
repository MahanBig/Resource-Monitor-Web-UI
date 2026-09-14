# ==============================================================================
# Ricoh SNMP Collector - Dockerfile (Industry Standard)
# ==============================================================================
FROM python:3.11-slim

LABEL maintainer="Ricoh SNMP Monitor"
LABEL description="Innsamlingsdaemon for Ricoh-kopimaskiner via SNMP"

WORKDIR /app

# Installer minimale systempakker
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Installer Python-avhengigheter
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Kopier kildekode og standardkonfigurasjoner
COPY main.py RicohReader.py ./
COPY src/ ./src/
COPY config/ ./config/
COPY printers.json* Printers.pkl* config.json* credentials.json* ./

ENV PYTHONPATH=/app/src
ENV PYTHONUNBUFFERED=1

# Standardkommando starter innsamleren
CMD ["python", "main.py"]
