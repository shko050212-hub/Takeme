import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthUser, type JwtPayload } from '../auth/auth-user.decorator';
import { MediaService } from './media.service';

@Controller('routing/media')
@UseGuards(JwtAuthGuard)
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Post()
  async upload(
    @AuthUser() user: JwtPayload,
    @Body() body: any,
    @Req() req: any,
  ) {
    const reqHost = req?.get ? req.get('host') : undefined;
    return this.mediaService.uploadMedia(user, body, reqHost);
  }

  @Get()
  async list(
    @AuthUser() user: JwtPayload,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('vehicleId') vehicleId?: string,
    @Query('className') className?: string,
    @Query('sourceType') sourceType?: string,
  ) {
    return this.mediaService.listMedia(user, { from, to, vehicleId, className, sourceType });
  }

  @Get(':id/download')
  async download(
    @AuthUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Res() res: any,
  ) {
    const target = await this.mediaService.getDownloadTarget(user, id);
    if (target.type === 's3') {
      return res.redirect(target.url);
    } else {
      return res.download(target.filePath, target.filename);
    }
  }

  @Delete(':id')
  async delete(
    @AuthUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.mediaService.deleteMedia(user, id);
  }
}
