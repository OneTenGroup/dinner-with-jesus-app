import { supabase } from './supabase'

/**
 * Track an analytics event
 * @param {string} event - Event name e.g. 'table_opened'
 * @param {object} metadata - Optional extra data
 */
export async function track(event, metadata = {}) {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return // Don't track unauthenticated events

    await supabase.from('analytics').insert({
      user_id: user.id,
      event,
      metadata
    })
  } catch (err) {
    // Analytics should never break the app — fail silently
    console.warn('Analytics error:', err)
  }
}
