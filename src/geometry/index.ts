export {
  createGeometryGraph,
  GEOMETRY_GRAPH_KIND,
  isGeometryGraphComplete,
  matchesLayout,
  reviseGeometryGraph,
  storeyArea,
  summarizeGeometryGraph,
  type GeometryAdjacency,
  type GeometryGraph,
  type LayoutProvenance,
  type OpeningCandidate,
  type RoomPolygon,
  type WallCandidate
} from './geometry-graph.js';

export {
  describeEvaluation,
  evaluateGeometryGraph,
  type EvaluateGeometryGraphOptions
} from './geometry-evaluation.js';

export {
  expectedInstances,
  gateGeometryGraph,
  synthesizeGeometry,
  type GeometrySynthesisResult,
  type SynthesizeGeometryOptions
} from './geometry-synthesis.js';

export {
  describeGeometry,
  toGeometryProposal,
  type ToGeometryProposalOptions
} from './geometry-proposal.js';
