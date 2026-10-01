import {
  Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { WorkspacesService } from './workspaces.service';
import { CreateWorkspaceDto, UpdateWorkspaceDto } from './dto/workspace.dto';
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

  @Get('profiles/assigned')
  profiles(@CurrentUser() user: AuthUser) {
    return this.workspaces.listProfiles(user);
  }

  @Patch('profiles/:profileId')
  updateProfile(
    @Param('profileId') profileId: string,
    @Body() dto: UpdateWorkspaceDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.workspaces.updateProfile(profileId, dto, user);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.workspaces.findOne(user, id);
  }

  @Post()
  @Roles('admin', 'super_admin')
  create(@Body() dto: CreateWorkspaceDto, @CurrentUser() user: AuthUser) {
    return this.workspaces.create(dto, user);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateWorkspaceDto, @CurrentUser() user: AuthUser) {
    return this.workspaces.update(id, dto, user);
  }

  @Delete(':id')
  @Roles('admin', 'super_admin')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.workspaces.remove(id, user);
  }

}
