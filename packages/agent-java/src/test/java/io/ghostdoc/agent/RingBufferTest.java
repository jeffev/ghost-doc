package io.ghostdoc.agent;

import io.ghostdoc.agent.core.RingBuffer;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class RingBufferTest {

    @Test
    void pushAndDrainInOrder() {
        RingBuffer<String> buf = new RingBuffer<>(5);
        buf.push("a");
        buf.push("b");
        buf.push("c");

        List<String> drained = buf.drain();
        assertEquals(List.of("a", "b", "c"), drained);
        assertTrue(buf.isEmpty());
    }

    @Test
    void overwritesOldestWhenFull() {
        RingBuffer<Integer> buf = new RingBuffer<>(3);
        buf.push(1);
        buf.push(2);
        buf.push(3);
        buf.push(4); // overwrites 1

        List<Integer> drained = buf.drain();
        assertEquals(3, drained.size());
        // Oldest remaining should be 2
        assertEquals(2, drained.get(0));
        assertEquals(3, drained.get(1));
        assertEquals(4, drained.get(2));
    }

    @Test
    void drainEmptyBufferReturnsEmptyList() {
        RingBuffer<String> buf = new RingBuffer<>(10);
        assertTrue(buf.drain().isEmpty());
    }

    @Test
    void drainClearsBuffer() {
        RingBuffer<String> buf = new RingBuffer<>(5);
        buf.push("x");
        buf.drain();
        assertTrue(buf.isEmpty());
        assertEquals(0, buf.size());
    }

    @Test
    void capacityOneAlwaysKeepsLatest() {
        RingBuffer<String> buf = new RingBuffer<>(1);
        buf.push("first");
        buf.push("second");
        List<String> drained = buf.drain();
        assertEquals(List.of("second"), drained);
    }
}
