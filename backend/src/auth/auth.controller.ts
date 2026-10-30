import { Body, Controller, Get, HttpCode, Patch, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { ChangePasswordDto, LoginDto, UpdateSlackSettingsDto } from './dto/auth.dto';
import { Public } from '../common/decorators/public.decorator';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.id);
  }

  @Post('change-password')
  @HttpCode(200)
  changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto) {
    return this.auth.changeOwnPassword(user.id, dto);
  }

  @Get('slack-settings')
  slackSettings(@CurrentUser() user: AuthUser) {
    return this.auth.slackSettings(user.id);
  }

  @Patch('slack-settings')
  updateSlackSettings(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateSlackSettingsDto,
  ) {
    return this.auth.updateSlackSettings(user.id, dto);
  }
}
