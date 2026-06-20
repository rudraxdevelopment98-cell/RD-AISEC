# Architecture — what we're building

[← back to control room](index.md)

Three components, one growing system. Open-source funnel (Scanner + Gateway + Attack Range) feeds the paid Hosted layer.

## The whole system

```mermaid
flowchart TB
    subgraph OSS["Open source (the funnel)"]
        SC["🔍 Scanner\nstatic analysis"]
        GW["🚦 Gateway\nruntime proxy"]
        AR["🎯 Attack Range\nmalicious-server benchmark"]
    end
    subgraph PAID["Hosted (the business)"]
        REG["📒 Registry + reputation"]
        POL["⚙️ Central policy"]
        COMP["📑 Compliance reporting"]
    end

    AR -->|tests + proves| SC
    AR -->|tests + proves| GW
    SC -->|risk reports| REG
    GW -->|telemetry events| POL
    POL --> COMP
    REG --> POL

    style OSS fill:#d9ead3
    style PAID fill:#cfe2f3
```

## Scanner

Input: an MCP server / tool manifest. Output: a risk report. Runs as **CLI + CI check**.

```mermaid
flowchart LR
    M["MCP manifest /\nserver metadata"] --> P["Parse tools,\ndescriptions, schemas"]
    P --> C1["Check: hidden/imperative\ninstructions in descriptions"]
    P --> C2["Check: over-broad\npermissions"]
    P --> C3["Check: suspicious metadata\n+ dangerous capability combos"]
    P --> C4["Hash descriptions\n(baseline for drift)"]
    C1 & C2 & C3 & C4 --> R["📄 Risk report\n(+ machine-readable JSON)"]
```

## Gateway (the SOC pipeline)

A proxy between the agent/client and the MCP servers. This is where your SOC instincts map 1:1.

```mermaid
flowchart LR
    AGENT["🤖 Agent / MCP client"] --> GWY
    subgraph GWY["🚦 Gateway"]
        LOG["Log every call\n(structured events)"]
        POLCHK{"Policy check\nallowlist?"}
        DRIFT{"Description\nchanged since baseline?"}
        ANOM{"Anomalous call\nsequence vs baseline?"}
        HITL{"High-risk?\nhuman approval"}
    end
    GWY --> SRV["🔌 MCP servers"]

    LOG --> POLCHK
    POLCHK -->|deny| BLOCK["⛔ Block + alert"]
    POLCHK -->|allow| DRIFT
    DRIFT -->|drifted| BLOCK
    DRIFT -->|ok| ANOM
    ANOM -->|anomalous| HITL
    ANOM -->|normal| SRV
    HITL -->|approved| SRV
    HITL -->|denied| BLOCK
```

> **Design rule:** measure false-positive rate on the Attack Range *before* arming any auto-block. Detect first, enforce later.

## Hosted layer

```mermaid
flowchart TB
    GW["Gateways in the field"] -->|events| POL["Central policy engine"]
    SC["Scanners in CI"] -->|reports| REG["Registry + reputation scoring"]
    REG --> POL
    POL --> DASH["📊 Dashboard\n(SOC-style review + tuning)"]
    POL --> COMP["📑 Compliance reports\nNIST AI RMF · EU AI Act · ISO 42001 · OWASP"]
```

## Tech stack (keep it boring)

| Layer | Choice | Why |
|---|---|---|
| Scanner + detection | **Python** | Fits security-tooling instincts |
| Gateway | **TypeScript/Node** (Go later for single binary) | MCP SDKs are first-class in TS |
| Storage (local) | **SQLite / DuckDB**, JSON logs | No Kafka/Elastic on day one |
| Sandboxing | **Docker** | Run untrusted servers safely |
| Telemetry (stretch) | **OpenTelemetry GenAI semantic conventions** | Plugs straight into existing SIEM/SOC — see [improvements](improvements.md#5-emit-opentelemetry-genai-semantic-conventions) |

Next: [threat model →](threat-model.md)
