import { describe, expect, it } from 'vitest'
import {
  balanceTeams,
  exactTwoTeams,
  greedySplit,
  imbalanceOf,
  improveBySwaps,
  mulberry32,
  teamSizes,
  type Player,
} from './teams'

const sumOf = (t: Player[]) => t.reduce((s, p) => s + p.level, 0)

function randomPlayers(n: number, rnd: () => number): Player[] {
  // levels like the app produces: 1..5 with Bayesian decimals
  return Array.from({ length: n }, (_, i) => ({ id: `p${i}`, level: Math.round((1 + rnd() * 4) * 100) / 100 }))
}

describe('teamSizes', () => {
  it('splits as evenly as possible', () => {
    expect(teamSizes(10, 2)).toEqual([5, 5])
    expect(teamSizes(7, 2)).toEqual([4, 3])
    expect(teamSizes(12, 3)).toEqual([4, 4, 4])
    expect(teamSizes(13, 3)).toEqual([5, 4, 4])
  })
})

describe('exactTwoTeams', () => {
  it('finds a perfect split when one exists', () => {
    const players = [5, 4, 3, 3, 2, 1].map((level, i) => ({ id: `${i}`, level }))
    const [a, b] = exactTwoTeams(players)
    expect(a.length).toBe(3)
    expect(b.length).toBe(3)
    expect(sumOf(a)).toBe(sumOf(b))
  })

  it('keeps every player exactly once', () => {
    const players = randomPlayers(11, mulberry32(1))
    const [a, b] = exactTwoTeams(players)
    expect([...a, ...b].map((p) => p.id).sort()).toEqual(players.map((p) => p.id).sort())
    expect(Math.abs(a.length - b.length)).toBeLessThanOrEqual(1)
  })
})

describe('greedy + swaps heuristic', () => {
  it('is close to the exact optimum on random instances (k=2)', () => {
    const rnd = mulberry32(42)
    let worstGap = 0
    for (let trial = 0; trial < 200; trial++) {
      const players = randomPlayers(4 + Math.floor(rnd() * 13), rnd)
      const exact = imbalanceOf(exactTwoTeams(players).map(sumOf))
      const heur = imbalanceOf(improveBySwaps(greedySplit(players, 2)).map(sumOf))
      expect(heur).toBeGreaterThanOrEqual(exact - 1e-9)
      worstGap = Math.max(worstGap, heur - exact)
    }
    // the heuristic is never more than one "level step" away from optimal
    expect(worstGap).toBeLessThan(1)
  })

  it('keeps team sizes balanced for k=3', () => {
    const players = randomPlayers(14, mulberry32(3))
    const teams = improveBySwaps(greedySplit(players, 3))
    expect(teams.map((t) => t.length).sort()).toEqual([4, 5, 5])
  })
})

describe('balanceTeams', () => {
  it('beats a random split by a wide margin', () => {
    const rnd = mulberry32(9)
    let better = 0
    let ratioSum = 0
    const trials = 100
    for (let t = 0; t < trials; t++) {
      const players = randomPlayers(10, rnd)
      const r = balanceTeams(players, 2)
      if (r.imbalance <= r.randomImbalance) better++
      ratioSum += r.imbalance / Math.max(1e-9, r.randomImbalance)
    }
    expect(better).toBe(trials)
    // on average the balanced split is at least 10x closer than random picking
    expect(ratioSum / trials).toBeLessThan(0.1)
  })

  it('returns a single group for individual sports (k=1)', () => {
    const r = balanceTeams(randomPlayers(5, mulberry32(5)), 1)
    expect(r.teams.length).toBe(1)
    expect(r.imbalance).toBe(0)
  })

  it('uses the heuristic for large groups and stays balanced', () => {
    const players = randomPlayers(30, mulberry32(11))
    const r = balanceTeams(players, 2)
    expect(r.method).toBe('greedy+swaps')
    expect(r.imbalance).toBeLessThan(0.5)
  })
})
