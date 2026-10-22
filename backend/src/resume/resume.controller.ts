import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApplicationGenerationService } from './resume.service';
import {
  AnswerApplicationQuestionsDto,
  GenerateApplicationDto,
  GenerateProfilePromptDto,
} from './dto/generate.dto';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { RolesGuard } from '../common/guards/roles.guard';

@Controller('resume')
@UseGuards(RolesGuard)
export class ResumeController {
  constructor(private readonly generation: ApplicationGenerationService) {}

  @Post('generate')
  generate(@CurrentUser() user: AuthUser, @Body() dto: GenerateApplicationDto) {
    return this.generation.generate(user, dto);
  }

  @Post('profile-generate')
  generateProfilePrompt(@CurrentUser() user: AuthUser, @Body() dto: GenerateProfilePromptDto) {
    return this.generation.generateProfilePrompt(user, dto);
  }

  @Post('answers')
  answerQuestions(@CurrentUser() user: AuthUser, @Body() dto: AnswerApplicationQuestionsDto) {
    return this.generation.answerQuestions(user, dto);
  }

  @Get('answers/:conversationId')
  restoreAnswers(
    @CurrentUser() user: AuthUser,
    @Param('conversationId') conversationId: string,
  ) {
    return this.generation.getConversationAnswers(user, conversationId);
  }
}
