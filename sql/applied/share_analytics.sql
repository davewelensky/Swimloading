-- SwimLoading — Share analytics tables
-- Run once in Supabase SQL editor

-- 1. Click tracking — logged server-side via /api/r (no RLS bypass needed for reads)
create table if not exists share_clicks (
    id         uuid primary key default gen_random_uuid(),
    type       text not null check (type in ('spot', 'swim')),
    target_id  text not null,
    referrer   text,
    user_agent text,
    created_at timestamptz not null default now()
);

alter table share_clicks enable row level security;
-- Written exclusively by service role key from /api/r — no anon insert policy
-- Admin reads via service role (no public read policy needed)

-- 2. Conversion tracking — logged client-side after successful signup
create table if not exists share_conversions (
    id            uuid primary key default gen_random_uuid(),
    user_id       uuid references auth.users(id) on delete cascade,
    ref_type      text check (ref_type in ('spot', 'swim')),
    ref_target_id text,
    created_at    timestamptz not null default now()
);

alter table share_conversions enable row level security;

-- Users can insert their own conversion record (once, on signup)
create policy "Users insert own conversion"
    on share_conversions for insert
    with check (auth.uid() = user_id);

-- Users can read their own record (useful for de-duping)
create policy "Users read own conversion"
    on share_conversions for select
    using (auth.uid() = user_id);
