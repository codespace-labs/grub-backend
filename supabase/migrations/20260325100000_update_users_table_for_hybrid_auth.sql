-- Adapta public.users para el modelo híbrido:
--   • Usuarios OAuth (Google/Apple)  → vienen de Clerk  → tienen clerk_user_id
--   • Usuarios de phone OTP          → vienen de Supabase → tienen supabase_user_id
--
-- clerk_user_id pasa a ser nullable (solo Clerk OAuth users lo tienen).
-- Se agrega supabase_user_id para los usuarios autenticados via Supabase phone OTP.

-- 1. Hacer clerk_user_id nullable
ALTER TABLE public.users
  ALTER COLUMN clerk_user_id DROP NOT NULL;

-- 2. Agregar columna supabase_user_id
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS supabase_user_id uuid;

-- 3. Índice único parcial sobre supabase_user_id (permite múltiples NULLs)
CREATE UNIQUE INDEX IF NOT EXISTS users_supabase_user_id_idx
  ON public.users (supabase_user_id)
  WHERE supabase_user_id IS NOT NULL;

-- 4. El índice único sobre clerk_user_id ya existe como parcial (WHERE NOT NULL)
--    Si existe la constraint UNIQUE directa en la columna, la dropeamos
--    y dejamos solo el índice parcial para consistencia.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_clerk_user_id_key'
      AND conrelid = 'public.users'::regclass
  ) THEN
    ALTER TABLE public.users DROP CONSTRAINT users_clerk_user_id_key;
  END IF;
END
$$;

-- El índice users_clerk_user_id_idx (WHERE clerk_user_id IS NOT NULL) ya existe
-- y cubre la unicidad para valores no-NULL. No hace falta recrearlo.

COMMENT ON COLUMN public.users.supabase_user_id IS 'UUID del usuario en supabase.auth.users. Solo para usuarios autenticados vía phone OTP de Supabase.';
COMMENT ON COLUMN public.users.clerk_user_id    IS 'ID del usuario en Clerk (ej: user_2abc123). Solo para usuarios OAuth (Google/Apple).';
