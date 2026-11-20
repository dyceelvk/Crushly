-- holupp_identity_engine — verdict, hysteresis, persistence
--
-- Depends on the four previous identity migrations.
--
-- ── Every phase in its own function ────────────────────────────────────────
--
-- Signals → weights → scores → verdict → persistence are separate functions
-- because each one is independently testable and because a failure in any one
-- of them must not be able to break the feed, messaging or profile. The only
-- caller is holupp_identity_recalc(), and it is called by a scheduled job and by
-- the admin panel — never on a page load, never from a client.
--
-- `holupp_identity_recalc` catches nothing itself: if it throws, the scheduled
-- job records the failure and moves on, and the last good row keeps serving.
-- That is the "classification failure must never break the app" requirement,
-- enforced by the fact that no read path calls it.

begin;

-- ---------------------------------------------------------------- settings read
create or replace function public.holupp_identity_setting(p_key text, p_default jsonb)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce((select value from holupp_identity_settings where key = p_key), p_default);
$function$;

-- ------------------------------------------------------------------- the verdict
--
-- Given five scores and a member's current published identity, decide:
--   * what wins now,
--   * who is co-primary,
--   * whether confidence is high enough to publish,
--   * whether the published label should move (hysteresis).
--
-- No side effects. Testable in isolation, which is where the tie behaviour and
-- the anti-flapping rules are proved.
create or replace function public.holupp_identity_verdict(
  p_scores          jsonb,
  p_evidence        integer,
  p_published       text default null,
  p_published_since bigint default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  tol        numeric := coalesce((holupp_identity_setting('match_tolerance', '4'::jsonb))::text::numeric, 4);
  thr        numeric := coalesce((holupp_identity_setting('confidence_threshold', '0.42'::jsonb))::text::numeric, 0.42);
  min_ev     integer := coalesce((holupp_identity_setting('min_events', '10'::jsonb))::text::int, 10);
  margin     numeric := coalesce((holupp_identity_setting('flip_margin', '6'::jsonb))::text::numeric, 6);
  hold_ms    bigint  := coalesce((holupp_identity_setting('min_hold_hours', '72'::jsonb))::text::bigint, 72) * 3600000;

  ordered    text[];
  top        text;
  top_score  numeric;
  -- The best score *outside* the co-primary set. Separation is measured against
  -- this, not against second place: two identities genuinely level at the top
  -- are not uncertainty, they are a real answer with two halves.
  outside_score numeric;
  co         text[] := '{}';
  clarity    numeric;
  k          text;
  v          numeric;
  confidence numeric;
  eligible   boolean;
  challenger_ok boolean;
  held_long  boolean;
  new_pub    text;
begin
  -- Order identities by score, descending, deterministic on ties by name so the
  -- same inputs always produce the same output. The ordering is a convenience;
  -- co-primary membership is decided by tolerance, not by this order.
  select array_agg(identity order by score desc, identity)
    into ordered
    from (
      select * from (values
        ('introvert', coalesce((p_scores->>'introvert')::numeric, 0)),
        ('pen',       coalesce((p_scores->>'pen')::numeric, 0)),
        ('talkative', coalesce((p_scores->>'talkative')::numeric, 0)),
        ('explorer',  coalesce((p_scores->>'explorer')::numeric, 0)),
        ('fun',       coalesce((p_scores->>'fun')::numeric, 0))
      ) as t(identity, score)
      order by score desc, identity
      limit 5
    ) q;

  top := ordered[1];
  top_score := coalesce((p_scores->>top)::numeric, 0);

  -- Co-primary: everyone within tolerance of the winner. Compared with a
  -- tolerance rather than equality because two floats that "should" be equal
  -- routinely are not, and a member seeing one identity flip to another for no
  -- visible reason is exactly the fragility the brief calls out.
  foreach k in array ordered loop
    v := coalesce((p_scores->>k)::numeric, 0);
    if top_score - v <= tol and v > 0 then
      co := co || k;
    end if;
  end loop;

  -- How far clear of the *field* the winners are. If nothing sits outside the
  -- co-primary set the group is the whole picture and clarity is total; if
  -- everything is bunched, clarity collapses towards zero and the member is
  -- correctly described as still developing.
  select max(score) into outside_score
    from (values
      ('introvert', coalesce((p_scores->>'introvert')::numeric, 0)),
      ('pen',       coalesce((p_scores->>'pen')::numeric, 0)),
      ('talkative', coalesce((p_scores->>'talkative')::numeric, 0)),
      ('explorer',  coalesce((p_scores->>'explorer')::numeric, 0)),
      ('fun',       coalesce((p_scores->>'fun')::numeric, 0))
    ) as t(identity, score)
    where identity <> all (co);

  clarity := case
    when outside_score is null then 1.0
    else least(1.0, greatest(0.0, (top_score - outside_score) / 25.0) * 0.7 + 0.3)
  end;
  -- A crowded top is not a decision. Three or more identities inside tolerance
  -- means the member genuinely has not settled into a shape yet, and printing
  -- three titles would be a worse answer than saying so.
  if array_length(co, 1) > 2 then
    clarity := clarity * (2.0 / array_length(co, 1));
  end if;

  -- Confidence = evidence volume × clarity.
  --   volume: saturating on event count — 0.4 at ~7 events, 0.72 at ~25.
  confidence := round(public.identity_strength(p_evidence, 15) * clarity, 3);

  eligible := p_evidence >= min_ev and top_score > 0;

  -- Hysteresis. A challenger replaces the incumbent only if it wins by the
  -- configured margin and the incumbent has been held for the minimum period.
  -- While those conditions are unmet the published label stands, even though the
  -- raw scores have already moved — the scores are stored either way.
  new_pub := null;
  if not eligible or confidence < thr then
    new_pub := null;                                  -- nothing is published
  elsif p_published is null then
    new_pub := top;                                   -- first classification
  elsif p_published = any (co) then
    new_pub := p_published;                            -- incumbent still co-primary
  else
    held_long := (public.now_ms() - coalesce(p_published_since, 0)) >= hold_ms;
    challenger_ok := top_score - coalesce((p_scores->>p_published)::numeric, 0) >= margin;
    if held_long and challenger_ok then
      new_pub := top;
    else
      new_pub := p_published;                          -- hold, for stability
    end if;
  end if;

  return jsonb_build_object(
    'top_identity', case when eligible then top else null end,
    'co_primary', case when eligible and confidence >= thr then to_jsonb(co) else '[]'::jsonb end,
    'confidence', confidence,
    'evidence', p_evidence,
    'eligible', eligible,
    'published_identity', new_pub,
    'changed', (new_pub is distinct from p_published)
  );
end;
$function$;

-- ------------------------------------------------------------------ the recalc
--
-- One member. Idempotent. Safe to run twice.
create or replace function public.holupp_identity_recalc(p_profile bigint)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  sig        jsonb;
  wts        jsonb;
  s          jsonb;
  prev       holupp_identity_scores;
  verdict    jsonb;
  ev         integer;
begin
  if not coalesce((holupp_identity_setting('enabled', 'true'::jsonb))::text::boolean, true) then
    return jsonb_build_object('skipped', 'disabled');
  end if;

  sig := holupp_identity_signals(p_profile,
           coalesce((holupp_identity_setting('window_days', '30'::jsonb))::text::int, 30));
  sig := sig || jsonb_build_object('windowDays',
           coalesce((holupp_identity_setting('window_days', '30'::jsonb))::text::int, 30));

  -- Total evidence: distinct acts. Views count once each however long they
  -- lasted — a long look is a stronger view, not a second one.
  ev := coalesce((sig->>'posts')::int, 0)
      + coalesce((sig->>'comments')::int, 0)
      + coalesce((sig->>'reactionsGiven')::int, 0)
      + coalesce((sig->>'views')::int, 0)
      + coalesce((sig->>'profilesExplored')::int, 0)
      + coalesce((sig->>'momentsViewed')::int, 0)
      + coalesce((sig->>'messages')::int, 0)
      + coalesce((sig->>'searches')::int, 0);

  select jsonb_object_agg(identity, weights) into wts from holupp_identity_weights;
  s := holupp_identity_calculate(sig, coalesce(wts, '{}'::jsonb));

  select * into prev from holupp_identity_scores where profile_id = p_profile;

  verdict := holupp_identity_verdict(s, ev, prev.published_identity, prev.published_since);

  insert into holupp_identity_scores as t (
    profile_id, scores, top_identity, co_primary, confidence, evidence, eligible,
    published_identity, published_since, computed_at
  ) values (
    p_profile, s,
    (verdict->>'top_identity'),
    coalesce(array(select jsonb_array_elements_text(verdict->'co_primary')), '{}'),
    (verdict->>'confidence')::numeric,
    ev,
    (verdict->>'eligible')::boolean,
    (verdict->>'published_identity'),
    case when (verdict->>'published_identity') is distinct from prev.published_identity
         then public.now_ms() else prev.published_since end,
    public.now_ms()
  )
  on conflict (profile_id) do update set
    scores = excluded.scores,
    top_identity = excluded.top_identity,
    co_primary = excluded.co_primary,
    confidence = excluded.confidence,
    evidence = excluded.evidence,
    eligible = excluded.eligible,
    published_identity = excluded.published_identity,
    published_since = excluded.published_since,
    computed_at = excluded.computed_at;

  -- History is written only when the *published* label moves. A member whose
  -- scores wobble but whose identity stands should not get a history row, or
  -- the audit trail becomes noise.
  if (verdict->>'published_identity') is distinct from prev.published_identity then
    insert into holupp_identity_history (profile_id, from_identity, to_identity, co_primary, confidence, scores, reason)
    values (
      p_profile,
      prev.published_identity,
      coalesce(verdict->>'published_identity', 'unclassified'),
      coalesce(array(select jsonb_array_elements_text(verdict->'co_primary')), '{}'),
      (verdict->>'confidence')::numeric,
      s,
      case
        when (verdict->>'published_identity') is null then 'below_confidence_threshold'
        when prev.published_identity is null then 'first_classification'
        else 'reclassified'
      end
    );
  end if;

  return verdict || jsonb_build_object('scores', s);
end;
$function$;

-- Batch. Returns counts so the admin panel and the scheduled job can report
-- what happened without reading any member's data.
create or replace function public.holupp_identity_recalc_all(p_limit integer default 500)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r        record;
  done     integer := 0;
  failed   integer := 0;
  changed  integer := 0;
  res      jsonb;
begin
  if not coalesce((holupp_identity_setting('enabled', 'true'::jsonb))::text::boolean, true) then
    return jsonb_build_object('skipped', 'disabled');
  end if;

  -- Members who have never been calculated come first, then the stalest, so a
  -- limited batch always makes progress instead of re-running the same five.
  for r in
    select p.id
      from profiles p
      left join holupp_identity_scores s on s.profile_id = p.id
     order by s.computed_at nulls first, s.computed_at
     limit greatest(coalesce(p_limit, 500), 1)
  loop
    begin
      res := holupp_identity_recalc(r.id);
      done := done + 1;
      if coalesce((res->>'changed')::boolean, false) then
        changed := changed + 1;
      end if;
    exception when others then
      -- One member's bad data must not stop the batch. The failure is counted;
      -- the last good row keeps serving.
      failed := failed + 1;
    end;
  end loop;

  return jsonb_build_object('calculated', done, 'changed', changed, 'failed', failed);
end;
$function$;

commit;
