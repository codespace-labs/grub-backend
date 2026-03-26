-- Elimina una FK heredada/incorrecta sobre public.users.id que bloquea inserts.

ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_id_fkey;
