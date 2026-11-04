import { Transform } from 'class-transformer';
import { IsString, IsUrl, Matches, MaxLength } from 'class-validator';

export class UpdateExtensionReleaseDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @MaxLength(23)
  @Matches(/^\d+\.\d+\.\d+(?:\.\d+)?$/, { message: 'latest_version must have three or four numeric components, such as 0.9.4.' })
  latest_version: string;

  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @MaxLength(2048)
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true, require_tld: false, disallow_auth: true }, {
    message: 'download_url must be a valid HTTP or HTTPS URL.',
  })
  download_url: string;
}
