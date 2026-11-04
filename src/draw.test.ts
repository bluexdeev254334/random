import { describe, expect, it } from 'vitest';
import {
  chooseNumber,
  createRound,
  getRemaining,
  getTargetRotation,
  getWinningSeat,
  isValidDrawState,
  loadDrawState,
  randomIndex,
  SEAT_COUNT,
  STORAGE_KEY,
  TEAM_DESK_COUNTS,
  undoLatest,
} from './draw';

const sequence = (...words: number[]) => {
  let index = 0;
  return () => words[index++ % words.length];
};

describe('seat draw domain', () => {
  it('creates exactly 35 unique seat assignments', () => {
    const round = createRound(true, sequence(0));
    expect(round.assignments).toHaveLength(SEAT_COUNT);
    expect([...round.assignments].sort((a, b) => a - b)).toEqual(Array.from({ length: SEAT_COUNT }, (_, i) => i + 1));
  });

  it('defines the requested default desk counts without guessing seat positions', () => {
    expect(TEAM_DESK_COUNTS).toEqual([5, 5, 6, 5]);
    expect(TEAM_DESK_COUNTS.reduce((sum, desks) => sum + desks, 0)).toBe(21);
    expect(SEAT_COUNT).toBe(35);
  });

  it('uses rejection sampling to avoid modulo bias', () => {
    expect(randomIndex(3, sequence(0xffffffff, 7))).toBe(1);
  });

  it('selects only remaining values and removes each result once', () => {
    let round = createRound(true, sequence(1));
    const first = chooseNumber(getRemaining(round), sequence(0));
    expect(first).toBe(1);
    round = { ...round, history: [first!] };
    expect(getRemaining(round)).toHaveLength(34);
    expect(getRemaining(round)).not.toContain(first);
    expect(chooseNumber([], sequence(0))).toBeNull();
  });

  it('maps a winning number to its assigned seat, including the final draw', () => {
    const assignments = createRound().assignments;
    expect(getWinningSeat(assignments, assignments[34])).toBe(34);
  });

  it('aligns the selected sector center with the fixed pointer after full turns', () => {
    for (const [currentRotation, index, count] of [[17, 0, 35], [721, 4, 8], [90, 0, 1]]) {
      const target = getTargetRotation(currentRotation, index, count);
      const pointerOffset = (target + (index + 0.5) * (360 / count)) % 360;
      expect(pointerOffset).toBeCloseTo(0, 8);
      expect(target - currentRotation).toBeGreaterThanOrEqual(7 * 360);
    }
  });

  it('undoes exactly the latest result', () => {
    const round = { ...createRound(), history: [17, 4, 29] };
    const undone = undoLatest(round);
    expect(undone.history).toEqual([17, 4]);
    expect(getRemaining(undone)).toContain(29);
  });

  it('restores valid local state and rejects corrupted state', () => {
    const round = { ...createRound(false), history: [8, 21] };
    const storage = { getItem: (key: string) => key === STORAGE_KEY ? JSON.stringify(round) : null };
    expect(loadDrawState(storage)).toEqual(round);
    expect(isValidDrawState({ ...round, history: [8, 8] })).toBe(false);
  });

  it('completes all 35 unique draws with no values remaining', () => {
    let round = createRound();
    for (let turn = 0; turn < SEAT_COUNT; turn += 1) {
      const result = chooseNumber(getRemaining(round), sequence(0));
      expect(result).not.toBeNull();
      round = { ...round, history: [...round.history, result!] };
    }
    expect(getRemaining(round)).toEqual([]);
    expect(new Set(round.history).size).toBe(SEAT_COUNT);
    expect(chooseNumber(getRemaining(round), sequence(0))).toBeNull();
  });
});