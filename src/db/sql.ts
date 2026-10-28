export const DDL = `
create table if not exists brand (
  id integer primary key default 1,
  name text not null,
  handle text not null,
  initial text not null,
  accent text not null,
  kicker text not null,
  work_start text not null default '07:00',
  work_end text not null default '22:00',
  pass_threshold integer not null default 70,
  default_format text not null default 'teaser_bio',
  default_template text not null default 'serif',
  public_base_url text not null default 'http://127.0.0.1:43123',
  constraint brand_one check (id = 1)
);

create table if not exists users (
  id uuid primary key,
  name text not null,
  email text not null unique,
  password_hash text not null,
  role text not null check (role in ('admin','social_media','viewer','kol_specialist')),
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);

create table if not exists sessions (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null
);

create table if not exists brain_docs (
  slug text primary key,
  title text not null,
  body text not null,
  locked boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists sources (
  id uuid primary key,
  name text not null,
  url text not null,
  lang text not null check (lang in ('ID','EN')),
  kind text not null default 'rss',
  enabled boolean not null default true,
  last_fetched_at timestamptz,
  last_error text
);

create table if not exists topics (
  id uuid primary key,
  source_id uuid not null references sources(id) on delete cascade,
  title text not null,
  url text not null unique,
  summary text not null default '',
  excerpt text not null default '',
  published_at timestamptz,
  discovered_at timestamptz not null default now(),
  state text not null default 'new' check (state in ('new','scored','passed','skipped','drafted','failed')),
  score integer,
  aspects jsonb,
  tags jsonb not null default '[]',
  sensitive boolean not null default false,
  sensitive_reason text,
  blocked boolean not null default false,
  score_reason text,
  scored_at timestamptz,
  error text
);

create table if not exists drafts (
  id uuid primary key,
  topic_id uuid not null references topics(id),
  status text not null default 'drafted',
  format text not null,
  template text not null,
  slides jsonb not null,
  caption text not null,
  hashtags jsonb not null,
  alt_headlines jsonb not null,
  focal_y integer not null default 50,
  share_to_story boolean not null default false,
  text_dirty boolean not null default false,
  scheduled_at timestamptz,
  posted_at timestamptz,
  ig_media_id text,
  story_media_id text,
  story_error text,
  error text,
  short_code text not null unique,
  click_count integer not null default 0,
  manual boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists assets (
  id uuid primary key,
  draft_id uuid not null references drafts(id) on delete cascade,
  slide_index integer not null,
  bytes bytea not null,
  created_at timestamptz not null default now(),
  unique (draft_id, slide_index)
);

create table if not exists activity (
  id uuid primary key,
  agent text not null,
  message text not null,
  created_at timestamptz not null default now()
);

create table if not exists llm_spend (
  id uuid primary key,
  agent text not null,
  model text not null,
  cost_usd numeric(12,6) not null,
  created_at timestamptz not null default now()
);

create table if not exists jobs (
  id uuid primary key,
  name text not null,
  payload jsonb not null,
  run_at timestamptz not null,
  manual boolean not null default false,
  locked_at timestamptz,
  finished_at timestamptz,
  error text,
  attempts integer not null default 0
);

create table if not exists ig_connection (
  id integer primary key default 1,
  ig_user_id text,
  access_token text,
  username text,
  connected_at timestamptz,
  constraint ig_one check (id = 1)
);

create table if not exists insight_snapshots (
  id uuid primary key,
  taken_at timestamptz not null default now(),
  followers integer not null,
  views integer not null default 0,
  reach integer not null default 0,
  interactions integer not null default 0,
  accounts_engaged integer,
  daily jsonb not null
);

create table if not exists post_insights (
  draft_id uuid primary key references drafts(id) on delete cascade,
  views integer not null default 0,
  reach integer not null default 0,
  likes integer not null default 0,
  comments integer not null default 0,
  saves integer not null default 0,
  shares integer not null default 0,
  synced_at timestamptz not null default now()
);

insert into ig_connection (id) values (1) on conflict (id) do nothing;
`.trim();
