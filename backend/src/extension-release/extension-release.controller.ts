import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { UpdateExtensionReleaseDto } from './extension-release.dto';
import { ExtensionReleaseService } from './extension-release.service';

@Controller('extension-release')
@UseGuards(RolesGuard)
@Roles('super_admin')
export class ExtensionReleaseController {
  constructor(private readonly release: ExtensionReleaseService) {}

  @Get()
  get() { return this.release.get(); }

  @Patch()
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdateExtensionReleaseDto) {
    return this.release.update(user, dto);
  }
}
