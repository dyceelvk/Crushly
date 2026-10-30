-- Restore the existing attachment types for Whispers. The shared kind helper
-- inadvertently omitted messages, rejecting every message upload before storage.
create or replace function public.media_kind_allows(p_kind text, p_ext text)
returns boolean language sql immutable as $$
  select case
    when p_kind = 'photos' then p_ext in ('jpg', 'png', 'webp')
    when p_kind in ('moments', 'posts') then p_ext in ('jpg', 'png', 'webp', 'mp4', 'webm', 'mov')
    when p_kind in ('circles', 'messages') then p_ext in ('jpg', 'png', 'webp', 'm4a', 'mp3', 'mp4', 'webm', 'mov')
    when p_kind = 'vibes' then p_ext in ('mp4', 'webm', 'mov', 'jpg', 'png', 'webp')
    else false
  end
$$;
