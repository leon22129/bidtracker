import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ResumeService } from './resume.service';
import { GenerateApplicationDto, GenerateProfilePromptDto } from './dto/generate.dto';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { RolesGuard } from '../common/guards/roles.guard';

@Controller('resume')
@UseGuards(RolesGuard)
export class ResumeController {
  constructor(private readonly resume: ResumeService) {}

  @Post('generate')
  generate(@CurrentUser() user: AuthUser, @Body() dto: GenerateApplicationDto) {
    return this.resume.generate(user, dto);
  }

  @Post('profile-generate')
  generateProfilePrompt(@CurrentUser() user: AuthUser, @Body() dto: GenerateProfilePromptDto) {
    return this.resume.generateProfilePrompt(user, dto);
  }
}
