import {
  Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto, ResetPasswordDto, UpdateUserDto } from './dto/user.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';

/** Admins manage their account; bidder managers manage only bidders allocated to them. */
@Controller('users')
@UseGuards(RolesGuard)
@Roles('admin', 'super_admin', 'bidder_manager')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
    findAll(@CurrentUser() me: AuthUser) {
      return this.users.findAll(me);
  }

  @Get(':id')
    findOne(@Param('id') id: string, @CurrentUser() me: AuthUser) {
      return this.users.findOne(id, me);
  }

  @Post()
  create(@Body() dto: CreateUserDto, @CurrentUser() me: AuthUser) {
    return this.users.create(dto, me);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateUserDto, @CurrentUser() me: AuthUser) {
    return this.users.update(id, dto, me);
  }

  @Post(':id/reset-password')
  @HttpCode(200)
    resetPassword(@Param('id') id: string, @Body() dto: ResetPasswordDto, @CurrentUser() me: AuthUser) {
      return this.users.resetPassword(id, dto, me);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() me: AuthUser) {
    return this.users.remove(id, me);
  }
}
