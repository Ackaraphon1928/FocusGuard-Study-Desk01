FROM node:24.22.1-alpine AS frontend-build
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
COPY frontend/scripts/ ./scripts/
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM python:3.11.10-slim
WORKDIR /app
COPY backend/requirements.lock.txt backend/requirements.lock.txt
RUN pip install --no-cache-dir -r backend/requirements.lock.txt
COPY backend backend
COPY --from=frontend-build /web/dist frontend/dist
RUN useradd --uid 10001 --create-home appuser && mkdir -p /app/data && chown appuser:appuser /app/data
USER appuser
ENV PYTHONUNBUFFERED=1
EXPOSE 8000
CMD ["python", "-m", "uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
