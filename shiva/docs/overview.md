# Overview — the whole project on one screen

[← back to control room](index.md)

## The mindmap

```mermaid
mindmap
  root((Shiva\nMCP Security))
    Why now
      Agent spend exploding
      Security is the #1 blocker
      MCP becoming the rails
      Tool-supply-chain layer is open
    What we build
      Scanner
        Static analysis of manifests
        CI check + CLI
      Gateway
        Runtime proxy
        Log every tool call
        Allowlist + block
        Drift detection
      Hosted
        Registry + reputation
        Central policy
        Compliance reporting
      Attack Range
        Library of malicious servers
        Public benchmark
    Threats
      Tool poisoning
      Description drift / rug-pull
      Cross-tool escalation
      Confused deputy
      Credential / token theft
    My edge
      SOC background
      Log normalisation
      Allowlisting
      Detection rules
      Threat modelling
    Distribution
      Build in public
      Write up every attack
      Give-first assets
      Talks + CFPs
    Risks
      Standardisation commoditises scanner
      Incumbent absorbs niche
      MCP loses to another protocol
```

## The single sentence

> Be the team that owns **detection and policy for the layer where agents call tools**, by giving away the scanner + a malicious-server benchmark to build trust, then charging for the hosted registry/policy/compliance layer that enterprises are forced to buy.

## The shape of the bet

```mermaid
flowchart TD
    A["Give away: Scanner + Attack Range benchmark"] --> B["Earn trust & adoption\n(stars, issues, talks)"]
    B --> C["Run the Gateway in real workflows\n(telemetry + enforcement)"]
    C --> D["Design partners emerge from the community"]
    D --> E["Hosted layer: registry, policy, compliance\n= the part people pay for"]

    style A fill:#d9ead3
    style E fill:#cfe2f3
```

See also: [roadmap](roadmap.md) · [architecture](architecture.md) · [improvements](improvements.md)
