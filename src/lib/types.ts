export type Role = 'user' | 'facility_owner' | 'admin' | 'auditor'
export type EventStatus = 'open' | 'full' | 'cancelled' | 'completed'
export type ParticipantStatus = 'joined' | 'left' | 'attended' | 'no_show' | 'waitlist'

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
  guest_count: number
  facility_slot_id: string | null
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
  verified: boolean
  created_at?: string
  updated_at?: string | null
}

/** A free (or booked) time that a facility owner offers */
export interface FacilitySlot {
  id: string
  facility_id: string
  starts_at: string
  duration_min: number
  price_ils: number | null
}

export interface OwnerSlot extends FacilitySlot {
  event: { id: string; title: string; status: EventStatus } | null
}

export interface OwnerEvent {
  id: string
  title: string
  starts_at: string
  status: EventStatus
  sport_id: number
  max_participants: number
  taken: number
  organizer_name: string
  organizer_phone: string | null
  from_slot: boolean
}

export interface OwnerFacility {
  facility: Facility
  slots: OwnerSlot[]
  events: OwnerEvent[]
  stats: { games_total: number; games_upcoming: number; players_total: number; slots_offered: number; slots_booked: number }
}

export interface Participant {
  user_id: string
  full_name: string
  status: ParticipantStatus
  paid: boolean
  team: number | null
  source: string
  joined_at: string
  promoted: boolean
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
  my_paid: boolean
  my_promoted_at: string | null
  my_refund: { amount: number; done: boolean; late: boolean } | null
  my_waitlist_position: number | null
  my_ratings_done: number
  participants: Participant[]
  waitlist: { user_id: string; full_name: string }[]
  refunds: { user_id: string; full_name: string; amount: number; done: boolean; late: boolean; phone: string | null }[] | null
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
