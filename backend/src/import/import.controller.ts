import {
  Body, Controller, Param, Post, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from './file.interceptor';
import { ImportService } from './import.service';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('import')
export class ImportController {
  constructor(private readonly importService: ImportService) {}

  /** Dry run: shows detected column mapping and a few sample rows before committing. */
  @Post(':workspaceId/preview')
  @UseInterceptors(FileInterceptor)
  preview(
    @CurrentUser() user: AuthUser,
    @Param('workspaceId') workspaceId: string,
    @UploadedFile() file: any,
  ) {
    return this.importService.preview(user, workspaceId, file);
  }

  @Post(':workspaceId')
  @UseInterceptors(FileInterceptor)
  run(
    @CurrentUser() user: AuthUser,
    @Param('workspaceId') workspaceId: string,
    @UploadedFile() file: any,
    @Body() body: { default_date?: string },
  ) {
    return this.importService.import(user, workspaceId, file, {
      defaultDate: body?.default_date,
    });
  }
}
