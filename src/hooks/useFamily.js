import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

export function useFamily() {
  const { user } = useAuth()
  const [family, setFamily] = useState(null)
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (user) {
      loadFamily()
    } else {
      setMembers([])
      setLoading(false)
    }
  }, [user])

  async function loadFamily() {
    setLoading(true)
    try {
      // Get ALL families this user belongs to
      const { data: memberData } = await supabase
        .from('family_members')
        .select('family_id')
        .eq('user_id', user.id)

      if (memberData && memberData.length > 0) {
        // Use the first family as primary
        const primaryFamilyId = memberData[0].family_id

        // Get ALL members from the primary family
        const { data: allMembers } = await supabase
          .from('family_members')
          .select('display_name, prayer_order')
          .eq('family_id', primaryFamilyId)
          .order('prayer_order')

        setFamily({ id: primaryFamilyId })
        setMembers(allMembers?.map(m => m.display_name) || [])
      } else {
        setFamily(null)
        setMembers([])
      }
    } catch (err) {
      setMembers([])
    }
    setLoading(false)
  }

  return { family, members, loading, reload: loadFamily }
}
