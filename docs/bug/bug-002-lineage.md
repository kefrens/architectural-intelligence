Investigate the E2E failure where approving an Architectural Brief and then replying "ok" creates a second approved Brief lineage.

Reproduce:

User: "Build me a 100m² apartment with 2 bedrooms and 1 bathroom"
Answer storey clarification
Brief proposal is generated and approved.
User: "ok"
Observe why another Brief proposal is generated/approved instead of routing to planning_generateProgramme.
Inspect PlanningArtefactRegistry.all() and identify the two Brief identities and their revisions/lineages.

Do not weaken lineage validation or automatically choose the first lineage.

The desired behaviour is:

one approved Brief
↓
"ok"
↓
ProgrammeGeneration

If the user explicitly changes the Brief, use the revision path and preserve the existing lineage.

Also determine why the initial building request is first classified as unsupported rather than entering the Brief workflow.
