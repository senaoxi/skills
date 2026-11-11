#!/usr/bin/env bash

set -euo pipefail

NODE_USE_ENV_PROXY="${NODE_USE_ENV_PROXY:-1}" exec node "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/scripts/sync.mjs" "$@"
