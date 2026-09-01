#!/usr/bin/env bash
#
# Kineticare — Cloud Agent install (repó-bootstrap a checkout után).
#
# Idempotens: biztosítja a két hiányzó RENDSZERfüggőséget (exact Node +
# PostgreSQL) az alap image tetején, majd telepíti az npm-függőségeket a
# lockfile szerint.
#
# A PostgreSQL szándékosan a disztribúció META-csomagja, nem `postgresql-16`:
# így egy alap image-frissítés után is a disztróhoz illő verzió települ,
# pinelési karbantartás nélkül. A start.sh EZÉRT nem éget be verziószámot,
# hanem a `pg_lsclusters` kimenetéből olvassa ki a clustert.
#
# Miért itt és nem külön Dockerfile-ban: (1) a repó minden infrastruktúra-
# konfigot VERZIÓZVA tart (vö. railway.*.json), így a fejlesztői környezet is
# a repóban éljen; (2) a Cloud Agent ALAP image adja a fejlesztői/desktop
# eszközkészletet (Chrome, VNC a computer-use-hoz) — egy saját, minimál alapú
# Dockerfile ezt elveszítené. Ezért a két hiányzó csomagot itt, futásidőben,
# idempotensen telepítjük az alap image-re. A parancs terminál, nem hagy hátra
# futó folyamatot; a szolgáltatások indítása a start.sh dolga.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

# A Cloud Agent /exec-daemon/node shime eltérő Node-ot adhat, ezért az exact,
# checksum-ellenőrzött hivatalos disztribúció kerül a PATH elejére.
NODE_VERSION='24.20.0'
NPM_VERSION='11.19.0'
case "$(uname -m)" in
  x86_64)
    node_arch='x64'
    node_sha256='2f2c0da162318f0de47665410c7c8c2ed3d36c8f3105de4bbc61176c70a7cbf2'
    ;;
  aarch64 | arm64)
    node_arch='arm64'
    node_sha256='5f4ddab610c1ab2016b3c227cebdbf6d9495161487e4739c7b90090595f465f7'
    ;;
  *)
    echo "[install.sh] HIBA: nem támogatott Node architektúra: $(uname -m)" >&2
    exit 1
    ;;
esac
node_archive="node-v${NODE_VERSION}-linux-${node_arch}.tar.xz"
node_home="/opt/node-v${NODE_VERSION}-linux-${node_arch}"

apt_updated=0
apt_update_once() {
  if [ "$apt_updated" = "0" ]; then
    sudo apt-get update -qq
    apt_updated=1
  fi
}

# --- PostgreSQL (a Payload adatbázisa) — idempotens ------------------------
if ! command -v pg_ctlcluster >/dev/null 2>&1; then
  echo '[install.sh] PostgreSQL telepítése…'
  apt_update_once
  sudo apt-get install -y --no-install-recommends postgresql postgresql-contrib
fi

# --- openssl (a start.sh a dev-értékeket ezzel generálja) ------------------
if ! command -v openssl >/dev/null 2>&1; then
  apt_update_once
  sudo apt-get install -y --no-install-recommends openssl
fi

# --- Exact Node (engines/.nvmrc/mise.toml) ----------------------------------
if [ ! -x "${node_home}/bin/node" ] || [ ! -x "${node_home}/bin/npm" ]; then
  echo "[install.sh] Node ${NODE_VERSION} telepítése (nodejs.org, pinned SHA-256)…"
  if ! command -v curl >/dev/null 2>&1 || ! command -v xz >/dev/null 2>&1; then
    apt_update_once
    sudo apt-get install -y --no-install-recommends ca-certificates curl xz-utils
  fi
  node_tmp="$(mktemp -d)"
  trap 'rm -rf "${node_tmp:-}"' EXIT
  curl -fsSLo "${node_tmp}/${node_archive}" \
    "https://nodejs.org/dist/v${NODE_VERSION}/${node_archive}"
  printf '%s  %s\n' "$node_sha256" "${node_tmp}/${node_archive}" | sha256sum --strict -c -
  sudo tar -xJf "${node_tmp}/${node_archive}" -C /opt
fi

if [ ! -x "${node_home}/bin/node" ] || [ ! -x "${node_home}/bin/npm" ]; then
  echo '[install.sh] HIBA: az exact /opt Node/npm runtime hiányos.' >&2
  exit 1
fi
export PATH="${node_home}/bin:/usr/bin:$PATH"
hash -r

if [ "$(command -v node)" != "${node_home}/bin/node" ]; then
  echo '[install.sh] HIBA: a node nem az exact /opt runtime-ból fut.' >&2
  exit 1
fi
if [ "$(command -v npm)" != "${node_home}/bin/npm" ]; then
  echo '[install.sh] HIBA: az npm nem az exact /opt runtime-ból fut.' >&2
  exit 1
fi
if [ "$(node --version)" != "v${NODE_VERSION}" ] || [ "$(npm --version)" != "$NPM_VERSION" ]; then
  echo "[install.sh] HIBA: exact Node/npm contract nem teljesül." >&2
  exit 1
fi
echo "[install.sh] Node: $(node --version), npm: $(npm --version)"

# --- npm-függőségek a lockfile szerint -------------------------------------
cd "$(dirname "${BASH_SOURCE[0]}")/.."
echo '[install.sh] Scriptmentes npm ci + ellenőrzött lifecycle rebuild…'
npm ci --legacy-peer-deps --ignore-scripts
test "$(sha256sum scripts/verify-install-script-lock.sha256 | cut -c1-64)" = \
  '22770112e6e712a96208daa7b47046fe91d3492a90af7cca7224b7c789de02c2'
sha256sum --strict -c scripts/verify-install-script-lock.sha256
node scripts/verify-install-script-lock.mjs
npm rebuild --ignore-scripts=false --foreground-scripts --strict-allow-scripts=true --dangerously-allow-all-scripts=false
echo '[install.sh] Kész.'
