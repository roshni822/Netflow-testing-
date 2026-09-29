FROM python:3.12-slim-bookworm

ARG PADDLEPADDLE_VERSION=3.2.0

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    SETUPTOOLS_SCM_PRETEND_VERSION_FOR_PADDLEOCR=3.7.0

RUN apt-get update \
    && apt-get install --no-install-recommends -y \
        curl \
        libgl1 \
        libglib2.0-0 \
        libgomp1 \
        libsm6 \
        libxext6 \
        libxrender1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/paddleocr
COPY . .

RUN python -m pip install --no-cache-dir --upgrade pip \
    && python -m pip install --no-cache-dir \
        paddlepaddle==${PADDLEPADDLE_VERSION} \
        --index-url https://www.paddlepaddle.org.cn/packages/stable/cpu/ \
    && python -m pip install --no-cache-dir . \
    && paddlex --install serving

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --start-period=5m --retries=5 \
  CMD curl --fail --silent http://127.0.0.1:8080/docs > /dev/null || exit 1

CMD ["paddlex", "--serve", "--pipeline", "OCR", "--device", "cpu", "--host", "0.0.0.0", "--port", "8080"]
