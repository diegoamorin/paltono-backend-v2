import { ApiProperty } from '@nestjs/swagger';
import { EntityManager, In, IsNull } from 'typeorm';
import { ImageUpload } from './entities/image-upload.entity';

/** A catalog image as the public reads show it. */
export interface ShownImage {
  url: string;
  width: number;
  height: number;
}

/** Finds the image a read shows for a stored URL: null for null, or when the URL has no upload with its file. */
export type ShownImageOf = (url: string | null) => ShownImage | null;

/** For an entry that shows no images, such as a withdrawn one. */
export const NO_SHOWN_IMAGES: ShownImageOf = () => null;

/**
 * The images the reads show for `urls`, looked up at once (ADR 0005). Only an
 * upload whose file is still stored is shown, so a read never hands out a URL
 * that no longer loads.
 */
export async function shownImages(manager: EntityManager, urls: (string | null)[]): Promise<ShownImageOf> {
  const wanted = [...new Set(urls.filter((url): url is string => url !== null))];
  const uploads =
    wanted.length === 0
      ? []
      : await manager.find(ImageUpload, { select: { url: true, width: true, height: true }, where: { url: In(wanted), fileRemovedAt: IsNull() } });
  const byUrl = new Map(uploads.map(({ url, width, height }) => [url, { url, width, height }]));
  return (url) => (url === null ? null : (byUrl.get(url) ?? null));
}

export class ShownImageAttributes {
  @ApiProperty({ format: 'uri', description: 'URL pública de la imagen' })
  url: string;

  @ApiProperty({ description: 'Ancho en píxeles' })
  width: number;

  @ApiProperty({ description: 'Alto en píxeles' })
  height: number;
}

/** Description of an image attribute in the public reads. */
export const SHOWN_IMAGE_DESCRIPTION = 'Imagen con sus dimensiones, o null si no hay o su archivo ya no está guardado';
