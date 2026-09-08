// Mirrors public.resolve_current_turn() in
// 20260809000003_individual_prayed_members_tracking.sql exactly. Every
// direct RPC response (loadVerse, nextPrayer, toggleAbsent) uses the
// server's OWN resolved current/next-turn values instead of this --
// Realtime's postgres_changes payload only carries the raw row
// (prayer_order/absent_members/prayed_members/rotation_advanced), not
// those server-computed fields, so this exists solely to interpret an
// incoming Realtime update the same way the server would. Identity-based
// (who's in prayed_members/absent_members), never a scalar position --
// that's what makes a returning absent member resolve correctly here too.
//
// Extracted from TablePage.jsx (2026-09-08) so it has a direct test
// suite (prayerRotation.test.js) -- the SQL side of this exact
// resolution logic has regressed silently once before (self-heal logic
// dropped by a later `create or replace` on 2026-07-19, unnoticed until
// 2026-07-24); this file existing separately from the component makes
// the JS mirror of that contract checkable in CI instead of only by
// manual pg_proc inspection.
export function resolveCurrentTurn(prayerOrder, absentMembers, prayedMembers) {
  for (const id of prayerOrder) {
    if (!prayedMembers.includes(id) && !absentMembers.includes(id)) return id
  }
  return null
}
