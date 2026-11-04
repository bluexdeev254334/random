export const SEAT_COUNT = 35;
export const STORAGE_KEY = '11b7-seat-draw-v1';
export const TEAM_DESK_COUNTS = [5, 5, 6, 5] as const;

export type DrawState = {
  assignments: number[];
  history: number[];
  soundEnabled: boolean;
};

export type RandomWordSource = () => number;

export function secureRandomWord(): number {
  const word = new Uint32Array(1);
  globalThis.crypto.getRandomValues(word);
  return word[0];
}

export function randomIndex(maxExclusive: number, source: RandomWordSource = secureRandomWord): number {
  if (!Number.isInteger(maxExclusive) || maxExclusive < 1 || maxExclusive > 0x100000000) {
    throw new RangeError('maxExclusive must be an integer from 1 to 2^32');
  }

  const range = 0x100000000;
  const limit = Math.floor(range / maxExclusive) * maxExclusive;
  let word = source();
  while (word >= limit) word = source();
  return word % maxExclusive;
}

export function fisherYates<T>(items: readonly T[], source: RandomWordSource = secureRandomWord): T[] {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = randomIndex(index + 1, source);
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

export function createRound(soundEnabled = true, source: RandomWordSource = secureRandomWord): DrawState {
  const assignments = fisherYates(Array.from({ length: SEAT_COUNT }, (_, index) => index + 1), source);
  return { assignments, history: [], soundEnabled };
}

export function chooseNumber(remaining: readonly number[], source: RandomWordSource = secureRandomWord): number | null {
  if (remaining.length === 0) return null;
  return remaining[randomIndex(remaining.length, source)];
}

export function getRemaining(state: DrawState): number[] {
  const selected = new Set(state.history);
  return Array.from({ length: SEAT_COUNT }, (_, index) => index + 1).filter((number) => !selected.has(number));
}

export function getWinningSeat(assignments: readonly number[], number: number): number {
  return assignments.indexOf(number);
}

export function getTargetRotation(currentRotation: number, resultIndex: number, count: number, fullTurns = 7): number {
  if (!Number.isInteger(resultIndex) || resultIndex < 0 || resultIndex >= count || count < 1) {
    throw new RangeError('resultIndex must refer to an available wheel sector');
  }
  const centerOffset = (resultIndex + 0.5) * (360 / count);
  const correction = ((-(currentRotation + centerOffset) % 360) + 360) % 360;
  return currentRotation + 360 * fullTurns + correction;
}

export function undoLatest(state: DrawState): DrawState {
  if (state.history.length === 0) return state;
  return { ...state, history: state.history.slice(0, -1) };
}

export function isValidDrawState(value: unknown): value is DrawState {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<DrawState>;
  if (!Array.isArray(candidate.assignments) || !Array.isArray(candidate.history) || typeof candidate.soundEnabled !== 'boolean') return false;
  if (candidate.assignments.length !== SEAT_COUNT || candidate.history.length > SEAT_COUNT) return false;

  const isValidNumber = (number: unknown) => Number.isInteger(number) && Number(number) >= 1 && Number(number) <= SEAT_COUNT;
  return candidate.assignments.every(isValidNumber)
    && new Set(candidate.assignments).size === SEAT_COUNT
    && candidate.history.every(isValidNumber)
    && new Set(candidate.history).size === candidate.history.length;
}

export function loadDrawState(storage: Pick<Storage, 'getItem'>, source: RandomWordSource = secureRandomWord): DrawState {
  try {
    const saved = storage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed: unknown = JSON.parse(saved);
      if (isValidDrawState(parsed)) return parsed;
    }
  } catch {
    // A blocked or malformed localStorage entry starts a clean round.
  }
  return createRound(true, source);
}