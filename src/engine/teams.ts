/**
 * Balanced team split ("Team Balancer").
 *
 * Problem: split n players with estimated levels into k teams of (almost) equal size
 * so that the team strengths (sum of levels) are as close as possible.
 * Objective (lexicographic): minimise max(sum) - min(sum), then the variance of the sums.
 *
 * This is a multi-way number-partitioning problem (NP-hard in general), so:
 *  - k = 2 and n <= 20: exact search over all splits (at most C(20,10) = 184,756)
 *  - otherwise: greedy construction (strongest player -> weakest team with room)
 *    followed by local search with pairwise swaps until no swap improves the objective.
 *
 * The baseline for the report is the expected imbalance of a random split
 * (how teams are usually picked), estimated by Monte-Carlo.
 */

export interface Player {
  id: string
  name?: string
  level: number
}

export interface BalanceResult {
  teams: Player[][]
  sums: number[]
  imbalance: number
  randomImbalance: number
  method: 'exact' | 'greedy+swaps'
}

/** Team sizes as equal as possible, e.g. n=7,k=2 -> [4,3] */
export function teamSizes(n: number, k: number): number[] {
  const base = Math.floor(n / k)
  const extra = n % k
  return Array.from({ length: k }, (_, i) => base + (i < extra ? 1 : 0))
}

const sum = (xs: Player[]) => xs.reduce((s, p) => s + p.level, 0)

export function imbalanceOf(sums: number[]): number {
  return Math.max(...sums) - Math.min(...sums)
}

function varianceOf(sums: number[]): number {
  const m = sums.reduce((a, b) => a + b, 0) / sums.length
  return sums.reduce((a, s) => a + (s - m) ** 2, 0) / sums.length
}

/** true if objective a is strictly better than b */
function better(a: number[], b: number[]): boolean {
  const ia = imbalanceOf(a)
  const ib = imbalanceOf(b)
  if (ia < ib - 1e-9) return true
  if (ia > ib + 1e-9) return false
  return varianceOf(a) < varianceOf(b) - 1e-9
}

export function greedySplit(players: Player[], k: number): Player[][] {
  const sizes = teamSizes(players.length, k)
  const teams: Player[][] = sizes.map(() => [])
  const sums = sizes.map(() => 0)
  const sorted = [...players].sort((a, b) => b.level - a.level)
  for (const p of sorted) {
    let best = -1
    for (let t = 0; t < k; t++) {
      if (teams[t].length >= sizes[t]) continue
      if (best === -1 || sums[t] < sums[best]) best = t
    }
    teams[best].push(p)
    sums[best] += p.level
  }
  return teams
}

/** Best-improvement pairwise swaps between teams until a local optimum. */
export function improveBySwaps(input: Player[][], maxRounds = 1000): Player[][] {
  const teams = input.map((t) => [...t])
  let sums = teams.map(sum)
  for (let round = 0; round < maxRounds; round++) {
    let bestSums: number[] | null = null
    let move: [number, number, number, number] | null = null
    for (let a = 0; a < teams.length; a++) {
      for (let b = a + 1; b < teams.length; b++) {
        for (let i = 0; i < teams[a].length; i++) {
          for (let j = 0; j < teams[b].length; j++) {
            const d = teams[b][j].level - teams[a][i].level
            if (d === 0) continue
            const cand = [...sums]
            cand[a] += d
            cand[b] -= d
            if (better(cand, bestSums ?? sums)) {
              bestSums = cand
              move = [a, i, b, j]
            }
          }
        }
      }
    }
    if (!move || !bestSums) break
    const [a, i, b, j] = move
    const tmp = teams[a][i]
    teams[a][i] = teams[b][j]
    teams[b][j] = tmp
    sums = bestSums
  }
  return teams
}

/** Exact optimum for two teams by enumerating every split of the required size. */
export function exactTwoTeams(players: Player[]): Player[][] {
  const n = players.length
  const [sizeA] = teamSizes(n, 2)
  const total = sum(players)
  let bestMask = 0
  let bestDiff = Infinity
  // fix player 0 in team A to halve the search (A/B symmetry) when sizes are equal
  const symmetric = n % 2 === 0
  const limit = 1 << n
  for (let mask = 0; mask < limit; mask++) {
    if (symmetric && !(mask & 1)) continue
    let bits = 0
    let s = 0
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) {
        bits++
        s += players[i].level
      }
    }
    if (bits !== sizeA) continue
    const diff = Math.abs(2 * s - total)
    if (diff < bestDiff - 1e-12) {
      bestDiff = diff
      bestMask = mask
      if (diff < 1e-12) break
    }
  }
  const a: Player[] = []
  const b: Player[] = []
  players.forEach((p, i) => (bestMask & (1 << i) ? a : b).push(p))
  return [a, b]
}

/** Deterministic PRNG so results are reproducible */
export function mulberry32(seed: number): () => number {
  let t = seed >>> 0
  return () => {
    t += 0x6d2b79f5
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

export function randomSplit(players: Player[], k: number, rnd: () => number): Player[][] {
  const shuffled = [...players]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  const sizes = teamSizes(players.length, k)
  const teams: Player[][] = []
  let idx = 0
  for (const s of sizes) {
    teams.push(shuffled.slice(idx, idx + s))
    idx += s
  }
  return teams
}

export function expectedRandomImbalance(players: Player[], k: number, samples = 300, seed = 7): number {
  const rnd = mulberry32(seed)
  let total = 0
  for (let s = 0; s < samples; s++) {
    total += imbalanceOf(randomSplit(players, k, rnd).map(sum))
  }
  return total / samples
}

export function balanceTeams(players: Player[], k = 2): BalanceResult {
  if (k < 2 || players.length < k) {
    return { teams: [players], sums: [sum(players)], imbalance: 0, randomImbalance: 0, method: 'greedy+swaps' }
  }
  let teams: Player[][]
  let method: BalanceResult['method']
  if (k === 2 && players.length <= 20) {
    teams = exactTwoTeams(players)
    method = 'exact'
  } else {
    teams = improveBySwaps(greedySplit(players, k))
    method = 'greedy+swaps'
  }
  teams = teams.map((t) => [...t].sort((a, b) => b.level - a.level))
  const sums = teams.map(sum)
  return {
    teams,
    sums,
    imbalance: imbalanceOf(sums),
    randomImbalance: expectedRandomImbalance(players, k),
    method,
  }
}
