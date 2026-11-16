import { Module } from '@nestjs/common';

import { FilesController } from './files.controller';
import { FilesRepository } from './files.repository';
import { FilesService } from './files.service';

@Module({
  controllers: [FilesController],
  providers: [FilesService, FilesRepository],
})
export class FilesModule {}