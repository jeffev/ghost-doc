package io.ghostdoc.agent.core;

import java.util.ArrayList;
import java.util.List;

/**
 * Thread-safe fixed-capacity ring buffer (FIFO).
 *
 * <p>When the buffer is full, the oldest element is silently overwritten.
 * This matches the offline-buffering behaviour of the JS and Python agents.
 */
public final class RingBuffer<T> {

    private final Object[] data;
    private final int capacity;
    private int head = 0; // next write index
    private int size = 0;

    public RingBuffer(int capacity) {
        if (capacity < 1) throw new IllegalArgumentException("capacity must be >= 1");
        this.capacity = capacity;
        this.data = new Object[capacity];
    }

    /** Add an element, overwriting the oldest if the buffer is full. */
    public synchronized void push(T item) {
        data[head] = item;
        head = (head + 1) % capacity;
        if (size < capacity) size++;
    }

    /**
     * Remove and return all buffered elements in insertion order.
     * The buffer is empty after this call.
     */
    @SuppressWarnings("unchecked")
    public synchronized List<T> drain() {
        List<T> result = new ArrayList<>(size);
        if (size == 0) return result;

        // The oldest element sits at (head - size + capacity) % capacity.
        int start = (head - size + capacity) % capacity;
        for (int i = 0; i < size; i++) {
            result.add((T) data[(start + i) % capacity]);
        }
        head = 0;
        size = 0;
        return result;
    }

    public synchronized int size()     { return size; }
    public synchronized boolean isEmpty() { return size == 0; }
}
