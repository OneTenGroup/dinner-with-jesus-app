import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext({})

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      if (session?.user) fetchProfile(session.user.id)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      setUser(session?.user ?? null)
      if (session?.user) await fetchProfile(session.user.id)
      else setProfile(null)
    })

    return () => subscription.unsubscribe()
  }, [])

  async function fetchProfile(userId) {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()
    if (data) setProfile(data)
  }

  async function signUp(email, password, name) {
    // emailRedirectTo must be explicit -- without it, Supabase falls back to
    // the project's dashboard-configured default Site URL, which may be
    // stale or unset. window.location.origin always matches whatever
    // origin actually served this signup (prod, preview, or local dev),
    // same pattern as the invite link in TablePage.jsx.
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { name }, emailRedirectTo: window.location.origin }
    })
    return { data, error }
  }

  async function signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    return { data, error }
  }

  async function signOut() {
    await supabase.auth.signOut()
  }

  async function deleteAccount() {
    // delete_own_account() is a SECURITY DEFINER RPC (see
    // 20260726000001_self_service_account_deletion.sql) -- ordinary
    // authenticated roles have no grant on auth.users directly, so
    // this can only happen server-side. Auto-transfers or archives any
    // group the caller owns, then deletes their own account; can never
    // affect another user's account (auth.uid() is the only identity
    // source).
    const { error } = await supabase.rpc('delete_own_account')
    if (error) return { error: error.message || 'Could not delete account' }
    await supabase.auth.signOut()
    return { success: true }
  }

  async function updateProfile(updates) {
    const { error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', user.id)
    if (!error) setProfile(prev => ({ ...prev, ...updates }))
    return { error }
  }

  return (
    <AuthContext.Provider value={{
      user, profile, loading,
      signUp, signIn, signOut, updateProfile, deleteAccount,
      refreshProfile: () => fetchProfile(user?.id)
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
