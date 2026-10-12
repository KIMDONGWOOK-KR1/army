FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PYTHONPATH=/app \
    TORCH_HOME=/opt/models UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy \
    PV_DATA_DIR=/data PORT=8080

RUN apt-get update \
 && apt-get install -y --no-install-recommends git libgl1 libglib2.0-0 \
 && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:0.11.23 /uv /usr/local/bin/uv

WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev
COPY pv ./pv

ARG BACKBONE=dinov2_vitb14
ARG MATCHER=aliked
RUN /app/.venv/bin/python -m pv.download_weights --backbone ${BACKBONE} --matcher ${MATCHER} \
 && useradd --create-home --uid 10001 app \
 && chmod -R a+rX /opt/models

USER app
EXPOSE 8080
CMD ["sh", "-c", "exec /app/.venv/bin/uvicorn pv.service:app_from_env --factory --host 0.0.0.0 --port ${PORT}"]
