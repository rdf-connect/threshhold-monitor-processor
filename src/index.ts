import { randomUUID } from "node:crypto";
import { Processor, type Reader, type Writer } from "@rdfc/js-runner";
import { Parser, Writer as N3Writer, DataFactory } from "n3";
import { SDS, RDF, XSD, createUriAndTermNamespace } from "@treecg/types";
import type { BasicLensM, Cont } from "rdf-lens";
import type { Quad, Term } from "@rdfjs/types";

const { literal, quad, blankNode } = DataFactory;

/** Open Services for Lifecycle Collaboration core vocabulary. */
export const OSLC = createUriAndTermNamespace(
    "http://open-services.net/ns/core#",
    "Error",
    "message",
    "largePreview",
);

/** mu.semte.ch core vocabulary. */
export const MU = createUriAndTermNamespace("http://mu.semte.ch/vocabularies/core/", "uuid");

/** Dublin Core terms vocabulary. */
export const DCT = createUriAndTermNamespace(
    "http://purl.org/dc/terms/",
    "subject",
    "created",
    "creator",
    "references",
);

/** Name reported as the failing service (`dct:subject`) on every generated error. */
const SERVICE_NAME = "threshold-monitor";

const DATA_DESCRIPTION_GRAPH = SDS.terms.custom("DataDescription");

type ThresholdMonitorArgs = {
    reader: Reader;
    writer: Writer;
    path: BasicLensM<Cont, Cont>;
    min?: number;
    max?: number;
    streamId?: Term;
    label?: string;
    creator: Term;
};

/**
 * ThresholdMonitor reads a stream of SDS messages, extracts a value for each
 * incoming member using a configured SHACL path, and writes out a small alert
 * graph whenever that value falls outside the configured [min, max] bounds.
 */
export class ThresholdMonitor extends Processor<ThresholdMonitorArgs> {
    async init(this: ThresholdMonitorArgs & this): Promise<void> {
        if (this.min === undefined && this.max === undefined) {
            throw new Error(
                "ThresholdMonitor requires at least one of `min` or `max` to be configured",
            );
        }

        const bounds = [
            this.min !== undefined ? `>= ${this.min}` : undefined,
            this.max !== undefined ? `<= ${this.max}` : undefined,
        ]
            .filter((x) => x !== undefined)
            .join(" and ");

        this.logger.info(
            `ThresholdMonitor watching${this.label ? ` '${this.label}'` : ""}, expecting values ${bounds}`,
        );
    }

    async transform(this: ThresholdMonitorArgs & this): Promise<void> {
        const parser = new Parser();

        for await (const msg of this.reader.strings()) {
            const quads = parser.parse(msg);
            const alerts = this.checkMessage(quads);

            if (alerts.length > 0) {
                await this.writer.string(new N3Writer().quadsToString(alerts));
            }
        }

        await this.writer.close();
        this.logger.debug("ThresholdMonitor finished processing. Writer closed.");
    }

    async produce(this: ThresholdMonitorArgs & this): Promise<void> {
        // This processor is purely reactive; it never initiates its own data.
    }

    private checkMessage(this: ThresholdMonitorArgs & this, quads: Quad[]): Quad[] {
        const memberQuads = quads.filter(
            (q) => !q.graph.equals(DATA_DESCRIPTION_GRAPH),
        );

        const records = quads.filter((q) => q.predicate.equals(SDS.terms.payload));

        const alerts: Quad[] = [];

        for (const record of records) {
            if (this.streamId) {
                const matchesStream = quads.some(
                    (q) =>
                        q.subject.equals(record.subject) &&
                        q.predicate.equals(SDS.terms.stream) &&
                        q.object.equals(this.streamId),
                );
                if (!matchesStream) {
                    continue;
                }
            }

            const member = record.object;
            const cont: Cont = { id: member, quads: memberQuads };

            for (const found of this.path.execute(cont)) {
                if (found.id.termType !== "Literal") {
                    this.logger.warn(
                        `Value found at configured path for member <${member.value}> is not a literal, skipping.`,
                    );
                    continue;
                }

                const value = Number.parseFloat(found.id.value);
                if (Number.isNaN(value)) {
                    this.logger.warn(
                        `Value '${found.id.value}' found at configured path for member <${member.value}> is not a number, skipping.`,
                    );
                    continue;
                }

                if (this.min !== undefined && value < this.min) {
                    alerts.push(...this.buildAlert(member, value, "min", this.min));
                } else if (this.max !== undefined && value > this.max) {
                    alerts.push(...this.buildAlert(member, value, "max", this.max));
                }
            }
        }

        return alerts;
    }

    private buildAlert(
        this: ThresholdMonitorArgs & this,
        member: Term,
        value: number,
        bound: "min" | "max",
        boundValue: number,
    ): Quad[] {
        const id = blankNode();
        const label = this.label ?? "monitored value";
        const violation =
            bound === "min"
                ? `below the minimum of ${boundValue}`
                : `above the maximum of ${boundValue}`;

        const message = `Threshold violation: ${label} ${violation}`;
        const detail =
            `${label} reported a value of ${value} for <${member.value}>, which is ${violation}.`;

        return [
            quad(id, RDF.terms.type, OSLC.terms.Error),
            quad(id, MU.terms.uuid, literal(randomUUID())),
            quad(id, DCT.terms.subject, literal(SERVICE_NAME)),
            quad(id, OSLC.terms.message, literal(message)),
            quad(id, DCT.terms.created, literal(new Date().toISOString(), XSD.terms.dateTime)),
            quad(id, DCT.terms.creator, <Quad["object"]>this.creator),
            quad(id, OSLC.terms.largePreview, literal(detail)),
            quad(id, DCT.terms.references, <Quad["object"]>member),
        ];
    }
}
