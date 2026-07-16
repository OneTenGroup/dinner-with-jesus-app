import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

export function useFamily() {
  const { user } = useAuth()
  const [group, setGroup] = useState(null)
  const [members, setMembers] = useState([])
  const [memberProfiles, setMemberProfiles] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!user) {
      setGroup(null)
      setMembers([])
      setMemberProfiles([])
      setLoading(false)
      return
    }
    loadGroup()
  }, [user])

  async function loadGroup() {
    if (!user?.id) return
    setLoading(true)
    try {
      const { data: profileData } = await supabase
        .from('profiles')
        .select('group_id')
        .eq('id', user.id)
        .single()

      const groupId = profileData?.group_id

      if (!groupId) {
        setGroup(null)
        setMembers([])
        setMemberProfiles([])
        setLoading(false)
        return
      }

      const { data: groupData } = await supabase
        .from('groups')
        .select('id, name, invite_code, owner_id, timezone')
        .eq('id', groupId)
        .single()

      if (!groupData) {
        setGroup(null)
        setMembers([])
        setMemberProfiles([])
        setLoading(false)
        return
      }

      // get_my_group_members() is a SECURITY DEFINER RPC (see
      // 20260714000001_security_primitives.sql) -- profiles has no
      // same-group SELECT policy, since that would expose every
      // member's email to every other member. This returns only id+name.
      const { data: groupMembers } = await supabase.rpc('get_my_group_members')

      setGroup({
        id: groupData.id,
        name: groupData.name,
        invite_code: groupData.invite_code,
        timezone: groupData.timezone,
        isOwner: groupData.owner_id === user.id
      })
      setMembers(groupMembers?.map(p => p.name).filter(Boolean) || [])
      setMemberProfiles(groupMembers || [])

    } catch (err) {
      setGroup(null)
      setMembers([])
      setMemberProfiles([])
    }
    setLoading(false)
  }

  async function createGroup(name) {
    if (!user?.id) return { error: 'Not logged in' }
    try {
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
      let code = ''
      for (let i = 0; i < 6; i++) code += chars.charAt(Math.floor(Math.random() * chars.length))

      // Default the family/table timezone to the owner's own device
      // timezone at creation time -- Intl.DateTimeFormat is the
      // standard, reliable way to read it. If detection fails for any
      // reason, omit the field entirely and let the database's own
      // NOT NULL DEFAULT ('America/Chicago', a documented migration
      // fallback -- see 20260714000004_shared_dinner_session.sql)
      // apply. Every group's timezone -- detected or defaulted -- is
      // still validated server-side by a CHECK constraint regardless
      // of what's sent here.
      let detectedTimezone
      try {
        detectedTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone
      } catch (tzErr) {
        detectedTimezone = undefined
      }

      const { data: newGroup, error: groupError } = await supabase
        .from('groups')
        .insert({
          name: name.trim(),
          invite_code: code,
          owner_id: user.id,
          ...(detectedTimezone ? { timezone: detectedTimezone } : {})
        })
        .select('id, name, invite_code')
        .single()

      if (groupError || !newGroup) return { error: 'Could not create group' }

      const { error: profileError } = await supabase
        .from('profiles')
        .update({ group_id: newGroup.id })
        .eq('id', user.id)

      if (profileError) return { error: 'Group created but could not join it' }

      await loadGroup()
      return { success: true, group: newGroup }
    } catch (err) {
      return { error: 'Something went wrong' }
    }
  }

  async function joinGroup(inviteCode) {
    if (!user?.id) return { error: 'Not logged in' }
    try {
      // join_group_by_invite_code() is a SECURITY DEFINER RPC (see
      // 20260714000001_security_primitives.sql) -- authenticated users
      // have no standing SELECT on groups.invite_code, since that would
      // let anyone enumerate every group's code. The RPC does the
      // lookup server-side and updates only the caller's own group_id.
      const { data, error } = await supabase.rpc('join_group_by_invite_code', {
        invite_code_input: inviteCode
      })

      if (error || !data || data.length === 0) return { error: 'Code not found. Check and try again.' }

      await loadGroup()
      return { success: true, groupName: data[0].group_name }
    } catch (err) {
      return { error: 'Something went wrong' }
    }
  }

  async function leaveGroup() {
    if (!user?.id) return { error: 'Not logged in' }
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ group_id: null })
        .eq('id', user.id)

      if (error) return { error: 'Could not leave group' }

      await loadGroup()
      return { success: true }
    } catch (err) {
      return { error: 'Something went wrong' }
    }
  }

  async function removeMember(memberId) {
    if (!user?.id || !group?.isOwner) return { error: 'Not authorized' }
    try {
      // remove_group_member() is a SECURITY DEFINER RPC (see
      // 20260714000001_security_primitives.sql) -- it verifies
      // ownership server-side and touches only the target's group_id,
      // never any other profile column. A plain client-side update to
      // another user's profiles row has no policy permitting it once
      // baseline RLS is applied.
      const { error } = await supabase.rpc('remove_group_member', {
        member_id_input: memberId
      })

      if (error) return { error: 'Could not remove member' }

      await loadGroup()
      return { success: true }
    } catch (err) {
      return { error: 'Something went wrong' }
    }
  }

  return {
    group,
    members,
    memberProfiles,
    loading,
    reload: loadGroup,
    createGroup,
    joinGroup,
    leaveGroup,
    removeMember,
    family: group,
    allFamilies: group ? [group] : [],
    switchTable: () => {}
  }
}
