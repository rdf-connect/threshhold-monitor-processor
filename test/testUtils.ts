import type { Any, Reader } from "@rdfc/js-runner";
import type { Handler, Writer } from "@rdfc/js-runner";

/**
 * Minimal in-memory Reader/Writer pair for exercising a processor's
 * `transform()` without needing the full gRPC-backed js-runner.
 */
export function createChannel(uri = "urn:test:channel"): [Writer, Reader] {
    const queue: (string | undefined)[] = [];
    let resolveNext: (() => void) | undefined;

    const push = (item: string | undefined) => {
        queue.push(item);
        resolveNext?.();
        resolveNext = undefined;
    };

    const reader: Reader = {
        uri,
        async *strings() {
            while (true) {
                if (queue.length > 0) {
                    const item = queue.shift();
                    if (item === undefined) return;
                    yield item;
                } else {
                    await new Promise<void>((res) => (resolveNext = res));
                }
            }
        },
        async *streams() {
            throw new Error("not implemented");
        },
        async *buffers() {
            throw new Error("not implemented");
        },
        async *anys(): AsyncIterable<Any> {
            throw new Error("not implemented");
        },
        async cancel() {
            // no-op
        },
    };

    const writer: Writer = {
        uri,
        canceled: false,
        on(_event: "cancel", _listener: Handler) {
            return writer;
        },
        async buffer() {
            throw new Error("not implemented");
        },
        async stream() {
            throw new Error("not implemented");
        },
        async string(msg: string) {
            push(msg);
        },
        async any() {
            throw new Error("not implemented");
        },
        async close() {
            push(undefined);
        },
    };

    return [writer, reader];
}
