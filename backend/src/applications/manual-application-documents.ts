import { BadRequestException } from '@nestjs/common';
import type { CreateManualApplicationDto } from './dto/application.dto';

export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
export const MAX_DOCUMENT_TEXT_LENGTH = 50_000;

export interface ManualApplicationFiles {
  resume_pdf?: Express.Multer.File[];
  job_description_pdf?: Express.Multer.File[];
}

/** Validate both documents before creating the application and its attachments atomically. */
export function manualApplicationDocuments(dto: CreateManualApplicationDto, files: ManualApplicationFiles) {
  const documents: Array<{
    kind: string; format: string; filename: string; content_type: string; data: Buffer;
  }> = [];
  for (const [kind, label, textValue, uploads] of [
    ['resume', 'Resume', dto.resume_text, files.resume_pdf],
    ['job_description', 'Job description', dto.job_description, files.job_description_pdf],
  ] as const) {
    if (textValue != null && typeof textValue !== 'string') {
      throw new BadRequestException(`${label} text must be a string.`);
    }
    const text = textValue?.replace(/\r\n?/g, '\n').trim() || '';
    if (text.length > MAX_DOCUMENT_TEXT_LENGTH) {
      throw new BadRequestException(`${label} text must be at most 50,000 characters.`);
    }
    if (uploads && uploads.length > 1) throw new BadRequestException(`Upload only one ${label.toLowerCase()} PDF.`);
    const file = uploads?.[0];
    if (!text && !file) {
      throw new BadRequestException(`${label} is required. Upload a PDF or provide text.`);
    }
    const basename = kind === 'resume' ? 'resume' : 'jd';
    if (file) {
      if (!file.buffer?.length || file.buffer.length > MAX_DOCUMENT_BYTES) {
        throw new BadRequestException(`${label} PDF must be between 1 byte and 5 MB.`);
      }
      if (file.buffer.subarray(0, 5).toString('ascii') !== '%PDF-'
        || !file.buffer.subarray(-1024).includes(Buffer.from('%%EOF'))) {
        throw new BadRequestException(`${label} must be a valid PDF file.`);
      }
      documents.push({ kind, format: 'pdf', filename: `${basename}.pdf`, content_type: 'application/pdf', data: file.buffer });
    }
    if (text) {
      documents.push({ kind, format: 'txt', filename: `${basename}.txt`, content_type: 'text/plain; charset=utf-8', data: Buffer.from(text, 'utf8') });
    }
  }
  return documents;
}
