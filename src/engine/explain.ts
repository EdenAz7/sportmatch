/**
 * Explains a recommendation: which features contributed most to the score.
 * Contribution_i = w_i * f_i  (the same linear score computed in the database).
 */
export interface Weights {
  id: number
  bias: number
  w_sport: number
  w_level: number
  w_distance: number
  w_time: number
  w_rating: number
  w_history: number
  method: 'manual' | 'calibrated'
}

export interface Features {
  f_sport: number
  f_level: number
  f_distance: number
  f_time: number
  f_rating: number
  f_history: number
}

export const FEATURE_LABELS: Record<keyof Features, string> = {
  f_sport: 'ענף',
  f_level: 'רמה',
  f_distance: 'מרחק',
  f_time: 'זמן',
  f_rating: 'דירוג',
  f_history: 'היסטוריה',
}

const REASON_TEXT: Record<keyof Features, string> = {
  f_sport: 'הענף שלך',
  f_level: 'ברמה שלך',
  f_distance: 'קרוב אליך',
  f_time: 'בשעות שנוחות לך',
  f_rating: 'שחקנים עם דירוג גבוה',
  f_history: 'שחקנים ששיחקת איתם',
}

export function contributions(f: Features, w: Weights) {
  return (Object.keys(FEATURE_LABELS) as (keyof Features)[]).map((key) => {
    const wk = ('w_' + key.slice(2)) as keyof Weights
    const weight = w[wk] as number
    return { key, label: FEATURE_LABELS[key], value: f[key], weight, contribution: weight * f[key] }
  })
}

/** Top reasons worth showing (feature strong enough and weight meaningful) */
export function reasons(f: Features, w: Weights, max = 2): string[] {
  return contributions(f, w)
    .filter((c) => c.value >= 0.6 && c.weight > 0.2)
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, max)
    .map((c) => REASON_TEXT[c.key])
}

export const sigmoid = (z: number) => 1 / (1 + Math.exp(-z))
