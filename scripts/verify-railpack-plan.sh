#!/usr/bin/env bash
set -euo pipefail

RAILPACK_VERSION='0.38.0'
RAILPACK_CHECKSUMS_SHA256='69d58f46c00048b1ccddc35151842cfa393d88ad06e5d376e7a2f4bcc8aabb89'
platform_key="$(uname -s):$(uname -m)"

case "$platform_key" in
  Linux:x86_64)
    RAILPACK_ARCHIVE='railpack-v0.38.0-x86_64-unknown-linux-musl.tar.gz'
    RAILPACK_ARCHIVE_SHA256='7c3f0e70ca8bf80bde87e8c30cb0171414c2b6bbd794d6f60a19cc3b71772950'
    ;;
  Linux:aarch64 | Linux:arm64)
    RAILPACK_ARCHIVE='railpack-v0.38.0-arm64-unknown-linux-musl.tar.gz'
    RAILPACK_ARCHIVE_SHA256='d33716e87f0e39314898746c806e26d9edde890ac65156891b2f06c8d07ba8c4'
    ;;
  Darwin:x86_64)
    RAILPACK_ARCHIVE='railpack-v0.38.0-x86_64-apple-darwin.tar.gz'
    RAILPACK_ARCHIVE_SHA256='82609c2224df5cb4ac8ec6f0687480f1448f419ca3c7f81f9b73be645820d3af'
    ;;
  Darwin:arm64 | Darwin:aarch64)
    RAILPACK_ARCHIVE='railpack-v0.38.0-arm64-apple-darwin.tar.gz'
    RAILPACK_ARCHIVE_SHA256='6a66b44942884bfcc6038c559c48083d2bdc79f9e20306fcd5fe0d915fef2877'
    ;;
  *)
    printf 'Unsupported Railpack verifier platform: %s\n' "$platform_key" >&2
    exit 1
    ;;
esac

RAILPACK_ARCHIVE_URL="https://github.com/railwayapp/railpack/releases/download/v${RAILPACK_VERSION}/${RAILPACK_ARCHIVE}"
RAILPACK_CHECKSUMS_URL="https://github.com/railwayapp/railpack/releases/download/v${RAILPACK_VERSION}/checksums.txt"

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
expected_plan="${repo_dir}/src/__tests__/fixtures/railpack-v0.38.0-plan.json"
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/kineticare-railpack-plan.XXXXXX")"
trap 'rm -rf "$tmp_dir"' EXIT

archive_path="${tmp_dir}/${RAILPACK_ARCHIVE}"
checksums_path="${tmp_dir}/checksums.txt"
generated_plan="${tmp_dir}/generated-plan.json"

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d ' ' -f 1
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | cut -d ' ' -f 1
  else
    printf 'No SHA-256 implementation is available.\n' >&2
    return 1
  fi
}

verify_sha256() {
  local expected="$1"
  local file="$2"
  test "$(sha256_file "$file")" = "$expected"
}

require_plan_literal() {
  grep -Fq -- "$1" "$2"
}

verify_plan_semantics() {
  local plan="$1"
  require_plan_literal 'node = \"24.20.0\"' "$plan"
  require_plan_literal 'minimum_release_age = \"14d\"' "$plan"
  require_plan_literal '"cmd": "sh -c '\''node scripts/install-reviewed-dependencies.mjs'\''"' "$plan"
  require_plan_literal '"cmd": "sh -c '\''node ./node_modules/next/dist/bin/next build'\''"' "$plan"
  require_plan_literal '"startCommand": "node ./node_modules/payload/bin.js migrate \u0026\u0026 exec node ./node_modules/next/dist/bin/next start"' "$plan"
  if grep -Eq -- '"cmd": ".*(corepack|npm (ci|install|i|rebuild)( |"))' "$plan"; then
    printf 'Railpack plan contains a forbidden ambient package-manager command.\n' >&2
    return 1
  fi
}

curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  --retry 3 --retry-all-errors --retry-delay 2 \
  --output "$checksums_path" "$RAILPACK_CHECKSUMS_URL"
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  --retry 3 --retry-all-errors --retry-delay 2 \
  --output "$archive_path" "$RAILPACK_ARCHIVE_URL"

verify_sha256 "$RAILPACK_CHECKSUMS_SHA256" "$checksums_path"
grep -Fqx -- "$RAILPACK_ARCHIVE_SHA256  $RAILPACK_ARCHIVE" "$checksums_path"
verify_sha256 "$RAILPACK_ARCHIVE_SHA256" "$archive_path"

tar -xzf "$archive_path" -C "$tmp_dir" railpack
test "$("$tmp_dir/railpack" --version)" = "railpack version ${RAILPACK_VERSION}"
"$tmp_dir/railpack" plan --out "$generated_plan" "$repo_dir"
verify_plan_semantics "$generated_plan"

if [ "$platform_key" = "Linux:x86_64" ]; then
  if ! cmp -s "$generated_plan" "$expected_plan"; then
    diff --unified "$expected_plan" "$generated_plan" || true
    printf 'Railpack Linux x64 plan fixture drifted.\n' >&2
    exit 1
  fi
  printf 'Railpack %s Linux x64 plan fixture byte-verified.\n' "$RAILPACK_VERSION"
else
  printf 'Railpack %s %s native plan semantic invariants verified; fixture byte comparison is CI Linux x64 only.\n' \
    "$RAILPACK_VERSION" "$platform_key"
fi
