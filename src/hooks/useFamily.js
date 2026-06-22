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
      const { data: memberData } = await supabase
        .from('family_members')
        .select('family_id')
        .eq('user_id', user.id)
        .single()

      if (memberData?.family_id) {
        const { data: allMembers } = await supabase
          .from('family_members')
          .select('display_name, prayer_order')
          .eq('family_id', memberData.family_id)
          .order('prayer_order')

        setFamily({ id: memberData.family_id })
        setMembers(allMembers?.map(m => m.display_name) || [])
      } else {
        setMembers([])
      }
    } catch (err) {
      setMembers([])
    }
    setLoading(false)
  }

  return { family, members, loading, reload: loadFamily }
}
