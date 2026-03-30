import { describe, it, expect } from "vitest";
import { RingBuffer } from "../src/ring-buffer.js";

describe("RingBuffer", () => {
  it("throws when capacity < 1", () => {
    expect(() => new RingBuffer(0)).toThrow(RangeError);
  });

  it("stores items up to capacity", () => {
    const buf = new RingBuffer<number>(3);
    buf.push(1);
    buf.push(2);
    buf.push(3);
    expect(buf.length).toBe(3);
    expect(buf.isFull).toBe(true);
  });

  it("drain returns items in insertion order", () => {
    const buf = new RingBuffer<number>(5);
    buf.push(10);
    buf.push(20);
    buf.push(30);
    expect(buf.drain()).toEqual([10, 20, 30]);
  });

  it("drain resets the buffer", () => {
    const buf = new RingBuffer<string>(3);
    buf.push("a");
    buf.drain();
    expect(buf.length).toBe(0);
    expect(buf.isEmpty).toBe(true);
  });

  it("evicts the oldest item when full (ring behavior)", () => {
    const buf = new RingBuffer<number>(3);
    buf.push(1);
    buf.push(2);
    buf.push(3);
    buf.push(4); // evicts 1
    buf.push(5); // evicts 2
    expect(buf.drain()).toEqual([3, 4, 5]);
  });

  it("handles capacity of 1", () => {
    const buf = new RingBuffer<string>(1);
    buf.push("first");
    buf.push("second"); // evicts "first"
    expect(buf.drain()).toEqual(["second"]);
  });

  it("drain on empty buffer returns empty array", () => {
    const buf = new RingBuffer<number>(10);
    expect(buf.drain()).toEqual([]);
  });

  it("multiple push-drain cycles work correctly", () => {
    const buf = new RingBuffer<number>(3);
    buf.push(1);
    buf.push(2);
    expect(buf.drain()).toEqual([1, 2]);

    buf.push(3);
    buf.push(4);
    expect(buf.drain()).toEqual([3, 4]);
  });

  it("accurately reports isFull and isEmpty", () => {
    const buf = new RingBuffer<number>(2);
    expect(buf.isEmpty).toBe(true);
    expect(buf.isFull).toBe(false);

    buf.push(1);
    expect(buf.isEmpty).toBe(false);
    expect(buf.isFull).toBe(false);

    buf.push(2);
    expect(buf.isFull).toBe(true);
  });
});
