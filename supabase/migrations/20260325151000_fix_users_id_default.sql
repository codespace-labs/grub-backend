-- Asegura que public.users.id pueda generarse automáticamente en inserciones.

ALTER TABLE public.users
  ALTER COLUMN id SET DEFAULT gen_random_uuid();
