# Threshold Monitor Processor

An [RDF-Connect](https://github.com/rdf-connect) processor that watches a numeric
value on incoming [SDS](https://w3id.org/sds#) members and emits an alert email
whenever that value falls outside a configured `[min, max]` range.

For each SDS record read from its `reader`, the processor:

1. Looks up the member described by the record's `sds:payload`.
2. Extracts a value from that member using a configured SHACL path.
3. If the value is a number and violates the configured `min`/`max` bound, writes
   a small `nmo:Email` alert graph to its `writer`, ready to be inserted into a
   mailbox graph (e.g. by a [mu-semtech](https://mu.semte.ch/) email microservice).

Messages that don't violate any bound produce no output — the processor is a
filter/enricher, not a pass-through.

## Installation

```bash
npm install @rdfc/threshold-monitor-processor-ts
```

Then import `processor.ttl` from this package into your pipeline (see
[Configuring the processor](#configuring-the-processor) below) and reference
`tm:ThresholdMonitorJs` as a processor instance.

## Configuring the processor

The processor is described by the `tm:ThresholdMonitorJs` shape in
[`processor.ttl`](./processor.ttl), under the namespace
`https://w3id.org/rdf-connect/threshold-monitor#` (prefix `tm:`). An instance takes
the following parameters:

| Parameter    | Predicate    | Required          | Type             | Description                                                                                                     |
| ------------ | ------------ | ------------------ | ---------------- | ----------------------------------------------------------------------------------------------------------------- |
| `reader`     | `rdfc:reader`  | yes                | `rdfc:Reader`      | Channel to read incoming SDS messages (N-Quads strings) from.                                                    |
| `writer`     | `rdfc:writer`  | yes                | `rdfc:Writer`      | Channel to write generated alert messages to.                                                                    |
| `path`       | `tm:path`      | yes                | SHACL property path | Path, relative to the SDS member's IRI, used to extract the value to monitor. Any SHACL path expression rdf-lens supports works (single predicate, sequence, inverse, etc). |
| `min`        | `tm:min`       | no<sup>†</sup>       | `xsd:double`      | Lower bound. Values strictly below `min` trigger an alert with `violatedBound "min"`.                            |
| `max`        | `tm:max`       | no<sup>†</sup>       | `xsd:double`      | Upper bound. Values strictly above `max` trigger an alert with `violatedBound "max"`.                            |
| `streamId`   | `tm:stream`    | no                 | IRI               | Restrict monitoring to records whose `sds:stream` equals this IRI. If omitted, every incoming record is checked. |
| `label`      | `rdfs:label`   | no                 | `xsd:string`      | Human-readable name used in log output and in the generated alert email's subject/body. |
| `mailFolder` | `tm:mailFolder`| yes                | IRI               | Mailbox folder the alert email is filed under (`nmo:isPartOf`), e.g. an outbox folder IRI. |
| `mailTo`     | `tm:mailTo`    | yes                | `xsd:string`      | Recipient address of the alert email (`nmo:emailTo`).                                                            |
| `mailFrom`   | `tm:mailFrom`  | yes                | `xsd:string`      | Sender address of the alert email (`nmo:messageFrom`).                                                           |
| `creator`    | `tm:creator`   | yes                | IRI               | Agent the alert email is attributed to (`dct:creator`).                                                          |

† At least one of `min` or `max` must be set — `init()` throws if both are
omitted. Setting only one leaves the other side of the range unchecked (e.g.
configuring only `max` never flags values that are too low).

### Example pipeline

```turtle
@prefix rdfc: <https://w3id.org/rdf-connect#>.
@prefix tm:   <https://w3id.org/rdf-connect/threshold-monitor#>.
@prefix xsd:  <http://www.w3.org/2001/XMLSchema#>.
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#>.
@prefix ex:   <http://example.org/ns#>.

<> a rdfc:Pipeline;
    rdfc:consistsOf [
        rdfc:processor <#TemperatureMonitor>;
    ].

<sds-in>  a rdfc:Channel.
<alerts-out> a rdfc:Channel.

<#TemperatureMonitor> a tm:ThresholdMonitorJs;
    rdfc:reader <sds-in>;
    rdfc:writer <alerts-out>;
    tm:path ex:temperature;
    tm:min "10.0"^^xsd:double;
    tm:max "30.0"^^xsd:double;
    tm:stream ex:temperatureStream;
    tm:mailFolder <http://example.org/mail#outbox>;
    tm:mailTo "oncall@example.org";
    tm:mailFrom "monitor@example.org";
    tm:creator <http://example.org/agents#threshold-monitor>;
    rdfs:label "temperature sensor".
```

`sds-in` is expected to carry SDS records (typically produced by an
`sds-processors` `sdsify`/`bucketize` step or similar), and `alerts-out` can be
fed into any downstream processor (e.g. a SPARQL-inserting sink) to act on the
generated `nmo:Email` alerts.

## Alert output

Each violation is written to `writer` as a standalone N-Quads/Turtle string
containing a blank-node subject with:

| Predicate                | Value                                                                 |
| ------------------------- | ----------------------------------------------------------------------- |
| `rdf:type`                 | `nmo:Email`                                                            |
| `mu:uuid`                  | a freshly generated UUID for the email                                |
| `nmo:isPartOf`              | the configured `mailFolder` IRI                                       |
| `nmo:messageSubject`        | a generated subject describing the violation                          |
| `nmo:htmlMessageContent`    | a generated HTML body describing the member, value, and violated bound |
| `nmo:emailTo`               | the configured `mailTo` address                                       |
| `nmo:messageFrom`           | the configured `mailFrom` address                                     |
| `dct:creator`               | the configured `creator` IRI                                          |
| `dct:references`            | IRI of the SDS member that violated the bound                         |

This shape is designed to be insertable directly into a mailbox graph, e.g.:

```sparql
PREFIX nmo: <http://www.semanticdesktop.org/ontologies/2007/03/22/nmo#>
PREFIX mu:  <http://mu.semte.ch/vocabularies/core/>
PREFIX dct: <http://purl.org/dc/terms/>

INSERT DATA {
  GRAPH <http://mu.semte.ch/graphs/mail> {
    <http://example.org/emails/1> a nmo:Email;
        mu:uuid "…";
        nmo:isPartOf <http://example.org/mail#outbox>;
        nmo:messageSubject "…";
        nmo:htmlMessageContent "…";
        nmo:emailTo "oncall@example.org";
        nmo:messageFrom "monitor@example.org";
        dct:creator <http://example.org/agents#threshold-monitor>;
        dct:references <http://example.org/m1> .
  }
}
```

Values found at the configured path that aren't literals, or aren't parseable
as numbers, are skipped with a warning log rather than raising an error.

## Development

```bash
npm install
npm run build   # compiles src/ to lib/
npm test        # runs the vitest suite with coverage
```

## License

MIT
