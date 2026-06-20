# Roadmap — where we're going, by when

[← back to control room](index.md)

## Timeline (Gantt)

```mermaid
gantt
    title Shiva — 18 month roadmap
    dateFormat  YYYY-MM-DD
    axisFormat  %b '%y

    section Phase 0 · Learn + Break
    Stand up MCP locally        :p0a, 2026-06-10, 14d
    Reproduce 3 core attacks    :p0b, after p0a, 21d
    Public write-ups            :p0c, after p0a, 28d

    section Phase 1 · OSS Scanner
    First 3 checks              :p1a, after p0b, 30d
    CLI + CI packaging          :p1b, after p1a, 30d
    Public release + docs       :p1c, after p1b, 30d
    Attack Range v1 (benchmark) :p1d, after p0b, 60d

    section Phase 2 · Runtime Gateway
    Proxy + structured logging  :p2a, after p1c, 45d
    Allowlist + block engine    :p2b, after p2a, 45d
    Drift + anomaly detection   :p2c, after p2b, 45d
    Human-in-the-loop approval  :p2d, after p2c, 30d

    section Phase 3 · Hosted Layer
    Registry + reputation       :p3a, after p2d, 60d
    Central policy + dashboard  :p3b, after p3a, 60d
    Compliance reporting        :p3c, after p3b, 60d
    Design-partner pilot        :p3d, after p3a, 120d
```

## Phase state machine + decision gates

Each phase ends at a **gate**: you either continue, or you pivot with a still-valuable asset in hand.

```mermaid
stateDiagram-v2
    [*] --> Phase0
    Phase0 --> Gate0
    Gate0 --> Phase1: Interesting enough for 18 months?
    Gate0 --> Pivot0: No → you're now an MCP-security expert\n(job / consulting)

    Phase1 --> Gate1
    Gate1 --> Phase2: Did anyone outside me adopt the scanner?
    Gate1 --> Pivot1: No → reassess the wedge\nbefore 6 more months

    Phase2 --> Gate2
    Gate2 --> Phase3: Credible design partner willing?
    Gate2 --> Pivot2: No → OSS is a strong\nportfolio/career asset

    Phase3 --> [*]: Hosted demo + pilot user
```

## Definition of done per phase

| Phase | Done when… |
|---|---|
| **0** | You can demo **3 working attacks** and explain each from first principles. |
| **1** | **Someone who isn't you** runs the scanner on their own MCP setup and finds it useful. |
| **2** | The gateway sits in front of a real agent workflow, logs it, and **blocks a poisoned/drifted tool in real time** without breaking normal use (with a measured false-positive rate). |
| **3** | Deployable hosted demo **+ at least one design partner / pilot user** giving feedback. |

Next: [progress board →](progress.md)
