import { myPetPhoto } from './portal'
import { currentClient } from './session'

/** A pet's photo, served only to the signed-in household the pet belongs to. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const client = await currentClient()
  if (!client) return new Response('Sign in to see this photo.', { status: 401 })
  const { id } = await params
  const photo = await myPetPhoto(client, id)
  if (!photo) return new Response('Not found', { status: 404 })
  return new Response(new Uint8Array(photo.bytes), {
    headers: {
      'content-type': photo.mimeType,
      'content-length': String(photo.bytes.length),
      'content-disposition': 'inline',
      'cache-control': 'private, max-age=86400',
      'x-content-type-options': 'nosniff',
    },
  })
}
