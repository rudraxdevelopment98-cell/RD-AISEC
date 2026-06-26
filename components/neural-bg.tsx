// Animated "neural network" backdrop — nodes connected by synapse lines, with
// pulsing nodes and a few signals traveling along edges. Pure SVG + SMIL (no
// deps, no JS). Subtle; sits behind the dashboard. Honors reduced-motion via the
// .blip class (signals use SMIL, which is fine to leave).

const NODES: [number, number][] = [
  [120, 90], [300, 140], [470, 80], [640, 150], [820, 100], [935, 230],
  [80, 300], [250, 330], [430, 290], [600, 340], [770, 300], [905, 410],
  [160, 500], [340, 520], [520, 470], [690, 520], [860, 560], [420, 650],
];

const THRESHOLD = 235;

type Edge = { a: number; b: number; d: number };

function buildEdges(): Edge[] {
  const edges: Edge[] = [];
  for (let i = 0; i < NODES.length; i++) {
    for (let j = i + 1; j < NODES.length; j++) {
      const dx = NODES[i][0] - NODES[j][0];
      const dy = NODES[i][1] - NODES[j][1];
      const d = Math.hypot(dx, dy);
      if (d < THRESHOLD) edges.push({ a: i, b: j, d });
    }
  }
  return edges;
}

export function NeuralBg() {
  const edges = buildEdges();
  // Send signals along the shortest few edges for a lively-but-subtle feel.
  const signals = [...edges].sort((x, y) => x.d - y.d).slice(0, 7);

  return (
    <svg
      viewBox="0 0 1000 700"
      preserveAspectRatio="xMidYMid slice"
      className="h-full w-full"
      aria-hidden
    >
      <g opacity="0.5">
        {edges.map((e, i) => {
          const [ax, ay] = NODES[e.a];
          const [bx, by] = NODES[e.b];
          return (
            <line
              key={`e${i}`}
              x1={ax}
              y1={ay}
              x2={bx}
              y2={by}
              stroke="#34d399"
              strokeOpacity={0.12}
              strokeWidth={1}
            />
          );
        })}

        {NODES.map(([x, y], i) => {
          const hub = i % 4 === 0;
          return (
            <g key={`n${i}`}>
              {hub && <circle cx={x} cy={y} r={9} fill="#34d399" opacity={0.06} />}
              <circle
                cx={x}
                cy={y}
                r={hub ? 3.4 : 2.2}
                fill={hub ? "#5eead4" : "#34d399"}
                className="blip"
                style={{ animationDelay: `${(i % 6) * 0.6}s` }}
              />
            </g>
          );
        })}

        {signals.map((e, i) => {
          const [ax, ay] = NODES[e.a];
          const [bx, by] = NODES[e.b];
          return (
            <circle key={`s${i}`} r={2.2} fill="#67e8f9" opacity={0.9}>
              <animateMotion
                dur={`${3 + (i % 4)}s`}
                begin={`${i * 0.7}s`}
                repeatCount="indefinite"
                path={`M${ax},${ay} L${bx},${by}`}
              />
            </circle>
          );
        })}
      </g>
    </svg>
  );
}
