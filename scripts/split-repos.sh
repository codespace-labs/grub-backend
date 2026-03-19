#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_ROOT="${1:-$ROOT_DIR/../grub-separated}"

MOBILE_REPO="$OUTPUT_ROOT/grub-mobile"
BACKOFFICE_REPO="$OUTPUT_ROOT/grub-backoffice"
BACKEND_REPO="$OUTPUT_ROOT/grub-backend"
WORKERS_REPO="$OUTPUT_ROOT/grub-workers"

copy_path() {
  local source_path="$1"
  local dest_root="$2"

  mkdir -p "$dest_root"
  rsync -a "$ROOT_DIR/$source_path" "$dest_root/"
}

copy_path_flat() {
  local source_dir="$1"
  local dest_root="$2"

  mkdir -p "$dest_root"
  rsync -a "$ROOT_DIR/$source_dir/" "$dest_root/"
}

write_file() {
  local target="$1"
  local content="$2"

  mkdir -p "$(dirname "$target")"
  printf "%s\n" "$content" > "$target"
}

echo "Creating split repos under: $OUTPUT_ROOT"
mkdir -p "$MOBILE_REPO" "$BACKOFFICE_REPO" "$BACKEND_REPO" "$WORKERS_REPO"

echo "Exporting grub-mobile"
copy_path "app" "$MOBILE_REPO"
copy_path "assets" "$MOBILE_REPO"
copy_path "src" "$MOBILE_REPO"
copy_path "app.json" "$MOBILE_REPO"
copy_path "index.ts" "$MOBILE_REPO"
copy_path "metro.config.js" "$MOBILE_REPO"
copy_path "package.json" "$MOBILE_REPO"
copy_path "package-lock.json" "$MOBILE_REPO"
copy_path "tsconfig.json" "$MOBILE_REPO"
copy_path "README.md" "$MOBILE_REPO"

write_file "$MOBILE_REPO/REPO_ROLE.md" \
"# grub-mobile

Expo app separada de operaciones y scraping.

Variables:
- EXPO_PUBLIC_SUPABASE_URL
- EXPO_PUBLIC_SUPABASE_ANON_KEY
"

echo "Exporting grub-backoffice"
copy_path_flat "backoffice" "$BACKOFFICE_REPO"
copy_path "packages/contracts" "$BACKOFFICE_REPO/packages"
copy_path "ARCHITECTURE_SEPARATION.md" "$BACKOFFICE_REPO"

node -e "
const fs = require('fs');
const path = '$BACKOFFICE_REPO/package.json';
const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
if (pkg.dependencies && pkg.dependencies['@grub/contracts']) {
  pkg.dependencies['@grub/contracts'] = 'file:./packages/contracts';
}
fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
"

write_file "$BACKOFFICE_REPO/.env.example" \
"NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<local_anon_key>
"

write_file "$BACKOFFICE_REPO/REPO_ROLE.md" \
"# grub-backoffice

Next.js app para operaciones, calidad, auditoría y roles.

Depende del backend compartido publicado en Supabase.
"

echo "Exporting grub-backend"
copy_path "supabase" "$BACKEND_REPO"
copy_path "packages/contracts" "$BACKEND_REPO/packages"
copy_path "scripts" "$BACKEND_REPO"
copy_path "PROYECTO.md" "$BACKEND_REPO"
copy_path "ARCHITECTURE_SEPARATION.md" "$BACKEND_REPO"
copy_path "REPO_SPLIT_GUIDE.md" "$BACKEND_REPO"

write_file "$BACKEND_REPO/README.md" \
"# grub-backend

Fuente real de backend en esta fase.

Incluye:
- migraciones
- funciones públicas
- funciones admin
- funciones de sync/workers por compatibilidad de despliegue

Comandos típicos:
- supabase start
- supabase db reset
- supabase functions serve --no-verify-jwt
"

echo "Exporting grub-workers"
mkdir -p "$WORKERS_REPO/supabase/functions" "$WORKERS_REPO/scripts"
copy_path "supabase/functions/_shared" "$WORKERS_REPO/supabase/functions"
copy_path "supabase/functions/sync-ticketmaster" "$WORKERS_REPO/supabase/functions"
copy_path "supabase/functions/sync-ticketmaster-pe" "$WORKERS_REPO/supabase/functions"
copy_path "supabase/functions/sync-teleticket" "$WORKERS_REPO/supabase/functions"
copy_path "supabase/functions/enrich-artists" "$WORKERS_REPO/supabase/functions"
copy_path "scripts/validate-event-quality.mjs" "$WORKERS_REPO/scripts"
copy_path "ARCHITECTURE_SEPARATION.md" "$WORKERS_REPO"
copy_path "REPO_SPLIT_GUIDE.md" "$WORKERS_REPO"

write_file "$WORKERS_REPO/README.md" \
"# grub-workers

Repo de extracción progresiva de lógica de ingestión.

En esta fase no reemplaza al despliegue real de Supabase.
La fuente de despliegue sigue siendo grub-backend.
"

echo
echo "Split complete."
echo "Created:"
echo "  $MOBILE_REPO"
echo "  $BACKOFFICE_REPO"
echo "  $BACKEND_REPO"
echo "  $WORKERS_REPO"
echo
echo "Next:"
echo "  1. Review each repo"
echo "  2. git init + first commit"
echo "  3. Create GitHub repos with these exact names:"
echo "     - grub-mobile"
echo "     - grub-backoffice"
echo "     - grub-backend"
echo "     - grub-workers"
