#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${HOME}/.openclaw/conductor"
WORKTREE_DIR="${HOME}/agent-worktrees"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

mkdir -p "${ROOT_DIR}" "${WORKTREE_DIR}" "${ROOT_DIR}/completed" "${ROOT_DIR}/logs"

if [[ ! -f "${ROOT_DIR}/companies.json" ]]; then
  cp "${SCRIPT_DIR}/../config/companies.json" "${ROOT_DIR}/companies.json"
  echo "Created ${ROOT_DIR}/companies.json"
else
  echo "Keeping existing ${ROOT_DIR}/companies.json"
fi

if [[ ! -f "${ROOT_DIR}/active-tasks.json" ]]; then
  printf '{\n  "tasks": []\n}\n' > "${ROOT_DIR}/active-tasks.json"
  echo "Created ${ROOT_DIR}/active-tasks.json"
fi

if [[ ! -f "${ROOT_DIR}/experiments.json" ]]; then
  cp "${SCRIPT_DIR}/../config/experiments.json" "${ROOT_DIR}/experiments.json"
  echo "Created ${ROOT_DIR}/experiments.json"
else
  echo "Keeping existing ${ROOT_DIR}/experiments.json"
fi

if [[ ! -f "${ROOT_DIR}/gtm-snapshot.json" ]]; then
  cp "${SCRIPT_DIR}/../config/gtm-snapshot.json" "${ROOT_DIR}/gtm-snapshot.json"
  echo "Created ${ROOT_DIR}/gtm-snapshot.json"
else
  echo "Keeping existing ${ROOT_DIR}/gtm-snapshot.json"
fi

for bin in gh git tmux claude; do
  if ! command -v "${bin}" >/dev/null 2>&1; then
    echo "Missing required binary: ${bin}" >&2
    exit 1
  fi
done

echo "Conductor setup complete"
