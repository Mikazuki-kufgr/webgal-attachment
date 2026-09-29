import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UploadFilesDto {
  @ApiProperty({ description: 'Target directory for the uploaded files' })
  targetDirectory: string;
}

export class CreateNewFileDto {
  @ApiProperty({
    description: 'The source path where the directory will be created',
  })
  source: string;

  @ApiProperty({ description: 'Name for the new file' })
  name: string;
}

export class CreateNewFolderDto {
  @ApiProperty({
    description: 'The source path where the directory will be created',
  })
  source: string;

  @ApiProperty({ description: 'Name for the new directory' })
  name: string;
}

export class DeleteFileOrDirDto {
  @ApiProperty({
    description: 'The source path of the file or directory to be deleted',
  })
  source: string;
}

export class RenameFileDto {
  @ApiProperty({
    description: 'The source path of the file or directory to be renamed',
  })
  source: string;

  @ApiProperty({ description: 'New name for renaming the file or directory' })
  newName: string;
}

export class TrashFileOrDirDto {
  @ApiProperty({
    description: 'The source path of the file or directory to be thrashed',
  })
  source: string;
}

export class CopyFileWithIncrementDto {
  @ApiProperty({ description: 'The source path of the file to be copied' })
  source: string;
}

export class EditTextFileDto {
  @ApiProperty({ description: 'The path of textfile' })
  path: string;

  @ApiProperty({
    description: 'Text data content',
    type: 'string',
  })
  textFile: string;

  @ApiPropertyOptional({
    description: 'Stable identifier for this editor save session',
  })
  saveSessionId?: string;

  @ApiPropertyOptional({
    description: 'Monotonic revision within the save session',
  })
  revision?: number;

  @ApiPropertyOptional({ description: 'SHA-256 of textFile encoded as UTF-8' })
  contentHash?: string;
  @ApiPropertyOptional({ description: 'Verify current disk content without writing' })
  verifyOnly?: boolean;
}

export class EditTextFileResultDto {
  @ApiProperty({ description: 'Whether the requested revision was persisted' })
  ok: true;

  @ApiProperty({ description: 'Resolved text file path' })
  path: string;

  @ApiPropertyOptional({ description: 'Save session echoed from the request' })
  saveSessionId?: string;

  @ApiPropertyOptional({
    description: 'Committed revision echoed from the request',
  })
  revision?: number;

  @ApiProperty({ description: 'SHA-256 of the persisted UTF-8 text' })
  contentHash: string;

  @ApiProperty({
    description: 'Whether this was an exact retry of a committed revision',
  })
  idempotent: boolean;
  @ApiPropertyOptional({ description: 'Current disk bytes matched at verification time' })
  verifiedCurrent?: boolean;
}

export class ApplyTemplateToGameDto {
  @ApiProperty({ description: 'The template name to apply' })
  templateDir: string;

  @ApiProperty({
    description: 'The game name to be applied.',
  })
  gameDir: string;
}

export class ImageDimensionsResponseDto {
  @ApiProperty({ description: 'Width of the image in pixels' })
  width: number;

  @ApiProperty({ description: 'Height of the image in pixels' })
  height: number;

  @ApiProperty({ description: 'Image file type (e.g., jpg, png, gif, webp)' })
  type: string;
}
