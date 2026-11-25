-- =========================================================================
-- Abucay Guardian: Fix Row-Level Security (RLS) for public.family_members
--
-- Why this is needed:
-- When User A pairs with User B, the app establishes reciprocal family links:
--   1. Row 1: user_id = User A, member_user_id = User B
--   2. Row 2: user_id = User B, member_user_id = User A
--
-- Under a strict (auth.uid() = user_id) policy, inserting Row 2 is rejected
-- because auth.uid() is User A, but user_id is User B.
--
-- Allowing (auth.uid() = user_id OR auth.uid() = member_user_id) enables both
-- reciprocal linking and reverse query viewing while keeping data 100% private
-- between the two paired users.
-- =========================================================================

-- 1. Ensure RLS is enabled on the table
alter table public.family_members enable row level security;

-- 2. SELECT Policy: Allow viewing if user is either the owner or the linked relative
drop policy if exists "Users can view own family members" on public.family_members;
create policy "Users can view own family members" on public.family_members
  for select
  using (auth.uid() = user_id or auth.uid() = member_user_id);

-- 3. INSERT Policy: Allow inserting if user is the creator (user_id) or reciprocal relative (member_user_id)
drop policy if exists "Users can insert family members" on public.family_members;
create policy "Users can insert family members" on public.family_members
  for insert
  with check (auth.uid() = user_id or auth.uid() = member_user_id);

-- 4. UPDATE Policy: Allow updating if user is either party in the relationship
drop policy if exists "Users can update family members" on public.family_members;
create policy "Users can update family members" on public.family_members
  for update
  using (auth.uid() = user_id or auth.uid() = member_user_id);

-- 5. DELETE Policy: Allow deleting if user is either party in the relationship
drop policy if exists "Users can delete family members" on public.family_members;
create policy "Users can delete family members" on public.family_members
  for delete
  using (auth.uid() = user_id or auth.uid() = member_user_id);

-- Verify policies are active
select tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where tablename = 'family_members';
