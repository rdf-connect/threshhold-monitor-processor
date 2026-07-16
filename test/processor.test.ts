import { describe, expect, test } from "vitest";
import { readFileSync } from "fs";
import { Parser, DataFactory } from "n3";
import { extractShapes, empty } from "rdf-lens";
import type { BasicLensM, Cont } from "rdf-lens";

const { namedNode } = DataFactory;

const RDFC_READER = "https://w3id.org/rdf-connect#Reader";
const RDFC_WRITER = "https://w3id.org/rdf-connect#Writer";
const TARGET_CLASS = "https://w3id.org/rdf-connect/threshold-monitor#ThresholdMonitorJs";

describe("tm:ThresholdMonitorJs processor definition", () => {
    test("the SHACL shape extracts a working path lens and typed bounds", () => {
        const shapeQuads = new Parser().parse(
            readFileSync(process.cwd() + "/processor.ttl", "utf-8"),
        );

        const instance = `
        @prefix tm: <https://w3id.org/rdf-connect/threshold-monitor#>.
        @prefix rdfc: <https://w3id.org/rdf-connect#>.
        @prefix xsd: <http://www.w3.org/2001/XMLSchema#>.
        @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#>.

        <http://example.com/ns#monitor> a tm:ThresholdMonitorJs;
          rdfc:reader <jr>;
          rdfc:writer <jw>;
          tm:path <http://example.org/ns#temperature>;
          tm:min "10.0"^^xsd:double;
          tm:max "30.0"^^xsd:double;
          tm:stream <http://example.org/ns#stream1>;
          tm:creator <http://example.org/agents#threshold-monitor>;
          rdfs:label "temperature sensor".
        `;
        const instanceQuads = new Parser({ baseIRI: "" }).parse(instance);
        const quads = [...shapeQuads, ...instanceQuads];

        const shapes = extractShapes(
            quads,
            {},
            {
                [RDFC_READER]: empty<Cont>(),
                [RDFC_WRITER]: empty<Cont>(),
            },
        );

        const lens = shapes.lenses[TARGET_CLASS];
        expect(lens).toBeDefined();

        const args = <{
            path: BasicLensM<Cont, Cont>;
            min: number;
            max: number;
            streamId: unknown;
            creator: { value: string };
        }>lens.execute({
            id: namedNode("http://example.com/ns#monitor"),
            quads,
        });

        expect(args.min).toBe(10);
        expect(args.max).toBe(30);
        expect(args.creator.value).toBe("http://example.org/agents#threshold-monitor");

        const dataQuads = new Parser().parse(
            `<http://example.org/ns#member1> <http://example.org/ns#temperature> "42.5"^^<http://www.w3.org/2001/XMLSchema#double>.`,
        );
        const found = args.path.execute({
            id: namedNode("http://example.org/ns#member1"),
            quads: dataQuads,
        });

        expect(found.map((x) => x.id.value)).toEqual(["42.5"]);
    });
});
