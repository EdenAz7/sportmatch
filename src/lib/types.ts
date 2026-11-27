export type Role = 'user' | 'facility_owner' | 'admin' | 'auditor'
export type EventStatus = 'open' | 'full' | 'cancelled' | 'completed'
export type ParticipantStatus = 'joined' | 'left' | 'attended' | 'no_show'

export interface Sport {
  id: number
  name_he: string
  emoji: string
  team_count: number
  default_players: number
}

export interface Profile {
  id: string
  full_name: string
  phone: string | null
  city: string | null
  home_lat: number | null
  home_lng: number | null
  max_distance_km: number
  pref_slots: number[]
  role: Role
  onboarded: boolean
  created_at: string
}

export interface UserSport {
  user_id: string
  sport_id: number
  self_level: number
}

export interface SportEvent {
  id: string
  organizer_id: string
  sport_id: number
  facility_id: string | null
  title: string
  description: string | null
  city: string
  address: string | null
  lat: number
  lng: number
  starts_at: string
  duration_min: number
  max_participants: number
  level: number
  price_ils: number
  bit_link: string | null
  status: EventStatus
  team_imbalance: number | null
  team_imbalance_random: number | null
  teams_generated_at: string | null
  created_at: string
}

export interface Facility {
  id: string
  owner_id: string
  name: string
  city: string
  address: string | null
  lat: number
  lng: number
  sport_ids: number[]
  phone: string | null
  price_per_hour: number | null
  description: string | null
}

export interface Participant {
  user_id: string
  full_name: string
  status: ParticipantStatus
  paid: boolean
  team: number | null
  source: string
  joined_at: string
  level: number
  reputation: number
  phone: string | null
}

export interface EventDetails {
  event: SportEvent
  sport: Sport
  facility: { id: string; name: string; phone: string | null } | null
  organizer: { id: string; full_name: string; phone: string | null; reputation: number }
  event_level: number
  is_organizer: boolean
  is_member: boolean
  my_status: ParticipantStatus | null
  my_ratings_done: number
  participants: Participant[]
}

export interface Recommendation {
  event_id: string
  rank: number
  distance_km: number | null
  joined_count: number
  f_sport: number
  f_level: number
  f_distance: number
  f_time: number
  f_rating: number
  f_history: number
  score: number
  match_pct: number
}

export interface Notification {
  id: number
  event_id: string | null
  kind: string
  message: string
  read: boolean
  created_at: string
}
