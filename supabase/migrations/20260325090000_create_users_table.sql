-- Tabela de usuários do app, sincronizada a partir do Clerk via webhook.
-- Armazena o provider de origem (google, apple, phone) e o ID externo do provider.

CREATE TABLE IF NOT EXISTS public.users (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id    text        UNIQUE NOT NULL,
  provider         text        NOT NULL CHECK (provider IN ('google', 'apple', 'phone')),
  provider_user_id text,                          -- ID externo do Google/Apple (sub)
  email            text,
  phone            text,
  display_name     text,
  avatar_url       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS clerk_user_id text,
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS provider_user_id text,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS avatar_url text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'users_provider_check'
      AND conrelid = 'public.users'::regclass
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_provider_check
      CHECK (provider IN ('google', 'apple', 'phone'));
  END IF;
END
$$;

COMMENT ON TABLE  public.users                    IS 'Usuários do app sincronizados do Clerk via webhook user.created / user.updated.';
COMMENT ON COLUMN public.users.clerk_user_id      IS 'ID do usuário no Clerk (ex: user_2abc123).';
COMMENT ON COLUMN public.users.provider           IS 'Provider primário de autenticação: google, apple ou phone.';
COMMENT ON COLUMN public.users.provider_user_id   IS 'ID da conta externa do provider OAuth (Google sub, Apple sub).';

CREATE UNIQUE INDEX IF NOT EXISTS users_clerk_user_id_idx
  ON public.users (clerk_user_id)
  WHERE clerk_user_id IS NOT NULL;

-- Trigger para manter updated_at automático
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'users_set_updated_at'
      AND tgrelid = 'public.users'::regclass
  ) THEN
    CREATE TRIGGER users_set_updated_at
      BEFORE UPDATE ON public.users
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END
$$;

-- RLS: tabela acessível apenas via service role (Edge Functions)
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
