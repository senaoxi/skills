#!/usr/bin/env bash

set -euo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
NODE_USE_ENV_PROXY="${NODE_USE_ENV_PROXY:-1}" exec node scripts/cli.mjs "$@"
