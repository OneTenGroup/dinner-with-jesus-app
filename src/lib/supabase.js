import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://mvswwnonafjencqumxvv.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im12c3d3bm9uYWZqZW5jcXVteHZ2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE5OTQ2MTcsImV4cCI6MjA5NzU3MDYxN30.PgusR7A8uYZMEZ1_vbsfW0ksPen1hvzICIuviPPBdWM'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
