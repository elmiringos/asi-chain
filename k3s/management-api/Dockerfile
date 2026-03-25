FROM python:3.14-slim

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /app

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY . .

ENV PATH="/app/.venv/bin:$PATH"

RUN python -m grpc_tools.protoc -I proto \
    --python_out=. \
    --grpc_python_out=. \
    proto/CasperMessage.proto \
    proto/ServiceError.proto \
    proto/DeployServiceV1.proto \
    proto/ProposeServiceV1.proto

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
