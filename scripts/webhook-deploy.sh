#!/bin/sh
set -eu

REPO_DIR="${WEBHOOK_REPO_DIR:-/workspace}"
COMPOSE_FILE="${WEBHOOK_COMPOSE_FILE:-$REPO_DIR/docker-compose.yml}"
DEPLOY_BRANCH="${WEBHOOK_DEPLOY_BRANCH:-main}"

echo "Iniciando deploy do branch ${DEPLOY_BRANCH}"

if [ ! -d "${REPO_DIR}/.git" ]; then
  echo "Repositorio git nao encontrado em ${REPO_DIR}"
  exit 1
fi

cd "${REPO_DIR}"

git fetch origin "${DEPLOY_BRANCH}"
git checkout "${DEPLOY_BRANCH}"
git pull --ff-only origin "${DEPLOY_BRANCH}"

docker compose -f "${COMPOSE_FILE}" up -d --build

echo "Deploy concluido com sucesso"
