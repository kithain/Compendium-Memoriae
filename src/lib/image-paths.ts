export const PUBLIC_IMAGE_CATEGORIES = [
  'lieux', 'pnj', 'factions', 'cosmogonie', 'histoire', 'cultures', 'savoirs',
] as const;

const publicImagePattern = /^images\/(lieux|pnj|factions|cosmogonie|histoire|cultures|savoirs)\/[A-Za-z0-9][A-Za-z0-9._-]*\.jpg$/;
const campaignPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The same relative-path contract is enforced by the database. */
export function publicImagePath(input: string): string | null {
  const path = input.trim();
  return path.length <= 512 && publicImagePattern.test(path) ? path : null;
}

/** Read compatibility for the existing, campaign-prefixed private JPEG keys. */
export function legacyImagePath(input: string, campaignId: string): string | null {
  const path = input.trim();
  if (!campaignPattern.test(campaignId) || path.length > 512
      || !(path.startsWith(`${campaignId}_`) || path.startsWith(`${campaignId}/`))
      || !/^[A-Za-z0-9][A-Za-z0-9._/-]*\.jpg$/.test(path)
      || path.split('/').some(segment => !segment || segment === '.' || segment === '..')) return null;
  return path;
}

export function publicImageUrl(input: string, baseUrl: string): string {
  const path = publicImagePath(input);
  if (!path) throw new Error('Utilisez un chemin images/catégorie/nom.jpg, sans espaces ni accents.');
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  if (!base.startsWith('/') || base.startsWith('//') || /[\\?#%]/.test(base)
      || base.split('/').some(segment => segment === '.' || segment === '..')) {
    throw new Error('Le chemin de publication du site est invalide.');
  }
  return `${base}${path.split('/').map(segment => encodeURIComponent(segment)).join('/')}`;
}

export function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

/** Public images never receive a Supabase session or browser credentials. */
export async function loadPublicImage(
  input: string,
  baseUrl: string,
  fetchImage: typeof fetch = fetch,
): Promise<Blob> {
  const response = await fetchImage(publicImageUrl(input, baseUrl), {
    credentials: 'omit', redirect: 'error', cache: 'no-cache',
  });
  if (!response.ok) throw new Error('Illustration indisponible. Publiez le fichier avant d’enregistrer son chemin.');
  const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'image/jpeg') throw new Error('Le fichier publié n’est pas une image JPG.');
  const blob = await response.blob();
  if (!isJpeg(new Uint8Array(await blob.slice(0, 4).arrayBuffer()))) {
    throw new Error('Le fichier publié n’est pas une image JPG.');
  }
  return blob;
}
