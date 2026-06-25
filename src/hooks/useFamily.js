import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

export function useFamily() {
  const { user } = useAuth()
  const [family, setFamily] = useState(null)
  const [members, setMembers] = useState([])
  const [allFamilies, setAllFamilies] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!user) {
      setMembers([])
      setFamily(null)
      setAllFamilies([])
      setLoading(false)
      return
    }

    loadFamily()

    // Real-time — reload whenever anyone joins or leaves
    const subscription = supabase
      .channel(`family_members_changes_${user.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'family_members'
      }, () => {
        loadFamily()
      })
      .subscribe()

    return () => supabase.removeChannel(subscription)
  }, [user])

  async function loadFamily() {
    if (!user?.id) return
    setLoading(true)
    try {
      // Get all tables this user belongs to
      const { data: memberData } = await supabase
        .from('family_members')
        .select('family_id, role')
        .eq('user_id', user.id)

      if (memberData && memberData.length > 0) {
        const familyIds = memberData.map(m => m.family_id)

        const { data: familyData } = await supabase
          .from('families')
          .select('id, name, invite_code')
          .in('id', familyIds)

        // Enrich with role
        const enriched = (familyData || []).map(f => ({
          ...f,
          role: memberData.find(m => m.family_id === f.id)?.role || 'member'
        }))

        // Host tables first
        enriched.sort((a, b) => {
          if (a.role === 'host' && b.role !== 'host') return -1
          if (a.role !== 'host' && b.role === 'host') return 1
          return 0
        })

        setAllFamilies(enriched)

        // Check if user has an active_family_id set
        const { data: profileData } = await supabase
          .from('profiles')
          .select('active_family_id')
          .eq('id', user.id)
          .single()

        // Active table = explicitly set active_family_id, else host table, else first table
        let active = null
        if (profileData?.active_family_id) {
          active = enriched.find(f => f.id === profileData.active_family_id)
        }
        if (!active) {
          active = enriched.find(f => f.role === 'host') || enriched[0]
        }

        if (active) {
          const { data: allMembers } = await supabase
            .from('family_members')
            .select('display_name, prayer_order, role, user_id')
            .eq('family_id', active.id)
            .order('prayer_order')

          setFamily({
            id: active.id,
            name: active.name,
            invite_code: active.invite_code,
            role: active.role
          })
          setMembers(allMembers?.map(m => m.display_name) || [])
        }
      } else {
        setFamily(null)
        setAllFamilies([])
        setMembers([])
      }
    } catch (err) {
      setMembers([])
    }
    setLoading(false)
  }

  async function switchTable(familyId) {
    try {
      await supabase
        .from('profiles')
        .update({ active_family_id: familyId })
        .eq('id', user.id)
      await loadFamily()
    } catch (err) {}
  }

  return { family, members, allFamilies, loading, reload: loadFamily, switchTable }
}
