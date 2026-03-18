-- Analytics events table
-- Run once in Supabase SQL editor

create table if not exists analytics_events (
    id          uuid        default gen_random_uuid() primary key,
    event_name  text        not null,
    user_id     uuid        references profiles(id) on delete set null,
    properties  jsonb,
    created_at  timestamptz default now()
);

create index if not exists analytics_events_name_idx       on analytics_events(event_name);
create index if not exists analytics_events_created_at_idx on analytics_events(created_at);

-- RLS: users can insert their own events; admin can read all
alter table analytics_events enable row level security;

create policy "users_insert_own_analytics" on analytics_events
    for insert with check (auth.uid() = user_id or user_id is null);

create policy "admin_read_analytics" on analytics_events
    for select using (auth.email() = 'dave.welensky@gmail.com');
