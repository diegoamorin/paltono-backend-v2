import { ApiProperty } from '@nestjs/swagger';
import { EntityManager, In, IsNull } from 'typeorm';
import { ImageUpload } from './entities/image-upload.entity';

/** A catalog image as the public reads show it. */
export class ShownImage {
  @ApiProperty({ format: 'uri', description: 'URL pública de la imagen' })
  url: string;

  @ApiProperty({ description: 'Ancho en píxeles' })
  width: number;

  @ApiProperty({ description: 'Alto en píxeles' })
  height: number;
}

/** Description of an image attribute in the public reads. */
export const SHOWN_IMAGE_DESCRIPTION = 'Imagen con sus dimensiones, o null si no hay o su archivo ya no está guardado';

/**
 * The images the reads show for `urls`, looked up at once (ADR 0005), as a
 * function from a stored URL to its image. Only a catalog upload whose file is
 * still stored is shown, so a read never hands out a URL that no longer loads;
 * null, or any other URL, shows no image.
 */
export async function shownImages(manager: EntityManager, urls: (string | null)[]): Promise<(url: string | null) => ShownImage | null> {
  const wanted = [...new Set(urls.filter((url): url is string => url !== null))];
  const uploads =
    wanted.length === 0
      ? []
      : await manager.find(ImageUpload, {
          select: { url: true, width: true, height: true },
          where: { url: In(wanted), purpose: 'catalog', fileRemovedAt: IsNull() },
        });
  const byUrl = new Map(uploads.map(({ url, width, height }) => [url, { url, width, height }]));
  return (url) => (url === null ? null : (byUrl.get(url) ?? null));
}
