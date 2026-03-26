ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS last_sign_in_at timestamptz;

COMMENT ON COLUMN public.users.last_sign_in_at IS
  'Último acceso reportado por Clerk para usuarios OAuth del app.';
