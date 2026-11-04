-- v1.1 de l'appli : notifications push + chat support
-- À coller une seule fois dans Supabase → SQL Editor → Run.
-- Les deux tables ne sont lues que par l'API (clé service) : RLS activé sans
-- aucune policy = personne d'autre ne peut les lire.

create table if not exists public.app_push_tokens (
  token       text primary key,
  email       text not null,
  is_admin    boolean not null default false,
  platform    text,
  updated_at  timestamptz not null default now()
);
create index if not exists app_push_tokens_email_idx on public.app_push_tokens (lower(email));
alter table public.app_push_tokens enable row level security;

create table if not exists public.support_messages (
  id            bigint generated always as identity primary key,
  client_email  text not null,
  sender        text not null check (sender in ('client', 'admin')),
  body          text not null check (char_length(body) between 1 and 2000),
  created_at    timestamptz not null default now(),
  read_at       timestamptz
);
create index if not exists support_messages_thread_idx on public.support_messages (lower(client_email), created_at desc);
alter table public.support_messages enable row level security;
