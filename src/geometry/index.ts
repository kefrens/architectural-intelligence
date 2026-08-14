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
  describeSpecificationCompliance,
  evaluateSpecification,
  type EvaluateSpecificationInput,
  type SpecificationCompliance
} from './specification-compliance.js';

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
  toGeometryGraphProposal,
  type ToGeometryGraphProposalOptions
} from './geometry-graph-proposal.js';

/** Sprint 1.1 — the fifth and final design artefact (ADR-AI-0001). */
export {
  DEFAULT_CONSTRUCTION,
  describeDefaults,
  OPENING_KINDS,
  thicknessFor,
  WALL_ROLES,
  wallHeight,
  type ConstructionDefaults,
  type OpeningDefaults,
  type OpeningKind,
  type WallRole
} from './construction-defaults.js';

export {
  createGeometrySpecification,
  GEOMETRY_CONTRACT_VERSION,
  GEOMETRY_SPECIFICATION_KIND,
  isContractCompatible,
  isGeometrySpecificationComplete,
  matchesGeometryGraph,
  METRIC_CONVENTIONS,
  reviseGeometrySpecification,
  storeyFloorArea,
  summarizeGeometrySpecification,
  type GeometryConstraintRecord,
  type GeometryProvenance,
  type GeometrySpecification,
  type MetricConventions,
  type SpecifiedOpening,
  type SpecifiedSpace,
  type SpecifiedStorey,
  type SpecifiedWall
} from './geometry-specification.js';

export {
  specificationJunctions,
  synthesizeSpecification,
  type SpecificationSynthesisResult,
  type SynthesizeSpecificationOptions
} from './specification-synthesis.js';

export {
  gateGeometrySpecification,
  SPECIFICATION_INVARIANTS,
  validateGeometrySpecification,
  violationsOf,
  type SpecificationInvariantId,
  type SpecificationViolation
} from './specification-validation.js';

export {
  describeSpecification,
  toGeometrySpecificationProposal
} from './specification-proposal.js';
