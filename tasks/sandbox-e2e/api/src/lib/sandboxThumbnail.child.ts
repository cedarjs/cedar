// A sandboxed child that turns a PNG into an 8x8 WebP with sharp (a
// native addon, libvips) and reports what it made
import sharp from 'sharp'

const chunks: Buffer[] = []
for await (const chunk of process.stdin) {
  chunks.push(chunk)
}

sharp.block({ operation: ['VipsForeignLoad'] })
sharp.unblock({ operation: ['VipsForeignLoadPngBuffer'] })

const { data, info } = await sharp(Buffer.concat(chunks), { failOn: 'error' })
  .resize(8, 8)
  .webp()
  .toBuffer({ resolveWithObject: true })

process.stdout.write(
  JSON.stringify({
    format: info.format,
    width: info.width,
    height: info.height,
    riff: data.toString('latin1', 0, 4) + data.toString('latin1', 8, 12),
  }),
)
