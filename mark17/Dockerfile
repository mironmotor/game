# Max17 (mark17) HTTP bridge — deploy on Railway / Fly / any VPS.
# Build context must be the repo root:  docker build -f mark17/Dockerfile -t max17-bridge .
FROM python:3.11-slim

WORKDIR /app

# Only the core needs numpy; install first for layer caching.
COPY mark17/requirements.txt mark17/requirements.txt
RUN pip install --no-cache-dir -r mark17/requirements.txt

# Copy the package (the bridge imports mark17.* from the repo root).
COPY mark17/ mark17/

ENV PYTHONUNBUFFERED=1 \
    MAX17_STATE_DIR=/data/state \
    PORT=8000

# Persist Max17 memory/synapses across restarts by mounting a volume at /data.
VOLUME ["/data"]
EXPOSE 8000

CMD ["python", "-m", "mark17.server"]
