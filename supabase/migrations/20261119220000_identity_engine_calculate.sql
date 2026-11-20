-- holupp_identity_engine — the calculation
--
-- Depends on 20261119200000 and 20261119210000.
--
-- Everything here is pure: given signals and weights, produce five scores. The
-- only side effects are in holupp_identity_recalc(), which calls this.

-- Saturating strength: 0 at nothing, 0.5 at k, never reaches 1.
-- Written out as SQL so it can be unit-tested on its own.
create or replace function public.identity_strength(p_n numeric, p_k numeric)
returns numeric
language sql
immutable
as $function$
  select case
    when coalesce(p_n, 0) <= 0 then 0::numeric
    else round(coalesce(p_n, 0)::numeric / (coalesce(p_n, 0)::numeric + greatest(p_k, 1)), 4)
  end;
$function$;

-- Consistency across the window: active days out of the days available, with a
-- soft ceiling at 60%. A burst of forty comments in one evening scores near 0
-- here and cannot carry Fun Crusher or Talkative Crush on its own.
create or replace function public.identity_consistency(p_active_days numeric, p_window_days numeric)
returns numeric
language sql
immutable
as $function$
  select public.identity_strength(coalesce(p_active_days, 0), greatest(coalesce(p_window_days, 30) * 0.6, 1));
$function$;

-- Recency: recent activity counts more than old activity, so an identity can
-- move as a member changes, without an old spike holding the label hostage.
-- p_days_ago of 0 → 1.0, 30 → ~0.43, 60 → ~0.2.
create or replace function public.identity_recency(p_days_ago numeric)
returns numeric
language sql
immutable
as $function$
  select round(1.0 / (1.0 + greatest(coalesce(p_days_ago, 0), 0) / 30.0), 4);
$function$;

-- The five formulas. Each component returns 0..1 and is multiplied by its
-- weight, which is a percentage; the sum is therefore 0..100.
create or replace function public.holupp_identity_calculate(p_signals jsonb, p_weights jsonb)
returns jsonb
language plpgsql
immutable
as $function$
declare
  s              jsonb := coalesce(p_signals, '{}'::jsonb);
  w_intro        jsonb := coalesce(p_weights->'introvert', '{}'::jsonb);
  w_pen          jsonb := coalesce(p_weights->'pen',       '{}'::jsonb);
  w_talk         jsonb := coalesce(p_weights->'talkative', '{}'::jsonb);
  w_explore      jsonb := coalesce(p_weights->'explorer',  '{}'::jsonb);
  w_fun          jsonb := coalesce(p_weights->'fun',       '{}'::jsonb);

  v_posts        numeric := (s->>'posts')::numeric;
  v_media_posts  numeric := (s->>'mediaPosts')::numeric;
  v_text_posts   numeric := (s->>'textPosts')::numeric;
  v_avg_post     numeric := (s->>'avgPostChars')::numeric;
  v_comments     numeric := (s->>'comments')::numeric;
  v_avg_comment  numeric := (s->>'avgCommentChars')::numeric;
  v_replies      numeric := (s->>'replies')::numeric;
  v_reactions    numeric := (s->>'reactionsGiven')::numeric;
  v_views        numeric := (s->>'views')::numeric;
  v_dwelled      numeric := (s->>'dwelledViews')::numeric;
  v_avg_dwell    numeric := (s->>'avgDwellMs')::numeric;
  v_profiles     numeric := (s->>'profilesExplored')::numeric;
  v_moments      numeric := (s->>'momentsViewed')::numeric;
  v_messages     numeric := (s->>'messages')::numeric;
  v_voice        numeric := (s->>'voiceNotes')::numeric;
  v_text_msgs    numeric := (s->>'textMessages')::numeric;
  v_convs        numeric := (s->>'conversations')::numeric;
  v_active_days  numeric := (s->>'activeDays')::numeric;
  v_searches     numeric := (s->>'searches')::numeric;
  v_rx_received  numeric := (s->>'reactionsReceived')::numeric;
  v_fire         numeric := (s->>'fireReceived')::numeric;
  v_comments_rx  numeric := (s->>'commentsReceived')::numeric;
  v_window       numeric := greatest(coalesce((s->>'windowDays')::numeric, 30), 7);

  c_intro   numeric := 0; c_pen numeric := 0; c_talk numeric := 0;
  c_explore numeric := 0; c_fun numeric := 0;
  out jsonb;
