# syntax=docker/dockerfile:1

# ---- build -----------------------------------------------------------------
FROM rust:1-slim-bookworm AS build
WORKDIR /src

# The workspace manifest, the server crate and the fixtures it embeds at
# compile time. `rust-toolchain.toml` is deliberately left out: the image
# already is the toolchain.
COPY Cargo.toml Cargo.lock ./
COPY apps/server apps/server
COPY fixtures fixtures

RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/target \
    cargo build --release --locked -p aegis-server --bin aegis-server \
 && cp target/release/aegis-server /aegis-server

# ---- runtime ---------------------------------------------------------------
# Distroless: no shell, no package manager, runs as an unprivileged user.
FROM gcr.io/distroless/cc-debian12:nonroot
COPY --from=build /aegis-server /aegis-server

ENV AEGIS_BIND=0.0.0.0:8787 \
    AEGIS_LOG=info
EXPOSE 8787
USER nonroot:nonroot
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 \
  CMD ["/aegis-server", "healthcheck"]
ENTRYPOINT ["/aegis-server"]
