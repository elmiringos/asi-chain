# Stage 1: build custom k6 binary with ASI-Chain extension (signing via Go crypto)
# Build context: k3s/ root
FROM golang:1.25-alpine AS builder
RUN apk add --no-cache git
RUN go install go.k6.io/xk6/cmd/xk6@latest
WORKDIR /ext
COPY k6-ext/ .
# go mod tidy resolves transitive deps; xk6 links the extension into k6
RUN go mod tidy && xk6 build v0.55.0 --with xk6-asi-chain=.

# Stage 2: minimal runtime image — k6 binary + plain JS scripts (no bundling needed)
FROM alpine:3.19
COPY --from=builder /ext/k6 /usr/bin/k6
COPY k6/src/ /scripts/
ENTRYPOINT ["k6"]