begin
  -- ── Introvert Crush: the quiet observer ────────────────────────────────
  -- Watching without speaking. `lowEngagement` is the pass/fail the brief
  -- describes — a low share of content *created* against content *consumed*.
  -- It is a ratio, not a count, so a heavy consumer who also posts a little is
  -- judged on proportion rather than volume.
  c_intro :=
      coalesce((w_intro->>'passiveViewing')::numeric, 0)      * public.identity_strength(v_dwelled, 8)
    -- A ratio only means something when somebody actually watched. `create /
    -- consume` is 1.0 for a member who has done nothing at all, so taken alone it
    -- paid 25 points for silence — the one thing the brief says must never
    -- happen ("missing activity is not evidence of a type"). Multiplying by how
    -- much they actually consumed means the ratio rewards *watching quietly*,
    -- and nothing at all rewards nothing at all.
    + coalesce((w_intro->>'lowEngagement')::numeric, 0)       * (
        case when (v_views + v_posts + v_comments) = 0 then 0
             else greatest(0, 1 - ((v_posts + v_comments) / nullif(v_views + v_posts + v_comments, 0)))
                  * public.identity_strength(v_views, 10) end
      )
    + coalesce((w_intro->>'postingFrequency')::numeric, 0)    * public.identity_strength(v_media_posts, 10)
    + coalesce((w_intro->>'publicInteraction')::numeric, 0)   * public.identity_strength(v_reactions, 15)
    + coalesce((w_intro->>'communicationReserve')::numeric, 0) * public.identity_strength(v_voice, 6);

  -- ── Pen Crusher: the wordsmith ──────────────────────────────────────────
  -- Volume of written words matters, but length is judged per post, not in
  -- total: ten 500-word posts is a wordsmith, a thousand two-word captions is
  -- not. Taken uncapped a text-wall would max this out, so avgPostChars
  -- saturates at 600.
  c_pen :=
      coalesce((w_pen->>'textPostFrequency')::numeric, 0)   * public.identity_strength(v_text_posts, 6)
    + coalesce((w_pen->>'writtenLength')::numeric, 0)       * public.identity_strength(v_avg_post, 400)
    + coalesce((w_pen->>'writtenComments')::numeric, 0)     * public.identity_strength(v_avg_comment, 160)
    + coalesce((w_pen->>'textConversations')::numeric, 0)   * public.identity_strength(v_text_msgs, 25)
    + coalesce((w_pen->>'expressionBreadth')::numeric, 0)   * public.identity_strength(v_posts + v_comments, 12);

  -- ── Talkative Crush: the conversationalist ──────────────────────────────
  -- Breadth beats depth: conversations and active days carry more than raw
  -- message count, so one marathon thread does not make someone Talkative.
  c_talk :=
      coalesce((w_talk->>'messaging')::numeric, 0)              * public.identity_strength(v_messages, 60)
    + coalesce((w_talk->>'voiceNotes')::numeric, 0)             * public.identity_strength(v_voice, 10)
    + coalesce((w_talk->>'commentsReplies')::numeric, 0)        * public.identity_strength(v_comments + v_replies, 12)
    + coalesce((w_talk->>'conversationParticipation')::numeric, 0) * public.identity_strength(v_convs, 5)
    + coalesce((w_talk->>'consistency')::numeric, 0)            * public.identity_consistency(v_active_days, v_window);

  -- ── Excrusher / Explorer: the curious mind ──────────────────────────────
  -- Only signals the platform can actually observe. Search is logged now;
  -- nothing is inferred from what was searched, only that it happened.
  c_explore :=
      coalesce((w_explore->>'searchDiscovery')::numeric, 0)     * public.identity_strength(v_searches, 8)
    + coalesce((w_explore->>'profileExploration')::numeric, 0)  * public.identity_strength(v_profiles, 12)
    + coalesce((w_explore->>'researchInteraction')::numeric, 0) * public.identity_strength(v_moments + v_views, 40)
    + coalesce((w_explore->>'informativePosts')::numeric, 0)    * public.identity_strength(v_text_posts + v_media_posts, 12)
    + coalesce((w_explore->>'discoverySharing')::numeric, 0)    * public.identity_strength(v_convs, 6);

  -- ── Fun Crusher: the entertainer ────────────────────────────────────────
  -- Judged partly on the response other people had. Laughter is other people's
  -- behaviour; a comedian nobody laughs at is not (yet) the Entertainer. The
  -- reaction ratio keeps this from becoming a popularity contest with a
  -- fixed ceiling on raw totals.
  c_fun :=
      coalesce((w_fun->>'humourEngagement')::numeric, 0)        * public.identity_strength(v_fire, 8)
    + coalesce((w_fun->>'funnyComments')::numeric, 0)           * public.identity_strength(v_comments_rx, 10)
    + coalesce((w_fun->>'entertainmentConversations')::numeric, 0) * public.identity_strength(v_convs, 6)
    + coalesce((w_fun->>'humorousPosts')::numeric, 0)           * public.identity_strength(v_media_posts, 8)
    + coalesce((w_fun->>'positiveReactions')::numeric, 0)       * public.identity_strength(v_rx_received, 25);

  c_intro   := round(least(greatest(c_intro, 0), 100), 1);
  c_pen     := round(least(greatest(c_pen, 0), 100), 1);
  c_talk    := round(least(greatest(c_talk, 0), 100), 1);
  c_explore := round(least(greatest(c_explore, 0), 100), 1);
  c_fun     := round(least(greatest(c_fun, 0), 100), 1);

  out := jsonb_build_object(
    'introvert', c_intro, 'pen', c_pen, 'talkative', c_talk,
    'explorer', c_explore, 'fun', c_fun
  );
  return out;
end;
$function$;
