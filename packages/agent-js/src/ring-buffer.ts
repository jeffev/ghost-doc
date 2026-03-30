/**
 * Fixed-capacity ring buffer.
 * When full, the oldest item is evicted to make room for the new one.
 */
export class RingBuffer<T> {
  private readonly items: (T | undefined)[];
  private head = 0; // points to the next write slot
  private size = 0;

  constructor(private readonly capacity: number) {
    if (capacity < 1) throw new RangeError("RingBuffer capacity must be >= 1");
    this.items = new Array<T | undefined>(capacity).fill(undefined);
  }

  /** Add an item. Evicts the oldest item if the buffer is full. */
  push(item: T): void {
    this.items[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this.size < this.capacity) {
      this.size++;
    }
  }

  /**
   * Return all items in insertion order and reset the buffer.
   * O(n) where n = number of items currently stored.
   */
  drain(): T[] {
    if (this.size === 0) return [];

    const result: T[] = [];
    // If not full: items run from 0 to size-1
    // If full: oldest item is at `head` (the slot that was just overwritten)
    const startIndex = this.size < this.capacity ? 0 : this.head;

    for (let i = 0; i < this.size; i++) {
      const item = this.items[(startIndex + i) % this.capacity];
      // item is always defined when i < size
      result.push(item as T);
    }

    // Reset
    this.head = 0;
    this.size = 0;

    return result;
  }

  get length(): number {
    return this.size;
  }

  get isFull(): boolean {
    return this.size === this.capacity;
  }

  get isEmpty(): boolean {
    return this.size === 0;
  }
}
