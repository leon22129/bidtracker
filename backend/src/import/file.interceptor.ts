import { FileInterceptor as NestFileInterceptor } from '@nestjs/platform-express';
import { BadRequestException } from '@nestjs/common';
import { memoryStorage } from 'multer';

const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_MB || 25) * 1024 * 1024;

/**
 * Memory storage rather than disk: the file is parsed once and discarded, so writing it to the
 * container filesystem would only add cleanup work and a place for stale uploads to accumulate.
 * 25 MB comfortably covers a 20k-row xlsx.
 */
export const FileInterceptor = NestFileInterceptor('file', {
  storage: memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ok = /\.(xlsx|xls|csv)$/i.test(file.originalname);
    if (!ok) {
      cb(new BadRequestException('Only .xlsx, .xls and .csv files are supported'), false);
      return;
    }
    cb(null, true);
  },
});
