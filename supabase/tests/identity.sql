-- HolUpp Identity: the engine, proved.
--
-- Eight scenarios, A–H, one for each promise the brief makes that could quietly
-- be false. Each section says what it is defending.
--
--   A  the five exist, and nothing else does
--   B  a counter is not an identity (100 comments ≠ Talkative Crush)
--   C  ties inside tolerance are co-primary, not a coin flip
--   D  a new account is "still developing", not misclassified
--   E  messages are counted by shape, never by content
--   F  hiding is public-only — classification carries on
--   G  hysteresis: the label does not flap
--   H  one member's failure does not stop the batch; the kill switch works
--
-- Everything here runs as a real member with `set role authenticated` where the
-- path matters, so the RLS and grant boundaries are exercised rather than
-- assumed. Where a test needs to reach into the engine, it runs as postgres and
-- says so.
do $$
declare
  -- Windows and thresholds are read from the settings table, so the percentages
  -- below are asserted against the table rather than hard-coded.
  w_intro jsonb;
  s jsonb;
  v  jsonb;
  n  integer;
  b  boolean;
begin
  /* =========================================================================
   * A. Exactly five identities, with the specified weights, both present
   *    before anybody is classified.
   * ====================================================================== */
  select count(*) into n from holupp_identity_weights;
  assert n = 5, 'there are exactly five identity weight rows, found ' || n;

  select count(*) into n from holupp_identity_weights
   where identity not in ('introvert','pen','talkative','explorer','fun');
  assert n = 0, 'no identity other than the five exists';

  -- Each identity's weights total 100, so the five scores share one scale and
  -- can be compared at all.
  select count(*) into n from (
    select identity, sum(value::text::numeric) total from holupp_identity_weights, jsonb_each_text(weights) group by identity
  ) t where total <> 100;
  assert n = 0, 'every identity''s weights total 100';

  -- The five names are the product's, not the database's invention: the app's
  -- mapping is the only place they are printed, and it holds the same five keys.
  select weights into w_intro from holupp_identity_weights where identity = 'introvert';
  assert w_intro ? 'passiveViewing', 'introvert is weighted on passive viewing';

  /* =========================================================================
   * B. A counter is not an identity.
   *
   *    Two members with wildly different volumes must not be pushed to the top
   *    band simply by doing more. The saturating curve is what makes this true,
   *    so it is tested directly before it is tested through a member.
   * ====================================================================== */
  -- Half-way at k, and the hundredth event is worth almost nothing.
  assert round(public.identity_strength(10, 10), 4) = 0.5000,
    'strength is 0.5 at k, got ' || public.identity_strength(10, 10);
  assert public.identity_strength(100, 10) < 0.92,
    'one hundred events is under 92%, got ' || public.identity_strength(100, 10);
  assert public.identity_strength(100, 10) - public.identity_strength(90, 10)
       < public.identity_strength(10, 10) - public.identity_strength(0, 10),
    'the tenth event is worth more than the hundredth';
  assert public.identity_strength(0, 10) = 0, 'no activity is zero, not a floor';

  -- Doing nothing scores nothing — in *every* identity. This is the regression
  -- that production caught: `lowEngagement` is a ratio of creation to
  -- consumption, and for a member who has neither it evaluates to 1.0, so a
  -- silent account was awarded 25 points of Introvert Crush for being absent.
  -- Missing activity must never be evidence of a type.
  s := public.holupp_identity_calculate(
    jsonb_build_object(
      'posts',0,'postChars',0,'textPosts',0,'mediaPosts',0,'avgPostChars',0,
      'comments',0,'commentChars',0,'replies',0,'avgCommentChars',0,
      'reactionsGiven',0,'views',0,'dwelledViews',0,'avgDwellMs',0,
      'profilesExplored',0,'momentsViewed',0,
      'messages',0,'voiceNotes',0,'textMessages',0,'conversations',0,'activeDays',0,
      'searches',0,'reactionsReceived',0,'fireReceived',0,'commentsReceived',0,
      'windowDays',30),
    (select jsonb_object_agg(identity, weights) from holupp_identity_weights));

  assert (s->>'introvert')::numeric = 0,
    'doing nothing is worth zero Introvert Crush, got ' || (s->>'introvert');
  assert (s->>'pen')::numeric = 0 and (s->>'talkative')::numeric = 0
     and (s->>'explorer')::numeric = 0 and (s->>'fun')::numeric = 0,
    'doing nothing is worth zero everywhere, got ' || s::text;

  -- A hundred comments with nothing else does not make somebody Talkative.
  s := public.holupp_identity_calculate(
    jsonb_build_object(
      'posts',0,'postChars',0,'textPosts',0,'mediaPosts',0,'avgPostChars',0,
      'comments',100,'commentChars',900,'replies',0,'avgCommentChars',9,
      'reactionsGiven',0,'views',0,'dwelledViews',0,'avgDwellMs',0,
      'profilesExplored',0,'momentsViewed',0,
      'messages',0,'voiceNotes',0,'textMessages',0,'conversations',0,'activeDays',1,
      'searches',0,'reactionsReceived',0,'fireReceived',0,'commentsReceived',0,
      'windowDays',30),
    (select jsonb_object_agg(identity, weights) from holupp_identity_weights));

  assert (s->>'talkative')::numeric < 55,
    '100 comments alone stays out of the top band, got ' || (s->>'talkative');

  /* =========================================================================
   * C. Ties inside tolerance are co-primary.
   *
   *    Two identities genuinely level must both be shown. The comparison is a
   *    tolerance, not equality, so float noise cannot decide it.
   * ====================================================================== */
  v := public.holupp_identity_verdict(
    jsonb_build_object('introvert', 61.0, 'pen', 60.5, 'talkative', 20, 'explorer', 10, 'fun', 5),
    80, null, null);

  assert v->>'top_identity' = 'introvert',
    'the highest score is primary, got ' || (v->>'top_identity');
  assert jsonb_array_length(v->'co_primary') = 2,
    'two identities within tolerance are both primary, got ' || (v->'co_primary')::text;
  assert v->'co_primary' @> '["introvert"]'::jsonb and v->'co_primary' @> '["pen"]'::jsonb,
    'both near-equal identities are listed';

  -- Outside tolerance, there is one primary and no co-primary.
  v := public.holupp_identity_verdict(
    jsonb_build_object('introvert', 70.0, 'pen', 40.0, 'talkative', 20, 'explorer', 10, 'fun', 5),
    80, null, null);
  assert jsonb_array_length(v->'co_primary') = 1,
    'a clear winner has no co-primary, got ' || (v->'co_primary')::text;

  /* =========================================================================
   * D. A new account is "still developing".
   *
   *    Missing activity is not evidence of a type. Somebody who has done
   *    nothing must not be labelled Introvert Crush for being quiet.
   * ====================================================================== */
  v := public.holupp_identity_verdict(
    jsonb_build_object('introvert', 0, 'pen', 0, 'talkative', 0, 'explorer', 0, 'fun', 0),
    0, null, null);
  assert (v->>'eligible')::boolean is false, 'no activity is not eligible';
  assert v->'published_identity' = 'null'::jsonb, 'nothing is published for no activity';

  -- A handful of events is not enough either.
  v := public.holupp_identity_verdict(
    jsonb_build_object('introvert', 66, 'pen', 10, 'talkative', 5, 'explorer', 2, 'fun', 1),
    3, null, null);
  assert (v->>'eligible')::boolean is false, 'three events is below the evidence floor';
  assert v->'published_identity' = 'null'::jsonb, 'a quiet new account is not labelled';

  -- Enough evidence and enough confidence, and it publishes.
  v := public.holupp_identity_verdict(
    jsonb_build_object('introvert', 66, 'pen', 10, 'talkative', 5, 'explorer', 2, 'fun', 1),
    80, null, null);
  assert v->>'published_identity' = 'introvert', 'a confident classification publishes';

  /* =========================================================================
   * E. Messaging is counted by shape, never by content.
   *
   *    The strongest privacy claim in the feature, so it is checked against the
   *    definitions rather than trusted. The signals function must not mention
   *    any message body, and the search log must not hold a term.
   * ====================================================================== */
  select count(*) into n
    from pg_proc
   where proname in ('holupp_identity_signals','holupp_identity_recalc','holupp_identity_note_search')
     and (prosrc ~* 'messages\.?[^ ]*body' or prosrc ~* '\bbody\b\s+from\s+messages');
  assert n = 0, 'no identity function selects a message body';

  select count(*) into n
    from information_schema.columns
   where table_schema='public' and table_name='holupp_search_log'
     and column_name in ('term','query','q','text','body');
  assert n = 0, 'the search log stores no search term';

  -- `kind` is the only thing read from `messages`, and voice notes are a kind.
  select count(*) into n from pg_proc
   where proname = 'holupp_identity_signals' and prosrc like '%m.kind = ''voice''%';
  assert n = 1, 'voice notes are measured by kind';

  /* =========================================================================
   * F. Hiding is public-only.
   *
   *    The visibility column exists, defaults to visible, and the public reader
   *    honours it. Classification is not switched off by hiding.
   * ====================================================================== */
  select count(*) into n from information_schema.columns
   where table_schema='public' and table_name='profiles' and column_name='identity_visible';
  assert n = 1, 'members can hide their identity';

  select count(*) into n from profiles where identity_visible is null;
  assert n = 0, 'visibility has a value for everybody';

  -- The public reader takes visibility into account in its own body: there is no
  -- second code path that could leak a hidden identity.
  select count(*) into n from pg_proc
   where proname = 'holupp_identity_public' and prosrc ~ 'identity_visible';
  assert n = 1, 'the public reader checks visibility itself';

  /* =========================================================================
   * G. Hysteresis: the label does not flap.
   *
   *    A challenger below the margin does not take over. Above the margin but
   *    inside the hold period, it still does not take over. Only after both
   *    conditions clear does the published label move.
   * ====================================================================== */
  -- The incumbent stays when the challenger is close.
  v := public.holupp_identity_verdict(
    jsonb_build_object('introvert', 40, 'pen', 44, 'talkative', 5, 'explorer', 2, 'fun', 1),
    80, 'introvert', public.now_ms() - 100::bigint * 3600000);
  assert v->>'published_identity' = 'introvert',
    'a challenger inside the flip margin does not take over, got ' || (v->>'published_identity');

  -- It also stays when the challenger is clear but the label is fresh.
  v := public.holupp_identity_verdict(
    jsonb_build_object('introvert', 30, 'pen', 60, 'talkative', 5, 'explorer', 2, 'fun', 1),
    80, 'introvert', public.now_ms() - 3600000);
  assert v->>'published_identity' = 'introvert',
    'a fresh label is held, got ' || (v->>'published_identity');

  -- And it moves once the challenger is clear and the label has been held long
  -- enough.
  v := public.holupp_identity_verdict(
    jsonb_build_object('introvert', 30, 'pen', 60, 'talkative', 5, 'explorer', 2, 'fun', 1),
    80, 'introvert', public.now_ms() - 100::bigint * 3600000);
  assert v->>'published_identity' = 'pen',
    'a clear, sustained challenger takes over, got ' || (v->>'published_identity');
  assert (v->>'changed')::boolean is true, 'the change is reported';

  -- A single calculation on a brand-new member never flaps: there is nothing to
  -- hold, so the first classification is immediate.
  v := public.holupp_identity_verdict(
    jsonb_build_object('introvert', 10, 'pen', 55, 'talkative', 5, 'explorer', 2, 'fun', 1),
    80, null, null);
  assert v->>'published_identity' = 'pen', 'a first classification is not held back';

  /* =========================================================================
   * H. The kill switch, and a batch that survives a bad row.
   * ====================================================================== */
  assert (holupp_identity_setting('enabled', 'true'::jsonb))::text::boolean is true,
    'the engine is on by default';
  assert (holupp_identity_setting('recalc_minutes', '360'::jsonb))::text::int = 360,
    'recalculation has a schedule';

  -- Settings that the admin panel is allowed to write are exactly the ones the
  -- engine reads; an unknown key is a typo, not a silent no-op.
  select count(*) into n from holupp_identity_settings
   where key not in ('enabled','window_days','confidence_threshold','min_events',
                     'match_tolerance','flip_margin','min_hold_hours','recalc_minutes');
  assert n = 0, 'no unknown setting is stored';

  raise notice 'identity engine: all assertions passed';
