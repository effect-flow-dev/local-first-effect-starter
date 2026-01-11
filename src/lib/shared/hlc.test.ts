// FILE: src/lib/shared/hlc.test.ts
import { describe, it, expect } from "vitest";
import { packHlc, unpackHlc, tickHlc, receiveHlc, initHlc } from "./hlc";

describe("Hybrid Logical Clock (Shared Logic)", () => {
    const NODE_A = "node-a";
    const NODE_B = "node-b";

    it("should pack and unpack correctly", () => {
        const hlc = { physical: 1736612345678, counter: 5, nodeId: NODE_A };
        const packed = packHlc(hlc);
        
        // 1736612345678:0005:node-a
        expect(packed).toBe("1736612345678:0005:node-a");
        expect(unpackHlc(packed)).toEqual(hlc);
    });

    it("should maintain lexicographical sorting", () => {
        const h1 = packHlc({ physical: 100, counter: 0, nodeId: "a" });
        const h2 = packHlc({ physical: 100, counter: 1, nodeId: "a" });
        const h3 = packHlc({ physical: 101, counter: 0, nodeId: "a" });

        const list = [h3, h1, h2];
        list.sort();

        expect(list).toEqual([h1, h2, h3]);
    });

    it("tick: should increment counter if physical time is same", () => {
        const start = initHlc(NODE_A, 1000);
        const ticked = tickHlc(start, 1000);

        expect(ticked.physical).toBe(1000);
        expect(ticked.counter).toBe(1);
    });

    it("tick: should reset counter if physical time moves forward", () => {
        const start = { physical: 1000, counter: 10, nodeId: NODE_A };
        const ticked = tickHlc(start, 1100);

        expect(ticked.physical).toBe(1100);
        expect(ticked.counter).toBe(0);
    });

    it("receive: should jump ahead to match remote physical time", () => {
        const local = initHlc(NODE_A, 1000);
        const remote = packHlc({ physical: 2000, counter: 5, nodeId: NODE_B });
        
        const next = receiveHlc(local, remote, 1000);

        expect(next.physical).toBe(2000);
        expect(next.counter).toBe(6);
        expect(next.nodeId).toBe(NODE_A); // Keeps local node identity
    });

    it("receive: should handle clock skew (local physical time is higher than remote)", () => {
        const local = { physical: 5000, counter: 0, nodeId: NODE_A };
        const remote = packHlc({ physical: 2000, counter: 10, nodeId: NODE_B });
        
        const next = receiveHlc(local, remote, 4000);

        // Local physical wins
        expect(next.physical).toBe(5000);
        expect(next.counter).toBe(1);
    });

    it("receive: should handle identical physical times by taking max counter + 1", () => {
        const local = { physical: 1000, counter: 10, nodeId: NODE_A };
        const remote = packHlc({ physical: 1000, counter: 20, nodeId: NODE_B });
        
        const next = receiveHlc(local, remote, 1000);

        expect(next.physical).toBe(1000);
        expect(next.counter).toBe(21);
    });
});
