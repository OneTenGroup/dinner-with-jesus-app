import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

export function useFamily() {
  const { user } = useAuth()
  const [group, setGroup] = useState(null)
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!user) {
      setGroup(null)
      setMembers([])
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
        setLoading(false)
        return
      }

      const { data: groupData } = await supabase
        .from('groups')
        .select('id, name, invite_code, owner_id')
        .eq('id', groupId)
        .single()

      if (!groupData) {
        setGroup(null)
        setMembers([])
        setLoading(false)
        return
      }

      const { data: memberProfiles } = await supabase
        .from('profiles')
        .select('name')
        .eq('group_id', groupId)

      setGroup({
        id: groupData.id,
        name: groupData.name,
        invite_code: groupData.invite_code,
        isOwner: groupData.owner_id === user.id
      })
      setMembers(memberProfiles?.map(p => p.name).filter(Boolean) || [])

    } catch (err) {
      setGroup(null)
      setMembers([])
    }
    setLoading(false)
  }

  async function createGroup(name) {
    if (!user?.id) return { error: 'Not logged in' }
    try {
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
      let code = ''
      for (let i = 0; i < 6; i++) code += chars.charAt(Math.floor(Math.random() * chars.length))

      const { data: newGroup, error: groupError } = await supabase
        .from('groups')
        .insert({ name: name.trim(), invite_code: code, owner_id: user.id })
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
      const { data: groupData, error } = await supabase
        .from('groups')
        .select('id, name')
        .eq('invite_code', inviteCode.toUpperCase())
        .single()

      if (error || !groupData) return { error: 'Code not found. Check and try again.' }

      const { error: profileError } = await supabase
        .from('profiles')
        .update({ group_id: groupData.id })
        .eq('id', user.id)

      if (profileError) return { error: 'Could not join group' }

      await loadGroup()
      return { success: true, groupName: groupData.name }
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
      const { error } = await supabase
        .from('profiles')
        .update({ group_id: null })
        .eq('id', memberId)

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
