import { describe, expect, test } from "vitest";
import { Parser, DataFactory } from "n3";
import { pred } from "rdf-lens";
import { createLogger } from "winston";
import { ThresholdMonitor } from "../src/index.js";
import { createChannel } from "./testUtils.js";

const logger = createLogger({ transports: [], silent: true });

const { namedNode } = DataFactory;

const TEMP = namedNode("http://example.org/ns#temperature");
const SDS_GRAPH = "https://w3id.org/sds#DataDescription";
const CREATOR = namedNode("http://example.org/agents#threshold-monitor");

function sdsMessage(memberId: string, temperature: number): string {
    return `
<urn:record> <https://w3id.org/sds#payload> <${memberId}> <${SDS_GRAPH}>.
<urn:record> <https://w3id.org/sds#stream> <http://example.org/ns#stream1> <${SDS_GRAPH}>.
<${memberId}> <http://example.org/ns#temperature> "${temperature}"^^<http://www.w3.org/2001/XMLSchema#double>.
`;
}

describe("ThresholdMonitor", () => {
    test("emits an alert only when the value exceeds the configured bounds", async () => {
        const [inputWriter, inputReader] = createChannel("in");
        const [outputWriter, outputReader] = createChannel("out");

        const proc = new ThresholdMonitor(
            {
                reader: inputReader,
                writer: outputWriter,
                path: pred(TEMP),
                min: 10,
                max: 30,
                creator: CREATOR,
            },
            logger,
        );

        await proc.init();
        const transformPromise = proc.transform();

        const collected: string[] = [];
        const readPromise = (async () => {
            for await (const msg of outputReader.strings()) {
                collected.push(msg);
            }
        })();

        await inputWriter.string(sdsMessage("http://example.org/m1", 5)); // below min
        await inputWriter.string(sdsMessage("http://example.org/m2", 20)); // within bounds
        await inputWriter.string(sdsMessage("http://example.org/m3", 35)); // above max
        await inputWriter.close();

        await transformPromise;
        outputReader.cancel();
        await readPromise;

        expect(collected.length).toBe(2);

        const parser = new Parser();
        const firstAlert = parser.parse(collected[0]);
        expect(
            firstAlert.some(
                (q) =>
                    q.predicate.value === "http://www.w3.org/1999/02/22-rdf-syntax-ns#type" &&
                    q.object.value === "http://open-services.net/ns/core#Error",
            ),
        ).toBe(true);
        expect(
            firstAlert.some(
                (q) =>
                    q.predicate.value === "http://purl.org/dc/terms/references" &&
                    q.object.value === "http://example.org/m1",
            ),
        ).toBe(true);
        expect(
            firstAlert.some(
                (q) =>
                    q.predicate.value === "http://purl.org/dc/terms/creator" &&
                    q.object.value === CREATOR.value,
            ),
        ).toBe(true);
        expect(
            firstAlert.some(
                (q) =>
                    q.predicate.value === "http://open-services.net/ns/core#message" &&
                    q.object.termType === "Literal",
            ),
        ).toBe(true);
        expect(
            firstAlert.some(
                (q) =>
                    q.predicate.value === "http://purl.org/dc/terms/created" &&
                    q.object.termType === "Literal" &&
                    (<{ datatype?: { value: string } }>q.object).datatype?.value ===
                        "http://www.w3.org/2001/XMLSchema#dateTime",
            ),
        ).toBe(true);

        const secondAlert = parser.parse(collected[1]);
        expect(
            secondAlert.some(
                (q) =>
                    q.predicate.value === "http://purl.org/dc/terms/references" &&
                    q.object.value === "http://example.org/m3",
            ),
        ).toBe(true);
    });

    test("requires at least one of min or max to be configured", async () => {
        const [, inputReader] = createChannel("in");
        const [outputWriter] = createChannel("out");

        const proc = new ThresholdMonitor(
            {
                reader: inputReader,
                writer: outputWriter,
                path: pred(TEMP),
                creator: CREATOR,
            },
            logger,
        );

        await expect(proc.init()).rejects.toThrow();
    });
});