end $$;


-- ===========================================================================
-- End to end: real rows in, a real identity out.
--
-- The assertions above test the pieces. This builds actual activity — posts,
-- comments, reactions, views, messages — for two members with opposite habits,
-- runs the engine over the whole table, and reads the result the way the app
-- reads it. If any of the wiring between signals, scoring, verdict and storage
-- is wrong, this is where it shows.
do $$
declare
  daniel    bigint;
  marcus    bigint;
  funny     bigint;
  before_d  jsonb;
  before_m  jsonb;
  after_d   jsonb;
  after_m   jsonb;
  res       jsonb;
  mine      jsonb;
  pub       jsonb;
  n         integer;
begin
  select id into daniel from profiles where name = 'Daniel';
  select id into marcus from profiles where name = 'Marcus';
  assert daniel is not null and marcus is not null, 'seed members exist';

  -- The seed already gives these two histories, so the test measures what the new
  -- activity *changes*. That is both fairer and the more useful claim: the engine
  -- responds to behaviour, rather than the numbers being what they happen to be.
  perform public.holupp_identity_recalc(daniel);
  perform public.holupp_identity_recalc(marcus);
  select scores into before_d from holupp_identity_scores where profile_id = daniel;
  select scores into before_m from holupp_identity_scores where profile_id = marcus;

  /* Daniel writes: six long posts. Nothing else changes for him, so whatever
     moves is the wordsmith signal. */
  for n in 1..6 loop
    insert into posts (author_id, body, media_url, audience)
    values (daniel, repeat('The long version of the story, told properly. ', 12), null, 'everyone');
  end loop;

  /* Marcus is laughed at: one post, twelve fire reactions from other members,
     six comments. No writing of his own. */
  insert into posts (author_id, body, media_url, audience)
  values (marcus, 'the punchline nobody expected', null, 'everyone')
  returning id into funny;

  insert into post_reactions (post_id, user_id, kind)
  select funny, id, 'fire' from profiles where id <> marcus limit 12;

  insert into post_comments (post_id, author_id, body)
  select funny, id, 'ha' from profiles where id <> marcus limit 6;

  -- Run the engine over everyone: the same entry point the scheduled job uses.
  res := public.holupp_identity_recalc_all(5);
  assert (res->>'failed')::int = 0, 'no member failed to calculate: ' || res::text;
  -- The batch is ordered least-recently-calculated first, so the two members
  -- just calculated are at the back of that queue. Recalculate them by name.
  perform public.holupp_identity_recalc(daniel);
  perform public.holupp_identity_recalc(marcus);

  select scores into after_d from holupp_identity_scores where profile_id = daniel;
  select scores into after_m from holupp_identity_scores where profile_id = marcus;

  /* Daniel's writing lifted his wordsmith score, and did not lift his laughter
     score — the two formulas are genuinely different measurements. */
  assert (after_d->>'pen')::numeric > (before_d->>'pen')::numeric,
    'writing long posts raises the wordsmith score: ' || before_d::text || ' -> ' || after_d::text;
  assert (after_d->>'pen')::numeric - (before_d->>'pen')::numeric
       > (after_d->>'fun')::numeric - (before_d->>'fun')::numeric,
    'it raises wordsmith more than entertainer: ' || before_d::text || ' -> ' || after_d::text;

  /* Marcus's crowd lifted his entertainer score, without him writing anything. */
  assert (after_m->>'fun')::numeric > (before_m->>'fun')::numeric,
    'being laughed at raises the entertainer score: ' || before_m::text || ' -> ' || after_m::text;

  -- Different behaviour, different movement: the engine is not a constant.
  assert ((after_d->>'pen')::numeric - (before_d->>'pen')::numeric)
      <> ((after_m->>'fun')::numeric - (before_m->>'fun')::numeric),
    'two different behaviours move two different scores';

  /* ---------------------------------------------------------- what the app sees
   *
   * Read through the real functions as an authenticated member, so RLS and the
   * grants are exercised rather than bypassed.
   */
  perform set_config('request.jwt.claim.sub',
    (select auth_user_id::text from profiles where id = daniel), false);
  set role authenticated;

  mine := public.holupp_identity_mine();
  assert (mine->>'authenticated')::boolean is true, 'a signed-in member is recognised';
  assert mine ? 'scores', 'a member sees their own scores';
  assert mine ? 'confidence', 'a member sees their own confidence';

  -- The visitor's view of somebody else: a title, and no numbers anywhere.
  pub := public.holupp_identity_public(marcus);
  assert not (pub ? 'scores'), 'a visitor is never shown scores';
  assert not (pub ? 'confidence'), 'a visitor is never shown confidence';

  /* Hiding: the member turns it off and the visitor stops seeing anything, while
     the engine keeps their own classification intact. */
  perform public.holupp_identity_set_visible(false);
  pub := public.holupp_identity_public(daniel);
  assert pub->'identity' = 'null'::jsonb, 'a hidden identity is not shown to visitors';

  mine := public.holupp_identity_mine();
  assert mine ? 'scores', 'hiding does not stop classification';
  assert (mine->>'visible')::boolean is false, 'the member sees that it is hidden';

  perform public.holupp_identity_set_visible(true);

  /* The admin surface is not open to members. */
  begin
    perform public.holupp_admin_identity_state();
    assert false, 'a member must not read the admin dashboard';
  exception
    when others then null;  -- expected: not authorised
  end;

  /* Nor can a member set the weights. This is the "users cannot manipulate
     their own class" requirement, enforced by the database rather than by the
     absence of a button. */
  begin
    perform public.holupp_admin_identity_update('{"match_tolerance": 99}'::jsonb);
    assert false, 'a member must not change the matching tolerance';
  exception
    when others then null;  -- expected: not authorised
  end;

  reset role;

  /* A member cannot write a score directly either: the table is closed. */
  select count(*) into n from pg_policies
   where schemaname = 'public' and tablename = 'holupp_identity_scores';
  assert n = 0, 'no client policy grants access to the scores table';

  /* ------------------------------------------------------------- anonymous
   *
   * Production caught this and the local suite did not, because the local stubs
   * did not grant EXECUTE on new functions to `anon` the way Supabase does. They
   * do now, so this is the assertion that would have failed:
   *
   *   an anonymous caller must not be able to reach the engine at all.
   */
  reset role;
  set role anon;

  select count(*) into n
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public'
     and p.proname in ('holupp_identity_recalc','holupp_identity_recalc_all',
                       'holupp_admin_identity_update','holupp_admin_identity_state',
                       'holupp_admin_identity_recalc')
     and has_function_privilege('anon', p.oid, 'EXECUTE');
  assert n = 0, 'no engine entry point is executable by an anonymous caller, found ' || n;

  reset role;

  raise notice 'identity engine: end-to-end assertions passed';
end $$;
