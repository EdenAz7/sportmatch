-- New participant status for the waitlist (separate migration: an enum value
-- must be committed before it can be used)
alter type public.participant_status add value if not exists 'waitlist';
