import {
  Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { WorkspacesService } from './workspaces.service';
import { CreateWorkspaceDto, GrantPermissionDto, UpdateWorkspaceDto } from './dto/workspace.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('workspaces')
@UseGuards(RolesGuard)
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  /** Any authenticated user — the service filters to what they may see. */
  @Get()
  findAll(@CurrentUser() user: AuthUser, @Query('includeArchived') includeArchived?: string) {
    return this.workspaces.findAllForUser(user, includeArchived === 'true');
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.workspaces.findOne(user, id);
  }

  @Post()
  @Roles('admin')
  create(@Body() dto: CreateWorkspaceDto) {
    return this.workspaces.create(dto);
  }

  @Patch(':id')
  @Roles('admin')
  update(@Param('id') id: string, @Body() dto: UpdateWorkspaceDto) {
    return this.workspaces.update(id, dto);
  }

  @Delete(':id')
  @Roles('admin')
  remove(@Param('id') id: string) {
    return this.workspaces.remove(id);
  }

  @Post(':id/permissions')
  @Roles('admin')
  grant(@Param('id') id: string, @Body() dto: GrantPermissionDto) {
    return this.workspaces.grantPermission(id, dto);
  }

  @Delete(':id/permissions/:userId')
  @Roles('admin')
  revoke(@Param('id') id: string, @Param('userId') userId: string) {
    return this.workspaces.revokePermission(id, userId);
  }
}
