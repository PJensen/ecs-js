#!/usr/bin/env bash
set -euo pipefail

# Local mirror of the CI release bundle, using esbuild binary directly (no Node install).
ESBUILD_VERSION="${ESBUILD_VERSION:-0.27.0}"
VERSION="${1:-0.0.0-local}"

SCRIPT_DIR="$(cd -- "$(dirname "$0")" && pwd)"
REPO_ROOT="${SCRIPT_DIR}"  # script now lives at repo root
OUTDIR="${OUTDIR:-${REPO_ROOT}/dist}"
OUTFILE="${OUTDIR}/ecs-${VERSION}-min.js"

tmpdir="$(mktemp -d)"
cleanup() { rm -rf "$tmpdir"; }
trap cleanup EXIT

OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"
case "${ARCH}" in
  x86_64|amd64) ARCH_LABEL="x64" ;;
  arm64|aarch64) ARCH_LABEL="arm64" ;;
  *) echo "Unsupported architecture: ${ARCH}" >&2; exit 1 ;;
esac
PKG_NAME="@esbuild/${OS}-${ARCH_LABEL}"
PKG_FILE="${OS}-${ARCH_LABEL}-${ESBUILD_VERSION}.tgz"

echo ">> fetching esbuild ${ESBUILD_VERSION}"
curl -fsSL "https://registry.npmjs.org/${PKG_NAME}/-/${PKG_FILE}" \
  -o "$tmpdir/esbuild.tgz"

tar -xzf "$tmpdir/esbuild.tgz" -C "$tmpdir"
cp "$tmpdir/package/bin/esbuild" "$tmpdir/esbuild"
chmod +x "$tmpdir/esbuild"

echo ">> bundling to ${OUTFILE}"
mkdir -p "$OUTDIR"
"$tmpdir/esbuild" "${REPO_ROOT}/index.js" \
  --bundle \
  --platform=browser \
  --format=iife \
  --global-name=ECS \
  --minify \
  --legal-comments=none \
  --target=es2018 \
  --banner:js="/*! ecs-js v${VERSION} */" \
  --outfile="$OUTFILE"

echo ">> done:"
ls -lh "$OUTFILE"
