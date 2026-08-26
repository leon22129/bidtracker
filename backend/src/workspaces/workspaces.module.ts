import { Global, Module } from '@nestjs/common';
import { WorkspacesController } from './workspaces.controller';
import { WorkspacesService } from './workspaces.service';
import { WorkspaceAccessService } from './workspace-access.service';

/**
 * Global because WorkspaceAccessService is a cross-cutting authorization dependency: applications,
 * imports and analytics all need it, and threading it through imports would just be ceremony.
 */
@Global()
@Module({
  controllers: [WorkspacesController],
  providers: [WorkspacesService, WorkspaceAccessService],
  exports: [WorkspacesService, WorkspaceAccessService],
})
export class WorkspacesModule {}
