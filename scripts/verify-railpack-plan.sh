#!/usr/bin/env bash
set -euo pipefail

RAILPACK_VERSION='0.38.0'
RAILPACK_ARCHIVE='railpack-v0.38.0-x86_64-unknown-linux-musl.tar.gz'
RAILPACK_ARCHIVE_SHA256='7c3f0e70ca8bf80bde87e8c30cb0171414c2b6bbd794d6f60a19cc3b71772950'
RAILPACK_CHECKSUMS_SHA256='69d58f46c00048b1ccddc35151842cfa393d88ad06e5d376e7a2f4bcc8aabb89'
RAILPACK_ARCHIVE_URL="https://github.com/railwayapp/railpack/releases/download/v${RAILPACK_VERSION}/${RAILPACK_ARCHIVE}"
RAILPACK_CHECKSUMS_URL="https://github.com/railwayapp/railpack/releases/download/v${RAILPACK_VERSION}/checksums.txt"

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
expected_plan="${repo_dir}/src/__tests__/fixtures/railpack-v0.38.0-plan.json"
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/kineticare-railpack-plan.XXXXXX")"
trap 'rm -rf "$tmp_dir"' EXIT

archive_path="${tmp_dir}/${RAILPACK_ARCHIVE}"
checksums_path="${tmp_dir}/checksums.txt"
generated_plan="${tmp_dir}/generated-plan.json"

curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  --retry 3 --retry-all-errors --retry-delay 2 \
  --output "$checksums_path" "$RAILPACK_CHECKSUMS_URL"
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  --retry 3 --retry-all-errors --retry-delay 2 \
  --output "$archive_path" "$RAILPACK_ARCHIVE_URL"

printf '%s  %s\n' "$RAILPACK_CHECKSUMS_SHA256" "$checksums_path" | sha256sum --strict -c -
grep --fixed-strings --line-regexp -- "$RAILPACK_ARCHIVE_SHA256  $RAILPACK_ARCHIVE" "$checksums_path"
printf '%s  %s\n' "$RAILPACK_ARCHIVE_SHA256" "$archive_path" | sha256sum --strict -c -

tar -xzf "$archive_path" -C "$tmp_dir" railpack
test "$("$tmp_dir/railpack" --version)" = "railpack version ${RAILPACK_VERSION}"
"$tmp_dir/railpack" plan --out "$generated_plan" "$repo_dir"

if ! cmp --silent "$generated_plan" "$expected_plan"; then
  diff --unified "$expected_plan" "$generated_plan" || true
  printf 'Railpack plan fixture drifted.\n' >&2
  exit 1
fi

printf 'Railpack %s plan fixture verified.\n' "$RAILPACK_VERSION"
