-- Corrige el schema de public.users para permitir UPSERT por clerk_user_id.
-- El índice parcial anterior no es utilizable por ON CONFLICT (clerk_user_id).

-- Si hubiera duplicados históricos por clerk_user_id, conservamos el registro
-- más recientemente actualizado/creado y eliminamos el resto.
DELETE FROM public.users older
USING public.users newer
WHERE older.clerk_user_id IS NOT NULL
  AND newer.clerk_user_id = older.clerk_user_id
  AND (
    COALESCE(newer.updated_at, newer.created_at, now()),
    newer.id
  ) > (
    COALESCE(older.updated_at, older.created_at, now()),
    older.id
  );

DROP INDEX IF EXISTS public.users_clerk_user_id_idx;
DROP INDEX IF EXISTS public.users_clerk_user_id_key;

CREATE UNIQUE INDEX users_clerk_user_id_key
  ON public.users (clerk_user_id);
