# NetFlow PaddleOCR service

This container builds the official PaddlePaddle/PaddleOCR source pinned by the
`server/vendor/PaddleOCR` Git submodule. It runs the official PaddleX Basic
Serving API with the default PP-OCRv6 medium pipeline on CPU.

## Start locally

From `server/`:

```powershell
git submodule update --init --recursive
docker compose -f docker-compose.ocr.yml up --build -d
docker compose -f docker-compose.ocr.yml ps
```

The host endpoint is `http://127.0.0.1:8080/ocr`. Docker binds it to loopback,
so it is not exposed to the LAN. The official Basic Serving endpoint does not
use a bearer token. Model files are downloaded on first startup and retained in
the named `paddleocr-models` volume.

NetFlow sends only MuPDF-rendered pages that require OCR. Each page is sent as
Base64 PNG JSON with visualization and orientation/unwarping helpers disabled.
The Node adapter converts the official `prunedResult` fields into NetFlow's
existing text-line and bounding-box format.

Useful commands:

```powershell
docker compose -f docker-compose.ocr.yml logs -f paddleocr
docker compose -f docker-compose.ocr.yml restart paddleocr
docker compose -f docker-compose.ocr.yml down
```

Do not add `-v` to `down` unless you intentionally want to remove the cached
official model files.
