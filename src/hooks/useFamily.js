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

    // Real-time subscription — reload whenever family_members changes
    const subscription = supabase
      .channel('family_members_changes')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'family_members'
      }, () => {
        loadFamily()
      })
      .subscribe()

    return () => {
      supabase.removeChannel(subscription)
    }
  }, [user])

  async function loadFamily() {
    if (!user?.id) return
    setLoading(true)
    try {
      // Get ALL families this user belongs to with role
      const { data: memberData } = await supabase
        .from('family_members')
        .select('family_id, role')
        .eq('user_id', user.id)

      if (memberData && memberData.length > 0) {
        const familyIds = memberData.map(m => m.family_id)

        // Load all family details
        const { data: familyData } = await supabase
          .from('families')
          .select('id, name, invite_code')
          .in('id', familyIds)

        // Enrich with role
        const enriched = (familyData || []).map(f => ({
          ...f,
          role: memberData.find(m => m.family_id === f.id)?.role || 'member'
        }))

        // Sort: owner families first, then member families
        enriched.sort((a, b) => {
          if (a.role === 'owner' && b.role !== 'owner') return -1
          if (a.role !== 'owner' && b.role === 'owner') return 1
          return 0
        })

        setAllFamilies(enriched)

        // Primary family = first owner family, fallback to first member family
        const primary = enriched.find(f => f.role === 'owner') || enriched[0]

        if (primary) {
          // Load ALL members of the primary family
          const { data: allMembers } = await supabase
            .from('family_members')
            .select('display_name, prayer_order, role, user_id')
            .eq('family_id', primary.id)
            .order('prayer_order')

          setFamily({
            id: primary.id,
            name: primary.name,
            invite_code: primary.invite_code,
            role: primary.role
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

  return { family, members, allFamilies, loading, reload: loadFamily }
}
