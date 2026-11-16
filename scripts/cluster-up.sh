#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

CLUSTER=rd-course
IMAGES=(rd-course-api:prod postgres:17 redis:7-alpine)

if kind get clusters 2>/dev/null | grep -qx "$CLUSTER"; then
  echo "cluster $CLUSTER already up"
else
  kind create cluster --config k8s/kind-config.yaml
fi

kubectl --context "kind-$CLUSTER" wait --for=condition=Ready node --all --timeout=180s

case "$(docker info --format '{{.Architecture}}')" in
  aarch64|arm64) PLATFORM=linux/arm64 ;;
  *) PLATFORM=linux/amd64 ;;
esac

ARCHIVE_DIR="$(mktemp -d)"
trap 'rm -rf "$ARCHIVE_DIR"' EXIT

for image in "${IMAGES[@]}"; do
  docker image inspect "$image" >/dev/null 2>&1 || docker pull --platform "$PLATFORM" "$image"
  echo "loading $image ($PLATFORM) into kind-$CLUSTER"
  docker save --platform "$PLATFORM" "$image" -o "$ARCHIVE_DIR/image.tar"
  kind load image-archive "$ARCHIVE_DIR/image.tar" --name "$CLUSTER"
done

kubectl --context "kind-$CLUSTER" get nodes
