/**
 * The built-in Architectural Operation Providers (Sprint 24.5, Epic 3).
 *
 * Registered exactly the way a plugin's would be — the planner has no
 * privileged path — so this list is a default, not a hard-coded capability set.
 * A host that wants a narrower assistant registers a subset; one that wants
 * more registers its own alongside.
 */

import type { ArchitecturalOperationProvider } from '../architectural-operation.js';
import { createAlignWallsOperationProvider } from './align-walls-operation.js';
import { createDeleteOperationProvider } from './delete-operation.js';
import { createMoveRoomOperationProvider } from './move-room-operation.js';
import { createRenameRoomOperationProvider } from './rename-room-operation.js';
import { createUnsupportedOperationProvider } from './unsupported-operations.js';
import { createWallPropertyOperationProvider } from './wall-property-operation.js';

export function createBuiltInOperationProviders(): readonly ArchitecturalOperationProvider[] {
  return [
    createMoveRoomOperationProvider(),
    createRenameRoomOperationProvider(),
    createWallPropertyOperationProvider(),
    createAlignWallsOperationProvider(),
    createDeleteOperationProvider(),
    createUnsupportedOperationProvider()
  ];
}
