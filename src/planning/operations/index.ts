/**
 * The built-in Architectural Operation Providers (Sprint 24.5, Epic 3).
 *
 * Registered exactly the way a plugin's would be — the planner has no
 * privileged path — so this list is a default, not a hard-coded capability set.
 * A host that wants a narrower assistant registers a subset; one that wants
 * more registers its own alongside.
 */

import type { ArchitecturalOperationProvider } from '../architectural-operation';
import { createAlignWallsOperationProvider } from './align-walls-operation';
import { createDeleteOperationProvider } from './delete-operation';
import { createMoveRoomOperationProvider } from './move-room-operation';
import { createRenameRoomOperationProvider } from './rename-room-operation';
import { createUnsupportedOperationProvider } from './unsupported-operations';
import { createWallPropertyOperationProvider } from './wall-property-operation';

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
