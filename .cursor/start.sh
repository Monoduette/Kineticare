#!/usr/bin/env bash
#
# Kineticare — Cloud Agent per-boot indító.
#
# Feladata (minden induláskor, idempotensen):
#   1. elindítja a helyi PostgreSQL clustert (a verziót a pg_lsclusters adja);
#   2. legenerálja EGYSZER a NEM titkos fejlesztői környezeti változókat egy
#      repón KÍVÜLI fájlba ($HOME/.kineticare-dev.env), és utána stabilan onnan
#      olvassa;
#   3. biztosítja a `kineticare` dev szerepkört és adatbázist, a jelszót minden
#      induláskor szinkronba hozza a generált értékkel;
#   4. lefuttatja a Payload-migrációt (a már lefutottakat nem futtatja újra).
#
# TILOS ZÓNA (CLAUDE.md 1.): titok / API-kulcs / POSKey / jelszó SOHA nem kerül
# a repóba — sem értékként, sem placeholderként. Ezért minden credential-alakú
# érték (DB-jelszó, PAYLOAD_SECRET, Barion tesz-POSKey) itt, FUTÁSIDŐBEN
# generálódik a $HOME alatti, gitignore-on kívüli fájlba. A publikus, nem titkos
# értékek (localhost URL, teszt-API-URL, dev e-mail) sem élesek — kizárólag a
# helyi fejlesztést szolgálják.
#
# A start-parancs a Cloud Agent életciklusában a per-boot fázis: gyorsan
# lefut és visszatér. A hosszú életű fejlesztői szerver a `terminals` alatt él
# (lásd .cursor/environment.json), nem itt.
set -euo pipefail

# Node 24-et garantálunk (a repó engines/.nvmrc kikötése). A Cloud Agent
# /exec-daemon/node shime (Node 22) egyébként PATH-előnyt élvez és elárnyékolná
# a rendszerbeli Node 24-et — az explicit prepend ezt a parancs futásakor
# felülírja. A NodeSource Node 24 a /usr/bin/node alatt él.
export PATH="/usr/bin:$PATH"

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$HOME/.kineticare-dev.env"

log() { printf '[start.sh] %s\n' "$*"; }

# --- 1) PostgreSQL cluster indítása (idempotens) ---------------------------
# A cluster verzióját NEM égetjük be. Az install.sh a disztribúció `postgresql`
# META-csomagját telepíti, ami egy disztró-frissítéssel 17-re vagy 18-ra
# válthat; a korábbi, beégetett `pg_ctlcluster 16 main` ilyenkor a nem létező
# 16-os clustert indította volna, a hibát pedig egy `|| true` elnyelte, így a
# baj csak 30 másodperc múlva, félrevezető „nem lett elérhető" üzenetként
# jelent meg. A `pg_lsclusters` a TÉNYLEGESEN telepített clustert mondja meg,
# tehát a start a valósághoz igazodik, nem egy feltételezéshez.
cluster_line="$(pg_lsclusters --no-header 2>/dev/null | head -n 1 || true)"
pg_version="$(printf '%s\n' "$cluster_line" | awk '{print $1}')"
pg_cluster="$(printf '%s\n' "$cluster_line" | awk '{print $2}')"
if [ -z "$pg_version" ] || [ -z "$pg_cluster" ]; then
  log 'HIBA: nincs telepített PostgreSQL cluster (a pg_lsclusters üres). Futtasd előbb az install.sh-t.'
  exit 1
fi

log "PostgreSQL cluster indítása: ${pg_version}/${pg_cluster}…"
# A „már fut" eset normális és nem hiba, ezért a nem nulla kilépés önmagában
# nem állítja meg a scriptet — de KIMONDJUK, hogy ne néma legyen. A tényleges
# döntést a lenti readiness-ciklus hozza meg.
if ! sudo pg_ctlcluster "$pg_version" "$pg_cluster" start >/dev/null 2>&1; then
  log "A cluster indító parancsa nem nullával tért vissza (ha már fut, ez rendben van)."
fi

ready=0
for _ in $(seq 1 30); do
  if pg_isready -h localhost -q; then
    ready=1
    break
  fi
  sleep 1
done
if [ "$ready" -ne 1 ]; then
  log "HIBA: a PostgreSQL (${pg_version}/${pg_cluster}) nem lett elérhető 30 mp alatt."
  exit 1
fi
log 'PostgreSQL elérhető (localhost:5432).'

# --- 2) NEM titkos dev env — egyszer generálva, utána stabil (repón kívül) --
if [ ! -f "$ENV_FILE" ]; then
  log "Fejlesztői env generálása: $ENV_FILE (repón kívül, egyszer)."
  umask 077
  db_password="$(openssl rand -hex 16)"
  {
    echo "export DB_PASSWORD=\"${db_password}\""
    echo "export DATABASE_URI=\"postgres://kineticare:${db_password}@localhost:5432/kineticare\""
    echo "export PAYLOAD_SECRET=\"$(openssl rand -hex 32)\""
    echo 'export NEXT_PUBLIC_SERVER_URL="http://localhost:3000"'
    echo 'export BARION_API_URL="https://api.test.barion.com"'
    echo 'export BARION_PAYEE_EMAIL="dev@example.local"'
    echo 'export BARION_ENVIRONMENT="test"'
    echo "export BARION_POSKEY_TEST=\"dev-$(openssl rand -hex 8)\""
  } >"$ENV_FILE"
fi
# shellcheck disable=SC1090
set -a
. "$ENV_FILE"
set +a

# --- 3) Szerepkör + adatbázis biztosítása ----------------------------------
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='kineticare'" | grep -q 1; then
  log 'kineticare szerepkör létrehozása.'
  sudo -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE ROLE kineticare LOGIN"
fi
# A jelszót minden induláskor a generált, stabil értékre állítjuk (idempotens).
# A jelszó STDIN-en megy, nem a `-c` argumentumában: a parancssor a
# /proc/<pid>/cmdline-on keresztül a gép minden felhasználója számára olvasható,
# amíg a parancs fut. (A dev-jelszó eldobható és a $HOME alatt, umask 077-tel
# születik, de a rossz szokást nem visszük tovább élesebb scriptekbe.)
sudo -u postgres psql -v ON_ERROR_STOP=1 >/dev/null <<SQL
ALTER ROLE kineticare WITH LOGIN PASSWORD '${DB_PASSWORD}';
SQL
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='kineticare'" | grep -q 1; then
  log 'kineticare adatbázis létrehozása.'
  sudo -u postgres createdb -O kineticare kineticare
fi

# --- 4) Payload-migráció (idempotens) --------------------------------------
log 'Payload-migráció futtatása…'
cd "$REPO_DIR"
./node_modules/.bin/payload migrate
log 'Kész: az adatbázis migrálva, a környezet indulásra kész.'
